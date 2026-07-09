"""Tests for gcp/teardown.py — the Teardown collaborator + incident fixes #3, #8, #14.

Parity port of suspend-down.bats, re-architected onto the typed clients. Recording fakes stand in
for the `Tofu` and `Gcloud` clients — the tests assert the BEHAVIOR (which client op fires, in what
order, with which address/version), not raw argv (that parity lives in tests/clients/*). Incident
fixes: #3 (destroy carries no `-exclude` — structural in the client; here: shelve→destroy→restore
order + a plain destroy), #8 (operator-confirmed PSC retry), #14 (newest-ENABLED re-import id).
"""

from pathlib import Path

import pytest

from devstash_infra.gcp import teardown
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.teardown import Teardown, set_active_state
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.errors import Aborted, InfraError
from devstash_infra.shared.proc import ProcError, Result
from tests.doubles import ManualClock

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)
_PSC_ERROR = (
    "Error: Error when reading or editing ServiceConnectionPolicy: googleapi: Error 400: "
    "Cannot delete ServiceConnectionPolicy projects/p/locations/us-central1/"
    "serviceConnectionPolicies/devstash-dev-memorystore-psc because it still has 2 PSC "
    "Connections associated with it: failed precondition"
)
_DELPROT_ERROR = (
    "Error: failed to delete instance because deletion_protection is set to true. Set it to "
    "false to proceed with instance deletion"
)
_SQL_ADDR = "module.cloudsql.google_sql_database_instance.postgres[0]"
_GKE_ADDR = "module.gke.google_container_cluster.primary[0]"
_APP_CFG = "module.iam.google_secret_manager_secret.app_config"
_OPS_CFG = "google_secret_manager_secret.ops_config"
# The 5 prevent_destroy addrs — the parity spec (mirrors teardown._PROTECTED_SECRET_ADDRS).
_PROTECTED = (
    "module.iam.google_secret_manager_secret.app_config",
    "module.iam.google_secret_manager_secret_version.app_config",
    "module.iam.google_secret_manager_secret_iam_member.app_access",
    "google_secret_manager_secret.ops_config",
    "google_secret_manager_secret_version.ops_config[0]",
)


def _proc_error(stdout: str = "", stderr: str = "boom") -> ProcError:
    return ProcError(Result(["tofu"], stdout, stderr, 1))


# ── recording fake clients ────────────────────────────────────────────────────
class _FakeTofu:
    """Records every op with its semantic args; scriptable for per-op failures + destroy errors."""

    def __init__(
        self,
        *,
        state: dict[str, str] | None = None,
        outputs: dict[str, str] | None = None,
        destroy_errors: list[str] | None = None,
        fail: set[str] | None = None,
        import_all_fail: bool = False,
        tf_dir: str = "tf/dev",
    ) -> None:
        self.tf_dir = tf_dir
        self._state = state or {}
        self._outputs = outputs or {}
        self._destroy_errors = list(destroy_errors or [])
        self._fail = fail or set()
        self._import_all_fail = import_all_fail
        self.calls: list[tuple[str, object]] = []
        self.imports: list[tuple[str, str]] = []

    def state_show(self, address: str) -> str:
        self.calls.append(("state_show", address))
        return self._state.get(address, "")

    def output_json(self) -> TofuOutputs:
        self.calls.append(("output_json", None))
        return TofuOutputs.model_validate({k: {"value": v} for k, v in self._outputs.items()})

    def init(self, backend_bucket: str) -> None:
        self.calls.append(("init", backend_bucket))

    def apply(
        self,
        *,
        plan_file: str = "",
        lock_timeout: str = "",
        auto_approve: bool = False,
        refresh: bool = True,
        targets: tuple[str, ...] = (),
    ) -> None:
        self.calls.append(("apply", (auto_approve, refresh, tuple(targets))))
        if any(t in self._fail for t in targets):
            raise _proc_error()

    def destroy(
        self, *, auto_approve: bool = False, refresh: bool = True, targets: tuple[str, ...] = ()
    ) -> None:
        self.calls.append(("destroy", (auto_approve, refresh, tuple(targets))))
        if self._destroy_errors:
            raise _proc_error(stdout=self._destroy_errors.pop(0))

    def state_rm(self, address: str) -> None:
        self.calls.append(("state_rm", address))
        if address in self._fail:
            raise _proc_error()

    def import_(self, address: str, import_id: str, *, lock_timeout: str = "") -> None:
        self.calls.append(("import_", (address, import_id)))
        self.imports.append((address, import_id))
        if self._import_all_fail or address in self._fail:
            raise _proc_error()

    # test helpers -------------------------------------------------------------
    def ops(self, name: str) -> list[object]:
        return [args for op, args in self.calls if op == name]


