"""Tests for gcp/reconcile.py — the #6 adopt-vs-destroy gate + primitives + branches.

Parity port of reconcile.bats, re-architected onto the typed clients. One router patches BOTH
proc.run (reads/probes/gcloud) AND proc.long_running (the Tofu client's import_/state_rm mutations)
so every subprocess in the flow is recorded — the peer of the single gcloud()/tofu_() bats stubs.
The interactive confirm() is monkeypatched to script the yes/no sequence.

The collaborator branches assert BRANCH CHOICE (which gcloud delete / tofu import argv fired) — the
end-to-end check that the #6 gate routed to adopt vs destroy; per-command argv-parity also lives in
tests/clients/test_gcloud.py.
"""

from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.tofu import Tofu
from devstash_infra.gcp import reconcile
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.reconcile import Reconcile
from devstash_infra.shared import proc
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError, Result

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)

# A route decides (returncode, stdout) from an argv; the default routes are per-test.
RouteFn = Callable[[list[str]], "tuple[int, str]"]


def _install_router(monkeypatch: pytest.MonkeyPatch, route: RouteFn) -> list[list[str]]:
    """Patch proc.run AND proc.long_running with one router, recording every argv.

    proc.run raises ProcError on a checked non-zero (like real); proc.long_running never raises
    (the Tofu client's _raise_unless_ok does), so the Tofu mutation path behaves exactly as in prod.
    """
    calls: list[list[str]] = []

    def _fake_run(
        argv: Sequence[str],
        *,
        check: bool = True,
        capture: bool = True,
        env: object = None,
        cwd: object = None,
        input: str | None = None,
    ) -> Result:
        a = list(argv)
        calls.append(a)
        rc, out = route(a)
        result = Result(argv=a, stdout=out, stderr="", code=rc)
        if check and not result.ok:
            raise ProcError(result)
        return result

    def _fake_long_running(argv: Sequence[str], **_: object) -> Result:
        a = list(argv)
        calls.append(a)
        rc, out = route(a)
        return Result(argv=a, stdout=out, stderr="", code=rc)

    monkeypatch.setattr(proc, "run", _fake_run)
    monkeypatch.setattr(proc, "long_running", _fake_long_running)
    return calls


def _reconcile(*, auto_approve: bool = False, tf_dir: str = "tf/dev") -> Reconcile:
    return Reconcile(_CONFIG, Gcloud("proj"), Tofu(tf_dir), auto_approve=auto_approve)


def _route_all_empty(_argv: list[str]) -> tuple[int, str]:
    """Every call → exit 0, empty stdout (untracked state / not-in-GCP describe)."""
    return (0, "")


def _has_call(calls: list[list[str]], *needles: str) -> bool:
    """True iff some recorded argv contains ALL `needles` as tokens."""
    return any(all(n in call for n in needles) for call in calls)


class _Recorder:
    def __init__(self) -> None:
        self.ran = False

    def __call__(self) -> None:
        self.ran = True


def _confirms(monkeypatch: pytest.MonkeyPatch, *answers: bool) -> None:
    """Script confirm() to return the given answers in order."""
    it: Iterator[bool] = iter(answers)

    def _scripted(prompt: str, *, auto_approve: bool = False) -> bool:
        return next(it)

    monkeypatch.setattr(reconcile, "confirm", _scripted)


def _confirm_destroys_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Confirm 'Destroy …' prompts, decline everything else (the bats destroy-path stub)."""

    def _scripted(prompt: str, *, auto_approve: bool = False) -> bool:
        return prompt.startswith("Destroy ")

    monkeypatch.setattr(reconcile, "confirm", _scripted)


def _never_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail the test if confirm() is called at all (the no-prompt contract)."""

    def _fail(prompt: str, *, auto_approve: bool = False) -> bool:
        pytest.fail("confirm() was called on a no-prompt path")

    monkeypatch.setattr(reconcile, "confirm", _fail)


