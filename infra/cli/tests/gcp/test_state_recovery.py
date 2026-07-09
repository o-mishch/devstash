"""Tests for gcp/state_recovery.py — the guided `unlock` lock recovery (safety branches + #1).

The recovery is about the RELEASE DECISION: never break a live lock. Collaborators are fakes
(gcloud storage cat/generation + builds, gh run status/cancel, tofu force-unlock) and every OS seam
(hostname/pgrep/kill/liveness/sleep) is injected, so no real signalling runs. `confirm` is patched
in the module namespace to script the operator's yes/no answers. Force-unlock uses the GCS object
GENERATION [#1], asserted via the tofu fake's recorded argument.
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import pytest

from devstash_infra.gcp import state_recovery
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.state_recovery import StateLockRecovery
from devstash_infra.shared.proc import ProcError, Result
from tests.doubles import ManualClock

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)

_LOCK_URI = "gs://proj-tfstate-dev/gke/dev/default.tflock"
_LOCK_JSON = json.dumps(
    {"ID": "uuid-123", "Who": "alice@buildbox", "Operation": "OperationTypeApply"}
)


@dataclass
class _FakeStorage:
    blob: str = _LOCK_JSON
    generation: str = "17654321"
    gen_reads: list[str] = field(default_factory=list)

    def cat(self, uri: str) -> str:
        return self.blob

    def object_generation(self, uri: str) -> str:
        self.gen_reads.append(uri)
        return self.generation


@dataclass
class _FakeBuilds:
    ongoing: list[str] = field(default_factory=list)
    cancelled: list[str] = field(default_factory=list)
    cancel_ok: bool = True  # set False to simulate a failed cancel (holder must stay alive)

    def ongoing_autosuspend_ids(self, region: str, environment: str) -> list[str]:
        return list(self.ongoing)

    def cancel(self, build_id: str, *, region: str) -> bool:
        self.cancelled.append(build_id)
        return self.cancel_ok


class _FakeGcloud:
    def __init__(self, storage: _FakeStorage, builds: _FakeBuilds) -> None:
        self.storage = storage
        self.builds = builds


@dataclass
class _FakeGh:
    status: str = ""
    cancelled: list[str] = field(default_factory=list)
    cancel_ok: bool = True  # set False to simulate a failed cancel (holder must stay alive)

    def run_status(self, run_id: str) -> str:
        return self.status

    def run_cancel(self, run_id: str) -> bool:
        self.cancelled.append(run_id)
        return self.cancel_ok


@dataclass
class _FakeTofu:
    tf_dir: str = "infra/terraform/envs/dev"
    unlocked: list[str] = field(default_factory=list)
    fail: bool = False

    def force_unlock(self, lock_id: str) -> None:
        self.unlocked.append(lock_id)
        if self.fail:
            raise ProcError(Result(["tofu", "force-unlock"], "", "boom", 1))


def _answers(monkeypatch: pytest.MonkeyPatch, answers: list[bool]) -> None:
    """Script `confirm` to return the given yes/no answers in order (then default False)."""
    it: Iterator[bool] = iter(answers)

    def _confirm(_prompt: str, *, auto_approve: bool = False) -> bool:
        return next(it, False)

    monkeypatch.setattr(state_recovery, "confirm", _confirm)


def _recovery(
    *,
    storage: _FakeStorage | None = None,
    builds: _FakeBuilds | None = None,
    gh: _FakeGh | None = None,
    tofu: _FakeTofu | None = None,
    deploy_run_id: str = "",
    auto_approve: bool = False,
    hostname: str = "otherbox",
    pids: list[int] | None = None,
    alive: Callable[[int], bool] | None = None,
) -> StateLockRecovery:
    storage = storage or _FakeStorage()
    builds = builds or _FakeBuilds()
    return StateLockRecovery(
        config=_CONFIG,
        gcloud=_FakeGcloud(storage, builds),  # type: ignore[arg-type]
        gh=gh or _FakeGh(),  # type: ignore[arg-type]
        tofu=tofu or _FakeTofu(),  # type: ignore[arg-type]
        deploy_run_id=deploy_run_id,
        auto_approve=auto_approve,
        hostname=lambda: hostname,
        list_pids=lambda _tf_dir: list(pids or []),
        pid_alive=alive or (lambda _pid: True),
        kill=lambda _pid, _sig: None,
        clock=ManualClock(),
    )


class TestAlreadyReleased:
    def test_no_lock_object_is_success(self, capsys: pytest.CaptureFixture[str]) -> None:
        rec = _recovery(storage=_FakeStorage(blob=""))
        assert rec.recover() is True
        assert "already released" in capsys.readouterr().out


class TestForceUnlockByGeneration:
    def test_fix_01_release_uses_generation_not_uuid(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # No identifiable holder → the "release anyway?" gate; operator confirms.
        _answers(monkeypatch, [True])
        tofu = _FakeTofu()
        rec = _recovery(tofu=tofu)
        assert rec.recover() is True
        assert tofu.unlocked == ["17654321"]  # [#1] the GCS GENERATION, never "uuid-123"

    def test_unreadable_generation_refuses(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _answers(monkeypatch, [True])
        rec = _recovery(storage=_FakeStorage(generation=""))
        assert rec.recover() is False

    def test_force_unlock_404_then_gone_is_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _answers(monkeypatch, [True])
        storage = _FakeStorage()
        tofu = _FakeTofu(fail=True)

        # First generation read (for the unlock) returns a value; the post-failure re-read → "".
        gens = iter(["17654321", ""])

        def _gen(uri: str) -> str:
            return next(gens, "")

        object.__setattr__(storage, "object_generation", _gen)
        rec = _recovery(storage=storage, tofu=tofu)
        assert rec.recover() is True  # lock vanished between read + release → released


class TestAutoApproveSafety:
    def test_unidentified_holder_refuses_under_auto_approve(self) -> None:
        # No probe identifies a holder → holder_alive stays True → AUTO_APPROVE refuses outright.
        rec = _recovery(auto_approve=True)
        assert rec.recover() is False

    def test_dead_build_releases_under_auto_approve(self) -> None:
        # An ongoing build, auto-cancelled (confirm auto-yes) → confirmed DEAD → release proceeds.
        builds = _FakeBuilds(ongoing=["b-1"])
        tofu = _FakeTofu()
        rec = _recovery(builds=builds, tofu=tofu, auto_approve=True)
        assert rec.recover() is True
        assert builds.cancelled == ["b-1"]
        assert tofu.unlocked == ["17654321"]

    def test_failed_build_cancel_refuses_under_auto_approve(self) -> None:
        # The cancel is ATTEMPTED but FAILS (transient/scope) → holder is NOT confirmed dead →
        # holder_alive stays True → AUTO_APPROVE refuses to release (concurrent-writer safety).
        builds = _FakeBuilds(ongoing=["b-1"], cancel_ok=False)
        tofu = _FakeTofu()
        rec = _recovery(builds=builds, tofu=tofu, auto_approve=True)
        assert rec.recover() is False
        assert builds.cancelled == ["b-1"]  # the cancel was tried
        assert tofu.unlocked == []  # but the lock was NEVER force-released


class TestGhRunProbe:
    def test_gh_probe_failure_treated_as_alive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # gh returns "" (auth/network) → potentially alive → interactive "release anyway?" declined.
        _answers(monkeypatch, [False])
        rec = _recovery(gh=_FakeGh(status=""), deploy_run_id="42")
        assert rec.recover() is False

    def test_terminal_run_is_dead(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _answers(monkeypatch, [True])  # the "release now?" (confirmed-dead) gate
        gh = _FakeGh(status="completed")
        tofu = _FakeTofu()
        rec = _recovery(gh=gh, tofu=tofu, deploy_run_id="42")
        assert rec.recover() is True
        assert gh.cancelled == []  # a finished run is not cancelled

    def test_in_progress_run_cancelled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _answers(monkeypatch, [True, True])  # cancel the run, then release
        gh = _FakeGh(status="in_progress")
        rec = _recovery(gh=gh, tofu=_FakeTofu(), deploy_run_id="42")
        assert rec.recover() is True
        assert gh.cancelled == ["42"]

    def test_failed_run_cancel_stays_alive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Operator confirms cancel, but `gh run cancel` FAILS → run is NOT confirmed dead → the
        # stronger "release ANYWAY?" gate is what's asked, and declining it leaves the lock held.
        _answers(monkeypatch, [True, False])  # confirm cancel, then decline the release-anyway gate
        gh = _FakeGh(status="in_progress", cancel_ok=False)
        tofu = _FakeTofu()
        rec = _recovery(gh=gh, tofu=tofu, deploy_run_id="42")
        assert rec.recover() is False
        assert gh.cancelled == ["42"]  # the cancel was tried
        assert tofu.unlocked == []  # but the lock was NEVER force-released


class TestLocalPidProbe:
    def test_live_local_pid_declined_stays_alive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Lock host matches this machine, a live PID exists, operator declines kill → stays alive.
        _answers(monkeypatch, [False, False])  # decline kill, decline release-anyway
        rec = _recovery(hostname="buildbox", pids=[999], alive=lambda _pid: True)
        assert rec.recover() is False

    def test_no_live_pid_on_matching_host_is_dead(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _answers(monkeypatch, [True])  # confirmed dead → "release now?" yes
        tofu = _FakeTofu()
        rec = _recovery(hostname="buildbox", pids=[], alive=lambda _pid: False, tofu=tofu)
        assert rec.recover() is True
        assert tofu.unlocked == ["17654321"]


class TestReleaseDeclined:
    def test_decline_release_leaves_lock(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _answers(monkeypatch, [False])
        tofu = _FakeTofu()
        rec = _recovery(tofu=tofu)
        assert rec.recover() is False
        assert tofu.unlocked == []  # never force-unlocked