class _FakeCompute:
    def __init__(
        self, *, router: bool = False, network: bool = False, delete_router_fails: bool = False
    ) -> None:
        self._router = router
        self._network = network
        self._delete_router_fails = delete_router_fails
        self.calls: list[str] = []

    def router_exists(self, name: str, *, region: str) -> bool:
        return self._router

    def delete_router(self, name: str, *, region: str) -> None:
        self.calls.append(f"delete_router:{name}")
        if self._delete_router_fails:
            raise _proc_error()

    def network_exists(self, vpc: str) -> bool:
        return self._network

    def delete_global_address(self, name: str) -> None:
        self.calls.append(f"delete_global_address:{name}")

    def reap_leaked_negs(self, vpc: str) -> None:
        self.calls.append(f"reap_leaked_negs:{vpc}")


class _FakeStorage:
    def __init__(self, *, bucket: bool = False) -> None:
        self._bucket = bucket
        self.emptied: list[str] = []

    def bucket_exists(self, uri: str) -> bool:
        return self._bucket

    def empty_bucket(self, uri: str) -> None:
        self.emptied.append(uri)


class _FakeServices:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def delete_vpc_peering(self, network: str) -> None:
        self.calls.append(f"delete_vpc_peering:{network}")


class _FakeSecrets:
    def __init__(self, versions: dict[str, str] | None = None) -> None:
        self._versions = versions or {}

    def newest_version(self, name: str) -> str:
        return self._versions.get(name, "")


class _FakeGcloud:
    def __init__(
        self,
        *,
        compute: _FakeCompute | None = None,
        storage: _FakeStorage | None = None,
        services: _FakeServices | None = None,
        secrets: _FakeSecrets | None = None,
    ) -> None:
        self.compute = compute or _FakeCompute()
        self.storage = storage or _FakeStorage()
        self.services = services or _FakeServices()
        self.secrets = secrets or _FakeSecrets()


def _teardown(tofu: _FakeTofu, gcloud: _FakeGcloud | None = None) -> Teardown:
    return Teardown(
        _CONFIG,
        gcloud or _FakeGcloud(),  # type: ignore[arg-type]  # structural stand-in for Gcloud
        tofu,  # type: ignore[arg-type]  # structural stand-in for Tofu
        clock=ManualClock(),
    )


def _yes(_prompt: str, *, auto_approve: bool = False) -> bool:
    return True


def _no(_prompt: str, *, auto_approve: bool = False) -> bool:
    return False


def _imported(tofu: _FakeTofu, needle: str) -> bool:
    """True iff some import_ call's `addr id` string contained `needle`."""
    return any(needle in f"{addr} {iid}" for addr, iid in tofu.imports)


# ── #8 PSC string match (pure) ───────────────────────────────────────────────
class TestPscStillAttached:
    def test_fix_08_matches_real_gcp_error(self) -> None:
        assert teardown.psc_connections_still_attached(_PSC_ERROR) is True

    def test_fix_08_rejects_unrelated_failure(self) -> None:
        assert teardown.psc_connections_still_attached(_DELPROT_ERROR) is False

    def test_fix_08_rejects_empty(self) -> None:
        assert teardown.psc_connections_still_attached("") is False