class TestReconcileChoose:
    def test_fix_06_auto_approve_adopts_no_prompt(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """[fix #6] AUTO_APPROVE → adopt with NO prompt; destroy NEVER fires unattended."""
        _never_prompt(monkeypatch)
        adopt, destroy = _Recorder(), _Recorder()
        reconcile.reconcile_choose("repo", adopt, destroy_action=destroy, auto_approve=True)
        assert adopt.ran and not destroy.ran

    def test_interactive_adopt_runs_adopt(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _confirms(monkeypatch, True)  # yes to adopt
        adopt, destroy = _Recorder(), _Recorder()
        reconcile.reconcile_choose("repo", adopt, destroy_action=destroy)
        assert adopt.ran and not destroy.ran

    def test_interactive_decline_adopt_then_destroy_runs_destroy(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _confirms(monkeypatch, False, True)  # no adopt, yes destroy
        adopt, destroy = _Recorder(), _Recorder()
        reconcile.reconcile_choose("repo", adopt, destroy_action=destroy)
        assert destroy.ran and not adopt.ran

    def test_fix_06_decline_both_falls_back_to_adopt(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """[fix #6] Declining BOTH prompts falls back to adopt — never leave the strand."""
        _confirms(monkeypatch, False, False)  # no adopt, no destroy
        adopt, destroy = _Recorder(), _Recorder()
        reconcile.reconcile_choose("repo", adopt, destroy_action=destroy)
        assert adopt.ran and not destroy.ran

    def test_fix_06_destroy_impossible_never_prompts_adopts(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """[fix #6] destroy_action=None (IMPOSSIBLE) → never prompts, prints the reason, adopts."""
        _never_prompt(monkeypatch)
        adopt = _Recorder()
        reconcile.reconcile_choose(
            "wif-pool", adopt, destroy_action=None, destroy_note="soft-deleted, reserved 30d"
        )
        assert adopt.ran
        assert "soft-deleted, reserved 30d" in capsys.readouterr().out


class TestInState:
    def test_exact_match_not_fooled_by_substring(self, monkeypatch: pytest.MonkeyPatch) -> None:
        addr = "google_sql_database_instance.main"
        _install_router(monkeypatch, lambda a: (0, f"{addr}[0]\n"))  # a prefix line, not exact
        assert reconcile.in_state(Tofu("tf/dev"), addr) is False

    def test_exact_match_true(self, monkeypatch: pytest.MonkeyPatch) -> None:
        addr = "google_sql_database_instance.main"
        _install_router(monkeypatch, lambda a: (0, f"{addr}\n"))
        assert reconcile.in_state(Tofu("tf/dev"), addr) is True


class TestReadActiveToggle:
    def test_reads_true_false_toggle(self, tmp_path: Path) -> None:
        (tmp_path / "active.auto.tfvars").write_text(
            "environment_active = true\ndb_active = false\n"
        )
        assert reconcile.read_active_toggle(str(tmp_path), "environment_active") == "true"
        assert reconcile.read_active_toggle(str(tmp_path), "db_active") == "false"

    def test_empty_when_file_absent(self, tmp_path: Path) -> None:
        assert reconcile.read_active_toggle(str(tmp_path), "environment_active") == ""

    def test_empty_when_key_absent(self, tmp_path: Path) -> None:
        (tmp_path / "active.auto.tfvars").write_text("other = true\n")
        assert reconcile.read_active_toggle(str(tmp_path), "environment_active") == ""


class TestAdopt:
    _ADDR = "addr.x"

    def test_import_success_adopted(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _install_router(monkeypatch, lambda a: (0, "Import successful"))
        reconcile.adopt(Tofu("tf/dev"), self._ADDR, "id-123", "the DB")
        assert "adopted into state" in capsys.readouterr().out

    def test_import_fails_but_in_state_skips_warn(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        def _route(a: list[str]) -> tuple[int, str]:
            if "import" in a:
                return (1, "already managed")
            return (0, f"{self._ADDR}\n")  # state list → tracked

        _install_router(monkeypatch, _route)
        reconcile.adopt(Tofu("tf/dev"), self._ADDR, "id-123", "the DB")
        assert "already managed in state — import skipped" in capsys.readouterr().out

    def test_import_fails_and_absent_fatal_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _route(a: list[str]) -> tuple[int, str]:
            if "import" in a:
                return (1, "boom")
            return (0, "")  # state list → still absent

        _install_router(monkeypatch, _route)
        with pytest.raises(InfraError):
            reconcile.adopt(Tofu("tf/dev"), self._ADDR, "id-123", "the DB", fatal=True)

    def test_import_fails_and_absent_nonfatal_does_not_raise(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _route(a: list[str]) -> tuple[int, str]:
            return (1, "boom") if "import" in a else (0, "")

        _install_router(monkeypatch, _route)
        reconcile.adopt(Tofu("tf/dev"), self._ADDR, "id-123", "the quota pref", fatal=False)


class TestPscSubnetReplace:
    _ADDR = "module.network.google_compute_subnetwork.psc"

    def test_legacy_purpose_emits_replace(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _install_router(monkeypatch, lambda a: (0, '  purpose = "PRIVATE_SERVICE_CONNECT"'))
        assert reconcile.psc_subnet_replace(Tofu("tf/dev")) == f"-replace={self._ADDR}"

    def test_ordinary_purpose_emits_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _install_router(monkeypatch, lambda a: (0, '  purpose = "PRIVATE"'))
        assert reconcile.psc_subnet_replace(Tofu("tf/dev")) is None

    def test_absent_from_state_emits_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _install_router(monkeypatch, lambda a: (1, "No instance found"))  # not tracked
        assert reconcile.psc_subnet_replace(Tofu("tf/dev")) is None


class TestReconcileDbDatabase:
    def test_db_active_false_skips_entirely(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """[suspend safety] db_active=false → skip: touching tofu/gcloud here would import a
        count→0 resource and block the very suspend (reconcile.sh:220).
        """

        def _explode(_argv: list[str]) -> tuple[int, str]:
            pytest.fail("no subprocess should run when db_active=false")

        _install_router(monkeypatch, _explode)
        _reconcile().reconcile_db_database(db_active=False)


class TestWaitSqlRunnable:
    def test_returns_immediately_when_already_runnable(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _install_router(monkeypatch, lambda a: (0, "RUNNABLE\n"))
        _reconcile().wait_sql_runnable("devstash-dev-pg")
        assert "waiting" not in capsys.readouterr().out


class TestReconcileSingletons:
    """Parity port of the reconcile.bats AR-repo + ingress-IP singleton cases. Only ONE singleton
    is present per test (its describe succeeds, others fail); state empty so every branch arms.
    """

    @staticmethod
    def _only_present(*present_needles: str) -> RouteFn:
        def _route(argv: list[str]) -> tuple[int, str]:
            if argv[0] == "tofu":
                return (0, "")  # state list → untracked; import/rm → ok
            if "describe" in argv:
                if "workload-identity-pools" in argv:
                    return (0, "")  # WIF state → empty (not in GCP)
                return (0, "") if all(n in argv for n in present_needles) else (1, "")
            return (1, "")  # delete vectors, quota delete — recorded, exit ignored (suppressed)

        return _route

    def test_ar_repo_interactive_destroy_deletes_not_imports(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _install_router(monkeypatch, self._only_present("artifacts", "repositories"))
        _confirm_destroys_only(monkeypatch)
        _reconcile().reconcile_singletons(db_active=True, env_active=True)
        assert _has_call(calls, "artifacts", "repositories", "delete", "devstash")
        ar_addr = "module.artifact_registry.google_artifact_registry_repository.docker[0]"
        assert not _has_call(calls, "import", ar_addr)

    def test_fix_06_ar_repo_auto_approve_adopts_never_deletes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """[fix #6] AUTO_APPROVE → adopt (import) the stranded AR repo, NEVER delete it."""
        calls = _install_router(monkeypatch, self._only_present("artifacts", "repositories"))
        _never_prompt(monkeypatch)
        _reconcile(auto_approve=True).reconcile_singletons(db_active=True, env_active=True)
        assert _has_call(
            calls,
            "import",
            "-lock-timeout=120s",
            "module.artifact_registry.google_artifact_registry_repository.docker[0]",
        )
        assert not _has_call(calls, "artifacts", "repositories", "delete")

    def test_ingress_ip_interactive_destroy_deletes_not_imports(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _install_router(monkeypatch, self._only_present("compute", "addresses"))
        _confirm_destroys_only(monkeypatch)
        _reconcile().reconcile_singletons(db_active=True, env_active=True)
        assert _has_call(calls, "compute", "addresses", "delete", "devstash-dev-ip", "--global")
        assert not _has_call(
            calls, "import", "module.network.google_compute_global_address.ingress_ip[0]"
        )

    def test_fix_06_ingress_ip_auto_approve_adopts_never_deletes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _install_router(monkeypatch, self._only_present("compute", "addresses"))
        _never_prompt(monkeypatch)
        _reconcile(auto_approve=True).reconcile_singletons(db_active=True, env_active=True)
        assert _has_call(
            calls,
            "import",
            "-lock-timeout=120s",
            "module.network.google_compute_global_address.ingress_ip[0]",
        )
        assert not _has_call(calls, "compute", "addresses", "delete")


class TestAdoptWif:
    _POOL_ADDR = "module.iam.google_iam_workload_identity_pool.github"
    _POOL_ID = "projects/proj/locations/global/workloadIdentityPools/github-actions"

    def _adopt_pool(self, rec: Reconcile) -> None:
        """Drive adopt_wif for the WIF pool, wiring its state/undelete/delete to the client."""
        gc = rec.gcloud
        rec.adopt_wif(
            addr=self._POOL_ADDR,
            import_id=self._POOL_ID,
            state=lambda: gc.iam.wif_pool_state("github-actions"),
            undelete=lambda: gc.iam.undelete_wif_pool("github-actions"),
            delete=lambda: gc.iam.delete_wif_pool("github-actions"),
        )

    def test_fix_06_soft_deleted_undeletes_and_imports_never_prompts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """[fix #6] A soft-DELETED WIF strand: destroy is IMPOSSIBLE (name reserved ~30d), so the
        gate NEVER prompts — it undeletes + imports (reconcile.sh:190).
        """
        monkeypatch.setattr(reconcile, "_WIF_POLL_GAP_S", 0.0)  # don't wait a real minute

        def _route(argv: list[str]) -> tuple[int, str]:
            if "undelete" in argv:
                return (0, "")
            if argv[0] == "tofu":
                return (0, "")  # state list untracked; import ok
            if "describe" in argv:
                return (0, "DELETED")  # stays DELETED → poll times out, import proceeds
            return (0, "")

        calls = _install_router(monkeypatch, _route)
        _never_prompt(monkeypatch)  # confirm must NEVER fire for a DELETED pool
        self._adopt_pool(_reconcile())
        assert _has_call(calls, "undelete")
        assert _has_call(calls, "import", "-lock-timeout=120s", self._POOL_ADDR)

    def test_absent_in_gcp_is_a_noop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Empty describe state → not in GCP → no prompt, no import (plan CREATEs it)."""
        calls = _install_router(monkeypatch, _route_all_empty)
        _never_prompt(monkeypatch)
        self._adopt_pool(_reconcile())
        assert not _has_call(calls, "import")
        assert not _has_call(calls, "undelete")


class TestPurgeStrandedSql:
    def test_absent_instance_state_rms_three_addrs_leaves_first(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Instance GONE in GCP → purge the 3 stranded addrs, leaves (user, database) BEFORE the
        instance — Terraform's own destroy order (reconcile.sh:530).
        """

        def _route(argv: list[str]) -> tuple[int, str]:
            if argv[0] == "gcloud":
                return (1, "")  # sql instances describe → absent
            if argv[0] == "tofu" and "list" in argv:
                return (0, argv[-1])  # echo the queried addr → reads as tracked
            return (0, "")  # state rm ok

        calls = _install_router(monkeypatch, _route)
        _never_prompt(monkeypatch)  # IMPOSSIBLE destroy → adopt path never prompts
        _reconcile().purge_stranded_sql()
        removed = [c[-1] for c in calls if c[0] == "tofu" and "rm" in c]
        assert removed == [
            "module.cloudsql.google_sql_user.app[0]",
            "module.cloudsql.google_sql_database.devstash[0]",
            "module.cloudsql.google_sql_database_instance.postgres[0]",
        ]

    def test_present_instance_purges_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _route(argv: list[str]) -> tuple[int, str]:
            return (0, "RUNNABLE") if argv[0] == "gcloud" else (0, "")  # instance present

        calls = _install_router(monkeypatch, _route)
        _reconcile().purge_stranded_sql()
        assert not _has_call(calls, "state", "rm")


class TestPurgeStrandedArIamBranch:
    _ADDR_A = "module.iam.google_artifact_registry_repository_iam_member.builder"
    _ADDR_B = "module.iam.google_artifact_registry_repository_iam_member.deployer"

    def _addr_file(self, tmp_path: Path) -> str:
        f = tmp_path / "ar-iam-member-addresses.txt"
        f.write_text(f"# repo-scoped AR IAM members\n{self._ADDR_A}\n\n{self._ADDR_B}\n")
        return str(f)

    def test_absent_repo_purges_stranded_members(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Repo GONE + members still tracked → the IMPOSSIBLE-destroy gate heals via the shared
        purge helper (reconcile.sh:484).
        """
        purged: list[tuple[str, str, str, str]] = []

        def _fake_purge(repo: str, region: str, project: str, addr_file: str) -> bool:
            purged.append((repo, region, project, addr_file))
            return True

        monkeypatch.setattr(reconcile, "purge_stranded_ar_iam", _fake_purge)

        def _route(argv: list[str]) -> tuple[int, str]:
            if argv[0] == "gcloud":  # artifacts repositories describe → absent
                return (1, "")
            return (0, argv[-1]) if "list" in argv else (0, "")  # every member tracked

        _install_router(monkeypatch, _route)
        _never_prompt(monkeypatch)  # IMPOSSIBLE destroy → no prompt
        _reconcile().purge_stranded_ar_iam_branch(self._addr_file(tmp_path))
        assert purged == [("devstash", "us-central1", "proj", self._addr_file(tmp_path))]

    def test_present_repo_is_a_noop(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        purged: list[str] = []

        def _fake_purge(repo: str, region: str, project: str, addr_file: str) -> bool:
            purged.append(repo)
            return True

        monkeypatch.setattr(reconcile, "purge_stranded_ar_iam", _fake_purge)
        _install_router(monkeypatch, _route_all_empty)  # repo present → describe exit 0 → managed
        _reconcile().purge_stranded_ar_iam_branch(self._addr_file(tmp_path))
        assert purged == []


class TestReconcileStateDriver:
    def test_returns_psc_replace_and_runs_branches(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """The driver folds a PSC -replace into its return, and every branch self-disables on a
        clean env (nothing tracked, nothing present) → no destructive argv.
        """
        tf_dir = tmp_path / "tf"
        tf_dir.mkdir()
        (tf_dir / "active.auto.tfvars").write_text("environment_active = true\ndb_active = true\n")
        addr_file = tmp_path / "ar-iam.txt"
        addr_file.write_text("# none tracked\n")

        psc_addr = "module.network.google_compute_subnetwork.psc"

        def _route(argv: list[str]) -> tuple[int, str]:
            if argv[0] == "tofu" and "show" in argv and psc_addr in argv:
                return (0, '  purpose = "PRIVATE_SERVICE_CONNECT"')
            if argv[0] == "tofu":
                return (0, "")  # state list untracked; output -json empty
            return (1, "")  # every gcloud describe → absent (clean env)

        calls = _install_router(monkeypatch, _route)
        rec = Reconcile(_CONFIG, Gcloud("proj"), Tofu(str(tf_dir)), auto_approve=True)
        replace = rec.run(str(addr_file))
        assert replace == [f"-replace={psc_addr}"]
        assert not _has_call(calls, "state", "rm")
        assert not _has_call(calls, "delete")
