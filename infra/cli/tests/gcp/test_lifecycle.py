"""Tests for gcp/lifecycle.py — the overlapped bring-up orchestrators (up / apply-with-overlap).

The orchestration is about ORDERING and BRANCHING, so the collaborators are fakes that append a
tag to a shared `_EVENTS` log; each test asserts the sequence. The two seams (`wait_cluster`, the
#11 reachability wait, and `make_ar`, the #12 AR-writable probe) are injected so no real polling or
HTTP runs. `confirm` is patched in the module namespace to answer the single upfront intent gate.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.gh import Gh
from devstash_infra.clients.tofu import Tofu
from devstash_infra.config import GcpConfig
from devstash_infra.environment import ApplyDeps, Environment
from devstash_infra.gcp import lifecycle
from devstash_infra.gcp.bootstrap import Bootstrap
from devstash_infra.gcp.db import Db, DumpTarget
from devstash_infra.gcp.deploy import Deploy
from devstash_infra.gcp.dns import Dns
from devstash_infra.gcp.lifecycle import AR_PUSH_TARGETS, CI_IDENTITY_TARGETS, ArWritable, Lifecycle
from devstash_infra.gcp.secrets import SECRETS_REQUIRED_OUTPUTS, Secrets
from devstash_infra.gcp.suspend import Teardown
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.errors import Aborted, ClusterUnreachable, InfraError

_CONFIG = GcpConfig(
    project="proj", region="us-central1", environment="dev", db_name="devstash",
    state_bucket="proj-tfstate-dev",
)  # fmt: skip

# Every output _tf_outputs_present checks, so the "outputs present" branch is taken.
_PRESENT: dict[str, str] = dict.fromkeys(SECRETS_REQUIRED_OUTPUTS, "x")

# First-ever / post-down: NONE of the required outputs exist (→ first-ever branch), but the AR repo
# id output IS populated by the CI-identity staging apply, so `wait_ar_push_ready` probes for real.
_FIRST_EVER: dict[str, str] = {"artifact_registry_repository_id": "devstash"}

_EVENTS: list[str] = []


class _FakeTofu(Tofu):
    def __init__(self, outputs: dict[str, str]) -> None:
        super().__init__("tf/dev")
        self._outputs = outputs

    def output_json(self) -> TofuOutputs:
        return TofuOutputs.model_validate({k: {"value": v} for k, v in self._outputs.items()})


class _FakeEnv(Environment):
    """Records apply / staging_apply; serves tofu outputs for the branch gate + AR repo id."""

    def __init__(self, outputs: dict[str, str]) -> None:
        super().__init__(_CONFIG, tofu=_FakeTofu(outputs), gcloud=Gcloud("proj"))

    def apply(
        self, deps: ApplyDeps, *, auto_approve: bool = False, confirmed: bool = False
    ) -> None:
        _EVENTS.append("apply")

    def apply_plan(
        self, deps: ApplyDeps, *, auto_approve: bool = False, confirmed: bool = False
    ) -> None:
        _EVENTS.append("apply_plan")

    def apply_exec(self) -> None:
        _EVENTS.append("apply_exec")

    def staging_apply(
        self, deps: ApplyDeps, *, label: str, targets: list[str], auto_approve: bool = False
    ) -> None:
        # CI-identity subgraph carries the app-config secret version; the AR-only one never does.
        kind = "ci" if any("secret_version.app_config" in t for t in targets) else "ar"
        _EVENTS.append(f"staging:{kind}")


class _FakeGh(Gh):
    def run_cancel(self, run_id: str) -> bool:
        _EVENTS.append(f"cancel:{run_id}")
        return True


@dataclass(frozen=True)
class _FakeDeploy(Deploy):
    def predispatch(self, push_secrets: object) -> str:
        assert callable(push_secrets)
        push_secrets()  # secrets refreshed BEFORE dispatch — records "secrets"
        _EVENTS.append("predispatch")
        return "run-1"

    def print_parallel_hint(self, infra_word: str, run_id: str) -> None:
        _EVENTS.append(f"hint:{infra_word}")

    def watch_run(self, run_id: str) -> None:
        _EVENTS.append(f"watch:{run_id}")


@dataclass(frozen=True)
class _FakeSecrets(Secrets):
    def push(self) -> None:
        _EVENTS.append("secrets")


class _FakeDns(Dns):
    def dns_hint(self) -> None:
        _EVENTS.append("dns_hint")

    def update(
        self, *, ingress_ip_override: str = "", key_override: str = "", secret_override: str = ""
    ) -> None:
        _EVENTS.append("dns_update")


@dataclass(frozen=True)
class _FakeBootstrap(Bootstrap):
    def run(self, *, auto_approve: bool = False) -> None:
        _EVENTS.append("bootstrap")


_DUMP_TARGET = DumpTarget(instance="devstash-dev-sql", dump_uri="gs://d/x.sql", db_name="devstash")


class _FakeDb(Db):
    """Records dump/restore + the was_already_live snapshot; `already_live` drives [#5]."""

    def __init__(self, tofu: Tofu, *, already_live: bool = False) -> None:
        super().__init__(_CONFIG, Gcloud("proj"), tofu)
        self._already_live = already_live

    def dump(self, *, runnable_attempts: int = 30, runnable_gap_s: float = 10.0) -> None:
        _EVENTS.append("db_dump")

    def resolve_dump_target(self) -> DumpTarget:
        return _DUMP_TARGET

    def db_already_live(self, target: DumpTarget | None) -> bool:
        _EVENTS.append("db_snapshot")  # taken BEFORE apply [#5]
        return self._already_live

    def restore(self, target: DumpTarget | None, *, was_already_live: bool = False) -> None:
        _EVENTS.append(f"db_restore(live={was_already_live})")


class _FakeTeardown(Teardown):
    def cleanup_leaked_negs(self) -> None:
        _EVENTS.append("cleanup_negs")


class _FakeAr:
    """Context-manager AR-writable probe (satisfies ArWritable) — no httpx/GCP."""

    def __init__(self, *, writable: bool) -> None:
        self._writable = writable

    def __enter__(self) -> _FakeAr:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def wait_until_writable(self) -> bool:
        _EVENTS.append("ar_wait")
        return self._writable


def _noop() -> None:
    return None


_DEPS = ApplyDeps(
    ensure_tfvars=_noop, require_state_bucket=_noop, wait_for_no_autosuspend_build=_noop,
    ar_iam_addr_file="/data/ar-iam.txt",
)  # fmt: skip


def _lifecycle(
    outputs: dict[str, str],
    *,
    ar_writable: bool = True,
    wait_exc: Exception | None = None,
    already_live: bool = False,
) -> Lifecycle:
    def _wait() -> None:
        _EVENTS.append("cluster")
        if wait_exc is not None:
            raise wait_exc

    def _make_ar(repo: str) -> ArWritable:
        return _FakeAr(writable=ar_writable)

    _EVENTS.clear()  # each test builds one Lifecycle before acting — reset the shared log here
    tofu = _FakeTofu(outputs)
    return Lifecycle(
        _FakeEnv(outputs),
        _DEPS,
        deploy=_FakeDeploy(gh=_FakeGh(), tofu=tofu),
        secrets=_FakeSecrets(gh=_FakeGh(), tofu=tofu),
        dns=_FakeDns(_CONFIG, Gcloud("proj"), tofu),
        bootstrap=_FakeBootstrap(_CONFIG, Gcloud("proj"), _noop, "lifecycle.json"),
        db=_FakeDb(tofu, already_live=already_live),
        teardown=_FakeTeardown(_CONFIG, Gcloud("proj"), tofu),
        cleanup_builds=lambda: _EVENTS.append("cleanup_builds"),
        wait_cluster=_wait,
        make_ar=_make_ar,
        auto_approve=True,
    )


def _confirm_yes(*_a: object, **_k: object) -> bool:
    return True


def _confirm_no(*_a: object, **_k: object) -> bool:
    return False


def _no_write_active(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub `set_active_state` so suspend/resume record the toggle, not write a tfvars file."""

    def _record(tf_dir: str, *, environment_active: bool, db_active: bool) -> None:
        _EVENTS.append("set_active")

    monkeypatch.setattr(lifecycle, "set_active_state", _record)


class TestApplyWithOverlap:
    def test_outputs_present_pre_dispatches_then_wires(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _lifecycle(_PRESENT).apply_with_overlap()
        # confirm → predispatch (no staging) → apply → wire(secrets‖cluster) → dns → hint.
        assert "staging:ci" not in _EVENTS and "staging:ar" not in _EVENTS
        assert _EVENTS.index("predispatch") < _EVENTS.index("apply")
        assert {"secrets", "cluster"} <= set(_EVENTS)
        assert _EVENTS.index("apply") < _EVENTS.index("dns_update")
        assert _EVENTS[-1] == "hint:applied"

    def test_first_ever_applies_identity_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _lifecycle(_FIRST_EVER).apply_with_overlap()  # no required outputs → first-ever branch
        # staging CI identity BEFORE predispatch (the WIF/AR subgraph the build needs to auth).
        assert _EVENTS.index("staging:ci") < _EVENTS.index("predispatch") < _EVENTS.index("apply")
        assert _EVENTS.index("staging:ci") < _EVENTS.index("ar_wait")  # AR-writable gate follows it
        assert _EVENTS[-1] == "hint:applied"

    def test_decline_aborts_before_any_mutation(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_no)
        with pytest.raises(Aborted):
            _lifecycle(_PRESENT).apply_with_overlap()
        assert _EVENTS == []  # nothing touched GCP


class TestUp:
    def test_outputs_present_bootstrap_apply_wait_dns(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _lifecycle(_PRESENT).up()
        # bootstrap FIRST, then the overlap; up's present branch waits the cluster foreground (no
        # second secrets push, no apply_and_wire) then re-points DNS.
        assert _EVENTS[0] == "bootstrap"
        assert _EVENTS.index("predispatch") < _EVENTS.index("apply") < _EVENTS.index("cluster")
        assert _EVENTS.index("cluster") < _EVENTS.index("dns_update")
        assert _EVENTS[-1] == "hint:up"

    def test_first_ever_identity_then_apply_and_wire(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _lifecycle(_FIRST_EVER).up()
        assert _EVENTS[0] == "bootstrap"
        assert _EVENTS.index("staging:ci") < _EVENTS.index("predispatch") < _EVENTS.index("apply")
        assert _EVENTS[-1] == "hint:up"


class TestCancelOnError:
    def test_apply_failure_cancels_the_pre_dispatched_run(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        # A genuine cluster fault (not ClusterUnreachable) during the wired apply → cancel the run.
        life = _lifecycle(_PRESENT, wait_exc=RuntimeError("cluster gone"))
        with pytest.raises(RuntimeError):
            life.up()
        assert "cancel:run-1" in _EVENTS  # orphaned build reaped

    def test_cluster_unreachable_spares_the_run(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        life = _lifecycle(_PRESENT, wait_exc=ClusterUnreachable("endpoint still propagating"))
        with pytest.raises(ClusterUnreachable):
            life.up()
        assert not any(e.startswith("cancel:") for e in _EVENTS)  # deploy LEFT running


class TestWaitArPushReady:
    def test_empty_repo_skips_gate(self, capsys: pytest.CaptureFixture[str]) -> None:
        _lifecycle({}).wait_ar_push_ready()  # no artifact_registry_repository_id output
        assert "ar_wait" not in _EVENTS
        assert "skipping the AR-writable dispatch gate" in capsys.readouterr().out

    def test_writable_reports_ok(self, capsys: pytest.CaptureFixture[str]) -> None:
        _lifecycle({"artifact_registry_repository_id": "devstash"}).wait_ar_push_ready()
        assert "ar_wait" in _EVENTS
        assert "is writable by the deployer SA" in capsys.readouterr().out

    def test_not_writable_warns_but_proceeds(self, capsys: pytest.CaptureFixture[str]) -> None:
        _lifecycle(
            {"artifact_registry_repository_id": "devstash"}, ar_writable=False
        ).wait_ar_push_ready()
        assert "dispatching CI anyway" in capsys.readouterr().out


class TestSuspend:
    def test_dumps_before_destroy_then_cleans_up(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _no_write_active(monkeypatch)
        _lifecycle(_PRESENT).suspend()  # no bring-up confirm — apply keeps its own review gate
        # [#4] dump+verify BEFORE the destroying apply; best-effort cleanup after.
        assert _EVENTS.index("db_dump") < _EVENTS.index("apply")
        assert (
            _EVENTS.index("apply") < _EVENTS.index("cleanup_builds") < _EVENTS.index("cleanup_negs")
        )
        assert _EVENTS[-1] == "cleanup_negs"


class TestResume:
    def test_present_fast_path_ar_then_overlap_then_watch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _no_write_active(monkeypatch)
        _lifecycle(_PRESENT).resume()
        # Identity survived the suspend → recreate JUST the AR repo/binding, then overlap.
        assert _EVENTS.index("staging:ar") < _EVENTS.index("predispatch")
        # [#5] the was_already_live snapshot is taken BEFORE apply_plan.
        assert (
            _EVENTS.index("db_snapshot") < _EVENTS.index("apply_plan") < _EVENTS.index("apply_exec")
        )
        # overlap driver: apply → cluster reachable → restore; then DNS; then watch (last).
        assert _EVENTS.index("apply_exec") < _EVENTS.index("cluster")
        assert _EVENTS.index("cluster") < _EVENTS.index("db_restore(live=False)")
        assert _EVENTS.index("db_restore(live=False)") < _EVENTS.index("dns_update")
        assert _EVENTS[-1] == "watch:run-1"

    def test_post_down_applies_full_identity(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _no_write_active(monkeypatch)
        _lifecycle(_FIRST_EVER).resume()  # no required outputs → full WIF identity first
        assert (
            _EVENTS.index("staging:ci") < _EVENTS.index("predispatch") < _EVENTS.index("apply_plan")
        )
        assert _EVENTS[-1] == "watch:run-1"

    def test_already_live_restore_refuses_overwrite(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_yes)
        _no_write_active(monkeypatch)
        _lifecycle(_PRESENT, already_live=True).resume()  # [#5] re-run against a live env
        assert "db_restore(live=True)" in _EVENTS  # restore gets was_already_live=True → it skips

    def test_decline_aborts_before_span(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(lifecycle, "confirm", _confirm_no)
        with pytest.raises(Aborted):
            _lifecycle(_PRESENT).resume()
        assert _EVENTS == []  # nothing ran — declined before the narration span opened


def test_wire_fails_fast_without_waiting_on_the_survivor(monkeypatch: pytest.MonkeyPatch) -> None:
    # [GC-1] One task failing fast must surface WITHOUT blocking on the other's full budget: the
    # survivor blocks on an event that never fires, so a non-fail-fast join would hang past 5s.
    boom = InfraError("gh de-authenticated")
    never = threading.Event()

    class _HangingSecrets:
        def push(self) -> None:
            never.wait(timeout=5.0)  # generous ceiling; fail-fast returns long before this fires

    def _fail() -> None:
        raise boom

    life = _lifecycle(_PRESENT)
    monkeypatch.setattr(life, "_wait_cluster", _fail)
    monkeypatch.setattr(life, "secrets", _HangingSecrets())
    with pytest.raises(InfraError) as caught:
        # exercising the private join directly to prove the fail-fast property
        life._wire_cluster_and_secrets()  # pyright: ignore[reportPrivateUsage]
    never.set()  # release the survivor thread so the pool's background worker can exit cleanly
    assert caught.value is boom


def test_target_sets_stay_in_sync_with_required_outputs() -> None:
    # Parity guard: the AR push targets are a subset of the CI-identity superset (run.sh invariant).
    assert set(AR_PUSH_TARGETS) <= set(CI_IDENTITY_TARGETS)
