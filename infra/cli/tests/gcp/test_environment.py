"""Tests for environment.py — the Environment domain object's apply lifecycle.

Ports the old gcp/apply.py suite onto the new paradigm: Environment holds typed clients, the
lifecycle methods RAISE (no exit-code checks), and the load-bearing orderings are asserted:

  - #9 (IAM cooldown): `apply_exec` releases the provisioning marker strictly AFTER the cooldown
    sleep — never the instant `tofu apply` returns (the race that 403'd a real suspend build).
  - `apply_plan`'s review gate: marker is written before the plan, cleared on plan-failure or a
    declined confirm, and KEPT when confirmed (so `apply_exec` can consume it).

Tofu `plan`/`apply` route through `proc.long_running`; `init` + the marker cp/rm route through
`proc.run` — both patched into a shared event log. `Reconcile`/`Gke` are replaced with fakes (their
own suites cover them); `sleep`/`prune`/`confirm` are injected/patched so nothing really waits.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.tofu import Tofu
from devstash_infra.gcp import environment
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.environment import ApplyDeps, Environment
from devstash_infra.shared import proc
from devstash_infra.shared.errors import Aborted, PlanRejected
from devstash_infra.shared.proc import ProcError, Result

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)


class _EventClock:
    """A Clock whose `sleep` records into the shared event log — the #9 cooldown-ordering probe.

    Only `sleep` is exercised (the IAM cooldown); `monotonic`/`now` exist to satisfy the Clock
    protocol structurally so this can be injected wherever a `Clock` is expected.
    """

    def __init__(self, events: list[str]) -> None:
        self._events = events

    def monotonic(self) -> float:
        return 0.0

    def now(self) -> datetime:
        return datetime(2026, 1, 1, tzinfo=UTC)

    def sleep(self, _seconds: float) -> None:
        self._events.append("sleep")


def _make(tf_dir: str, events: list[str]) -> Environment:
    """An Environment wired with real clients; the clock's `sleep` records into the event log."""
    return Environment(_CONFIG, tofu=Tofu(tf_dir), gcloud=Gcloud("proj"), clock=_EventClock(events))


def _route(
    monkeypatch: pytest.MonkeyPatch,
    events: list[str],
    *,
    plan_ok: bool = True,
    apply_ok: bool = True,
) -> None:
    """Route long_running (plan/apply) + proc.run (init, marker cp/rm); tag order into events."""

    def _fake_long_running(argv: Sequence[str], **_: object) -> Result:
        args = list(argv)
        chdir = args[1].removeprefix("-chdir=")  # ["tofu", "-chdir=…", "<sub>", …]
        sub = args[2]
        events.append(sub)
        ok = plan_ok if sub == "plan" else apply_ok
        if sub == "plan" and ok:
            # A real `tofu plan -out=<f>` writes the plan file apply_exec then consumes.
            out = next((a.removeprefix("-out=") for a in args if a.startswith("-out=")), "")
            if out:
                (Path(chdir) / out).write_text("plan")
        return Result(args, "" if ok else "boom", "", 0 if ok else 1)

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        if "cp" in args and args[-1].endswith(".provisioning"):
            events.append("mark")
        elif "rm" in args and args[-1].endswith(".provisioning"):
            events.append("clear")
        return Result(args, "", "", 0)

    def _fake_prune(_prefix: str, _keep: int) -> None:
        events.append("prune")

    monkeypatch.setattr(proc, "long_running", _fake_long_running)
    monkeypatch.setattr(proc, "run", _fake_run)
    monkeypatch.setattr(environment, "prune_dump_versions", _fake_prune)