# ── deletion_protection drift correction ─────────────────────────────────────
class TestReconcileDeletionProtection:
    def test_corrects_cloud_sql_when_state_true(self) -> None:
        tofu = _FakeTofu(state={_SQL_ADDR: "    deletion_protection = true\n"})
        _teardown(tofu).reconcile_deletion_protection()
        assert tofu.ops("apply") == [(True, False, (_SQL_ADDR,))]

    def test_leaves_gke_alone_when_state_false(self) -> None:
        tofu = _FakeTofu(state={_GKE_ADDR: "    deletion_protection = false\n"})
        _teardown(tofu).reconcile_deletion_protection()
        assert tofu.ops("apply") == []

    def test_skips_address_absent_from_state(self) -> None:
        tofu = _FakeTofu(state={})
        _teardown(tofu).reconcile_deletion_protection()
        assert tofu.ops("apply") == []

    def test_failed_correction_warns_not_raises(self, capsys: pytest.CaptureFixture[str]) -> None:
        tofu = _FakeTofu(state={_SQL_ADDR: "deletion_protection = true"}, fail={_SQL_ADDR})
        _teardown(tofu).reconcile_deletion_protection()  # no raise
        assert "could not pre-correct deletion_protection" in capsys.readouterr().out


# ── shelve / restore [fix #3, #14] ───────────────────────────────────────────
class TestShelveProtectedSecrets:
    def test_fix_03_state_rms_present_skips_absent(self) -> None:
        present = {
            "module.iam.google_secret_manager_secret.app_config": "x",
            "module.iam.google_secret_manager_secret_version.app_config": "x",
            "google_secret_manager_secret.ops_config": "x",
        }
        tofu = _FakeTofu(state=present)
        _teardown(tofu).shelve_protected_secrets()
        assert tofu.ops("state_rm") == list(present)
        assert "module.iam.google_secret_manager_secret_iam_member.app_access" not in tofu.ops(
            "state_rm"
        )

    def test_failed_rm_warns_continues(self, capsys: pytest.CaptureFixture[str]) -> None:
        present: dict[str, str] = dict.fromkeys(_PROTECTED, "x")
        tofu = _FakeTofu(state=present, fail={_APP_CFG})
        _teardown(tofu).shelve_protected_secrets()
        assert f"could not shelve {_APP_CFG}" in capsys.readouterr().out


