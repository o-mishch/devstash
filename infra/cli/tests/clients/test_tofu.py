"""Tests for clients/tofu.py — the closed, typed OpenTofu client.

argv-parity lives here: each test asserts the exact `tofu -chdir=… <subcommand> …` emitted,
plus the error contract (reads tolerant → parsed value; mutations raise ProcError) and the
incident behaviors encoded in the method signatures (#2 output -json, #3 no `exclude` param,
#7 refresh-404).
"""

import inspect
from collections.abc import Sequence

import pytest

from devstash_infra.clients.tofu import Tofu
from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result

_CHDIR = "-chdir=tf/dev"


def _route_run(
    monkeypatch: pytest.MonkeyPatch, *, out: str = "", ok: bool = True
) -> list[list[str]]:
    """Route proc.run (the READ path): record argv, return a scripted Result."""
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        result = Result(args, out, "" if ok else "boom", 0 if ok else 1)
        if check and not ok:
            raise ProcError(result)
        return result

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def _route_locked(monkeypatch: pytest.MonkeyPatch, results: list[Result]) -> list[list[str]]:
    """Route proc.long_running (the MUTATION path): feed a scripted Result sequence."""
    calls: list[list[str]] = []
    pending = list(results)

    def _fake_long_running(argv: Sequence[str], **_: object) -> Result:
        calls.append(list(argv))
        return pending.pop(0)

    monkeypatch.setattr(proc, "long_running", _fake_long_running)
    return calls


# ── #3: the multiflag -exclude bug is unrepresentable — destroy() has no `exclude` param ──────
def test_destroy_has_no_exclude_parameter() -> None:
    assert "exclude" not in inspect.signature(Tofu.destroy).parameters


# ── reads (tolerant) ──────────────────────────────────────────────────────────
class TestReads:
    def test_init_emits_backend_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch)
        Tofu("tf/dev").init("proj-tfstate-dev")
        assert calls == [["tofu", _CHDIR, "init", "-backend-config=bucket=proj-tfstate-dev"]]

    def test_fix_02_output_json_uses_json_never_raw(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch, out='{"app_domain":{"value":"gke.devstash.one"}}')
        outputs = Tofu("tf/dev").output_json()
        assert calls == [["tofu", _CHDIR, "output", "-json"]]  # [#2] -json, never -raw
        assert outputs.value("app_domain") == "gke.devstash.one"

    def test_output_json_empty_state_is_tolerant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, out="", ok=False)  # output-less/destroyed state
        assert Tofu("tf/dev").output_json().value("anything") == ""

    def test_state_list_returns_matching_addresses(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch, out="addr.a\naddr.b")
        assert Tofu("tf/dev").state_list("addr") == ["addr.a", "addr.b"]
        assert calls == [["tofu", _CHDIR, "state", "list", "addr"]]

    def test_state_show_untracked_is_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, out="", ok=False)
        assert Tofu("tf/dev").state_show("addr.x") == ""


# ── mutations (lock-aware, raise) ─────────────────────────────────────────────
class TestMutations:
    def test_apply_emits_argv_and_raises_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        argv = ["tofu", _CHDIR, "apply", "-lock-timeout=120s", "p.tfplan"]
        calls = _route_locked(monkeypatch, [Result(argv, "", "", 0)])
        Tofu("tf/dev").apply(plan_file="p.tfplan", lock_timeout="120s")
        assert calls == [argv]
        _route_locked(monkeypatch, [Result(argv, "boom", "", 1)])
        with pytest.raises(ProcError):
            Tofu("tf/dev").apply(plan_file="p.tfplan", lock_timeout="120s")

    def test_apply_targeted_form(self, monkeypatch: pytest.MonkeyPatch) -> None:
        argv = ["tofu", _CHDIR, "apply", "-auto-approve", "-refresh=false", "-target=m.gke.x[0]"]
        calls = _route_locked(monkeypatch, [Result(argv, "", "", 0)])
        Tofu("tf/dev").apply(auto_approve=True, refresh=False, targets=("m.gke.x[0]",))
        assert calls == [argv]

    def test_destroy_emits_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        argv = ["tofu", _CHDIR, "destroy", "-auto-approve", "-refresh=false"]
        calls = _route_locked(monkeypatch, [Result(argv, "", "", 0)])
        Tofu("tf/dev").destroy(auto_approve=True, refresh=False)
        assert calls == [argv]

    def test_import_with_lock_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        argv = ["tofu", _CHDIR, "import", "-lock-timeout=120s", "addr.x", "id-1"]
        calls = _route_locked(monkeypatch, [Result(argv, "", "", 0)])
        Tofu("tf/dev").import_("addr.x", "id-1", lock_timeout="120s")
        assert calls == [argv]

    def test_state_rm_and_force_unlock(self, monkeypatch: pytest.MonkeyPatch) -> None:
        rm = ["tofu", _CHDIR, "state", "rm", "addr.x"]
        unlock = ["tofu", _CHDIR, "force-unlock", "-force", "gen-42"]
        calls = _route_locked(monkeypatch, [Result(rm, "", "", 0), Result(unlock, "", "", 0)])
        Tofu("tf/dev").state_rm("addr.x")
        Tofu("tf/dev").force_unlock("gen-42")
        assert calls == [rm, unlock]

    def test_fix_07_plan_retries_refreshless_only_on_404(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # [#7] first plan hits the vanished-resource 404 → ONE retry with -refresh=false.
        first = ["tofu", _CHDIR, "plan", "-out=p.tfplan"]
        retry = ["tofu", _CHDIR, "plan", "-refresh=false", "-out=p.tfplan"]
        calls = _route_locked(
            monkeypatch,
            [Result(first, "Error 404: resourceNotFound", "", 1), Result(retry, "", "", 0)],
        )
        Tofu("tf/dev").plan(out="p.tfplan")
        assert calls == [first, retry]

    def test_plan_folds_replace_and_targets(self, monkeypatch: pytest.MonkeyPatch) -> None:
        argv = [
            "tofu",
            _CHDIR,
            "plan",
            "-lock-timeout=120s",
            "-replace=m.psc.subnet",
            "-target=m.gke.x",
            "-out=p.tfplan",
        ]
        calls = _route_locked(monkeypatch, [Result(argv, "", "", 0)])
        Tofu("tf/dev").plan(
            out="p.tfplan", lock_timeout="120s", replace=("m.psc.subnet",), targets=("m.gke.x",)
        )
        assert calls == [argv]

    def test_fix_07_plan_does_not_retry_on_a_real_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        argv = ["tofu", _CHDIR, "plan", "-out=p.tfplan"]
        calls = _route_locked(monkeypatch, [Result(argv, "Error: invalid provider config", "", 1)])
        with pytest.raises(ProcError):
            Tofu("tf/dev").plan(out="p.tfplan")
        assert calls == [argv]  # exactly one attempt — no blanket refreshless retry


def test_lock_failure_drives_recovery_then_retries_once(monkeypatch: pytest.MonkeyPatch) -> None:
    argv = ["tofu", _CHDIR, "apply", "-lock-timeout=120s", "p.tfplan"]
    calls = _route_locked(
        monkeypatch,
        [Result(argv, "Error acquiring the state lock", "", 1), Result(argv, "", "", 0)],
    )
    recovered: list[bool] = []

    def _recover() -> bool:
        recovered.append(True)
        return True

    Tofu("tf/dev", recover=_recover).apply(plan_file="p.tfplan", lock_timeout="120s")
    assert recovered == [True]
    assert calls == [argv, argv]  # applied, recover, applied again