# ── apply_exec [#9 IAM cooldown] ──────────────────────────────────────────────
class TestApplyExecFix9:
    def test_fix_09_holds_marker_until_after_cooldown(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        events: list[str] = []
        _route(monkeypatch, events)
        (tmp_path / environment.PLAN_FILE).write_text("plan")
        _make(str(tmp_path), events).apply_exec()
        # THE fix: the marker is cleared strictly AFTER the cooldown sleep.
        assert events == ["apply", "prune", "sleep", "clear"]

    def test_missing_plan_raises_plan_rejected_and_clears_marker(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        events: list[str] = []
        _route(monkeypatch, events)
        with pytest.raises(PlanRejected):
            _make("tf/dev", events).apply_exec()  # no plan file on disk
        assert "apply" not in events
        assert events == ["clear"]  # marker released, nothing applied

    def test_apply_failure_raises_and_clears_marker_without_cooldown(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        events: list[str] = []
        _route(monkeypatch, events, apply_ok=False)
        (tmp_path / environment.PLAN_FILE).write_text("plan")
        with pytest.raises(ProcError):
            _make(str(tmp_path), events).apply_exec()
        assert "sleep" not in events  # no cooldown on the failure path
        assert "prune" not in events
        assert events == ["apply", "clear"]  # applied, failed, marker released immediately


# ── apply_plan (review gate + marker) ─────────────────────────────────────────
class _FakeReconcile:
    """Stands in for the drift-heal collaborator: records that it ran, yields no -replace."""

    def __init__(self, *_a: object, **_k: object) -> None:
        pass

    def run(self, _ar_iam_addr_file: str) -> list[str]:
        return []


def _deps() -> ApplyDeps:
    def _noop() -> None:
        return None

    return ApplyDeps(
        ensure_tfvars=_noop,
        require_state_bucket=_noop,
        wait_for_no_autosuspend_build=_noop,
        ar_iam_addr_file="/data/ar-iam.txt",
    )


def _confirm_yes(*_a: object, **_k: object) -> bool:
    return True


def _confirm_no(*_a: object, **_k: object) -> bool:
    return False


class TestApplyPlan:
    def _arm(
        self, monkeypatch: pytest.MonkeyPatch, events: list[str], *, plan_ok: bool = True
    ) -> None:
        _route(monkeypatch, events, plan_ok=plan_ok)
        monkeypatch.setattr(environment, "Reconcile", _FakeReconcile)

    def test_confirmed_skips_prompt_and_keeps_marker(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        events: list[str] = []
        self._arm(monkeypatch, events)

        def _must_not_confirm(*_a: object, **_k: object) -> bool:
            raise AssertionError("confirm must not be called when confirmed=True")

        monkeypatch.setattr(environment, "confirm", _must_not_confirm)
        _make(str(tmp_path), events).apply_plan(_deps(), confirmed=True)
        assert events == ["mark", "plan"]  # no clear — marker stays for apply_exec

    def test_decline_clears_plan_and_marker_then_raises_aborted(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        events: list[str] = []
        self._arm(monkeypatch, events)
        monkeypatch.setattr(environment, "confirm", _confirm_no)
        with pytest.raises(Aborted):
            _make(str(tmp_path), events).apply_plan(_deps())
        assert events[0] == "mark"
        assert events[-1] == "clear"  # marker released on abort

    def test_plan_failure_clears_marker_and_raises_plan_rejected(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        events: list[str] = []
        self._arm(monkeypatch, events, plan_ok=False)
        with pytest.raises(PlanRejected):
            _make(str(tmp_path), events).apply_plan(_deps())
        assert events[-1] == "clear"


# ── apply (serial plan → apply → fetch-creds) ─────────────────────────────────
class _FakeGke:
    """Stands in for the cluster-targeting collaborator; records the soft credential fetch."""

    def __init__(self, events: list[str]) -> None:
        self._events = events

    def use_cluster_soft(self, *, message: str | None = None) -> bool:
        self._events.append("fetch-creds")
        return True


class TestApply:
    def test_serial_path_plans_applies_then_fetches_creds(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        events: list[str] = []
        _route(monkeypatch, events)

        def _make_gke(*_a: object, **_k: object) -> _FakeGke:
            return _FakeGke(events)

        monkeypatch.setattr(environment, "Reconcile", _FakeReconcile)
        monkeypatch.setattr(environment, "confirm", _confirm_yes)
        monkeypatch.setattr(environment, "Gke", _make_gke)
        _make(str(tmp_path), events).apply(_deps())
        # Full lifecycle order: mark → plan → apply → prune → sleep → clear → creds.
        assert events == ["mark", "plan", "apply", "prune", "sleep", "clear", "fetch-creds"]


# ── staging_apply (targeted plan → apply the reviewed plan file, no marker) ────
class TestStagingApply:
    def _capture(self, monkeypatch: pytest.MonkeyPatch, calls: list[list[str]]) -> None:
        """Record the full plan/apply argv (targets + plan-file) while writing the staged plan."""

        def _fake_long_running(argv: Sequence[str], **_: object) -> Result:
            args = list(argv)
            chdir = args[1].removeprefix("-chdir=")
            sub = args[2]
            calls.append([sub, *args[3:]])
            if sub == "plan":
                out = next((a.removeprefix("-out=") for a in args if a.startswith("-out=")), "")
                if out:
                    (Path(chdir) / out).write_text("plan")
            return Result(args, "", "", 0)

        def _fake_run(argv: Sequence[str], **_: object) -> Result:
            return Result(list(argv), "", "", 0)

        monkeypatch.setattr(proc, "long_running", _fake_long_running)
        monkeypatch.setattr(proc, "run", _fake_run)
        monkeypatch.setattr(environment, "Reconcile", _FakeReconcile)

    def test_plans_targets_to_file_then_applies_that_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        calls: list[list[str]] = []
        self._capture(monkeypatch, calls)
        targets = ["module.iam.google_service_account.deployer"]
        _make(str(tmp_path), []).staging_apply(_deps(), label="CI identity", targets=targets)

        plan_argv = next(c for c in calls if c[0] == "plan")
        apply_argv = next(c for c in calls if c[0] == "apply")
        # PLAN carries the -target subgraph + writes the staging plan file
        # (plan-first: no blind apply).
        assert "-target=module.iam.google_service_account.deployer" in plan_argv
        assert f"-out={environment.STAGING_PLAN_FILE}" in plan_argv
        # APPLY consumes EXACTLY that reviewed staging plan file — never a re-plan.
        assert apply_argv[-1] == environment.STAGING_PLAN_FILE
        # The staging plan file is cleaned up afterwards (both cwd + -chdir spots).
        assert not (tmp_path / environment.STAGING_PLAN_FILE).exists()

    def test_no_marker_written(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        events: list[str] = []
        _route(monkeypatch, events)
        monkeypatch.setattr(environment, "Reconcile", _FakeReconcile)
        _make(str(tmp_path), events).staging_apply(
            _deps(), label="AR push target", targets=["module.artifact_registry.x"]
        )
        # The provisioning marker spans the FULL apply, not this pre-apply — so
        # neither mark nor clear.
        assert events == ["plan", "apply"]