class TestRestoreProtectedSecrets:
    def test_fix_14_reimports_secret_newest_enabled_version_and_member(self) -> None:
        sa = "devstash-app@proj.iam.gserviceaccount.com"
        tofu = _FakeTofu(outputs={"app_service_account_email": sa})
        gcloud = _FakeGcloud(
            secrets=_FakeSecrets({"devstash-app-config": "14", "devstash-ops-config": "3"})
        )
        _teardown(tofu, gcloud).restore_protected_secrets()
        assert _imported(tofu, f"{_APP_CFG} proj/devstash-app-config")
        assert _imported(
            tofu,
            "module.iam.google_secret_manager_secret_version.app_config "
            "projects/proj/secrets/devstash-app-config/versions/14",
        )
        assert _imported(
            tofu,
            "google_secret_manager_secret_iam_member.app_access projects/proj/secrets/"
            "devstash-app-config roles/secretmanager.secretAccessor "
            f"serviceAccount:{sa}",
        )
        assert _imported(tofu, f"{_OPS_CFG} proj/devstash-ops-config")
        assert _imported(
            tofu,
            "google_secret_manager_secret_version.ops_config[0] "
            "projects/proj/secrets/devstash-ops-config/versions/3",
        )

    def test_no_enabled_version_warns_not_raises(self, capsys: pytest.CaptureFixture[str]) -> None:
        tofu = _FakeTofu(outputs={})  # no SA output; no versions
        _teardown(tofu).restore_protected_secrets()
        out = capsys.readouterr().out
        assert "app_config has no ENABLED version to re-import" in out
        assert "no app_service_account_email output yet" in out
        assert "ops_config has no ENABLED version to re-import" in out

    def test_failed_reimport_warns_with_exact_manual_command(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        tofu = _FakeTofu(import_all_fail=True)
        _teardown(tofu).restore_protected_secrets()
        out = capsys.readouterr().out
        assert f'manual: tofu import {_APP_CFG} "proj/devstash-app-config"' in out
        assert f'manual: tofu import {_OPS_CFG} "proj/devstash-ops-config"' in out


# ── stranded router ──────────────────────────────────────────────────────────
class TestReapStrandedRouter:
    def test_noop_when_router_absent(self, capsys: pytest.CaptureFixture[str]) -> None:
        teardown = _teardown(_FakeTofu(), _FakeGcloud(compute=_FakeCompute(router=False)))
        teardown.reap_stranded_router()
        assert "deleting it directly" not in capsys.readouterr().out

    def test_deletes_untracked_live_router(self) -> None:
        compute = _FakeCompute(router=True)
        _teardown(_FakeTofu(), _FakeGcloud(compute=compute)).reap_stranded_router()
        assert compute.calls == ["delete_router:devstash-dev-router"]

    def test_failed_delete_warns(self, capsys: pytest.CaptureFixture[str]) -> None:
        compute = _FakeCompute(router=True, delete_router_fails=True)
        _teardown(_FakeTofu(), _FakeGcloud(compute=compute)).reap_stranded_router()
        assert "could not delete stranded router" in capsys.readouterr().out


# ── #3/#8 destroy retry loop ─────────────────────────────────────────────────
class TestDownDestroyWithPscRetry:
    def test_fix_08_psc_failure_confirmed_retry_succeeds_second_attempt(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(teardown, "confirm", _yes)
        tofu = _FakeTofu(destroy_errors=[_PSC_ERROR])  # first destroy PSC-fails, second succeeds
        _teardown(tofu).down_destroy_with_psc_retry(auto_approve=False)  # no raise
        assert len(tofu.ops("destroy")) == 2

    def test_fix_08_declining_retry_raises_no_loop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(teardown, "confirm", _no)
        tofu = _FakeTofu(destroy_errors=[_PSC_ERROR])
        with pytest.raises(InfraError):
            _teardown(tofu).down_destroy_with_psc_retry(auto_approve=False)
        assert len(tofu.ops("destroy")) == 1  # no retry after decline

    def test_fix_08_non_psc_failure_raises_immediately(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        called = {"confirm": 0}

        def _confirm(*_a: object, **_k: object) -> bool:
            called["confirm"] += 1
            return True

        monkeypatch.setattr(teardown, "confirm", _confirm)
        tofu = _FakeTofu(destroy_errors=[_DELPROT_ERROR])
        with pytest.raises(InfraError):
            _teardown(tofu).down_destroy_with_psc_retry(auto_approve=True)
        assert len(tofu.ops("destroy")) == 1
        assert called["confirm"] == 0  # a non-PSC error never reaches the PSC confirm


# ── down() orchestration [fix #3] ────────────────────────────────────────────
class TestDown:
    def test_fix_03_no_exclude_on_destroy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """[fix #3] the real destroy carries ZERO -exclude flags (structural — the client has no
        `exclude` param). Here: exactly one plain destroy(auto_approve, refresh=False) fires.
        """
        monkeypatch.setattr(teardown, "confirm", _yes)
        tofu = _FakeTofu()
        _teardown(tofu).down(auto_approve=True)
        assert tofu.ops("destroy") == [(True, False, ())]

    def test_shelves_before_destroy_restores_after_success(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(teardown, "confirm", _yes)
        # one secret present so shelve state-rms it; ordering read straight from the tofu call log.
        tofu = _FakeTofu(state={_APP_CFG: "x"})
        _teardown(tofu).down(auto_approve=True)
        seq = [op for op, _ in tofu.calls]
        assert seq.index("state_rm") < seq.index("destroy") < seq.index("import_")

    def test_restores_shelved_secrets_even_when_destroy_dies(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(teardown, "confirm", _yes)
        tofu = _FakeTofu(destroy_errors=[_DELPROT_ERROR])  # non-PSC → restore + raise
        with pytest.raises(InfraError):
            _teardown(tofu).down(auto_approve=True)
        assert tofu.ops("import_")  # restore ran on the raise path — never left unshelved

    def test_aborts_when_confirmation_declined(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(teardown, "confirm", _no)
        tofu = _FakeTofu()
        with pytest.raises(Aborted):
            _teardown(tofu).down(auto_approve=False)
        assert tofu.ops("destroy") == []


# ── set_active_state (tfvars write) ──────────────────────────────────────────
class TestSetActiveState:
    def test_writes_both_toggles_together(self, tmp_path: Path) -> None:
        set_active_state(str(tmp_path), environment_active=False, db_active=False)
        content = (tmp_path / "active.auto.tfvars").read_text()
        assert "environment_active = false" in content
        assert "db_active          = false" in content
