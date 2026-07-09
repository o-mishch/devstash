"""Tests for gcp/gke.py — the cluster-targeting guard [fix #10] and fail-fast join [fix #11].

Parity port of gke.bats, re-architected onto the typed clients. `use_cluster` drives the `Tofu`
client (tofu output → fake_process) + the tofu-emitted get-credentials command (fake_process) + a
fake `Kubectl` returning the active context. The join tests launch REAL OS subprocesses (as the
bats suite backgrounds real `( … ) &` jobs) so the kill-the-survivors behaviour is genuinely
exercised, not mocked.
"""

import json
from collections.abc import Mapping
from pathlib import Path

import pytest

from devstash_infra.ci.operators import ESO, RELOADER
from devstash_infra.clients.helm import HelmFailurePolicy
from devstash_infra.clients.tofu import Tofu
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.gke import Gke, wait_for_cluster
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.errors import ClusterUnreachable, InfraError
from devstash_infra.versions import Versions
from tests.conftest import ExpectFn
from tests.doubles import ManualClock

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)
_CREDS = (
    "gcloud container clusters get-credentials devstash-dev-gke --region us-central1 --project proj"
)
_OUT = ["tofu", "-chdir=tf/dev", "output", "-json"]


class _FakeKubectl:
    """Returns a scripted active context + records rollout_status waits."""

    def __init__(self, context: str = "") -> None:
        self._context = context
        self.rollouts: list[str] = []

    def current_context(self) -> str:
        return self._context

    def rollout_status(self, resource: str, *, namespace: str, timeout: str) -> None:
        self.rollouts.append(f"{namespace}/{resource}@{timeout}")


class _Install:
    """One recorded `helm upgrade --install` (the values ensure_operator passes through)."""

    def __init__(self, release: str, version: str, sets: Mapping[str, str]) -> None:
        self.release = release
        self.version = version
        self.sets = dict(sets)


class _FakeHelm:
    """Typed Helm stub: scripts `deployed_chart`/`latest_chart_version`; records repos+installs."""

    def __init__(
        self, *, deployed: str = "", latest_eso: str = "", latest_reloader: str = ""
    ) -> None:
        self._deployed = deployed
        self._latest = {ESO.chart_ref: latest_eso, RELOADER.chart_ref: latest_reloader}
        self.repos: list[str] = []
        self.installs: list[_Install] = []

    def deployed_chart(self, release: str, *, namespace: str) -> str:
        return self._deployed

    def latest_chart_version(self, chart: str) -> str:
        return self._latest.get(chart, "")

    def refresh_repo(self, name: str, url: str) -> None:
        self.repos.append(name)

    def upgrade_install(
        self,
        release: str,
        chart: str,
        *,
        namespace: str,
        version: str,
        sets: Mapping[str, str],
        failure_policy: HelmFailurePolicy,
        timeout: str,
    ) -> None:
        self.installs.append(_Install(release, version, sets))


def _gke(context: str = "", helm: _FakeHelm | None = None) -> Gke:
    return Gke(_CONFIG, Tofu("tf/dev"), _FakeKubectl(context), helm or _FakeHelm())  # type: ignore[arg-type]


def _creds_output(command: str) -> str:
    return f'{{"get_credentials_command": {{"value": "{command}"}}}}'


class TestUseClusterFix10:
    def test_fix_10_raises_when_context_is_not_gke(self, expect: ExpectFn) -> None:
        """[fix #10] get-credentials 'succeeded' but kubectl is on a non-GKE context →
        REFUSE to proceed (would otherwise mutate the wrong cluster).
        """
        expect(_OUT, stdout=_creds_output(_CREDS))
        expect(_CREDS.split(), stdout="")  # the get-credentials call itself "succeeds"
        with pytest.raises(InfraError):
            _gke("kind-local").use_cluster()

    def test_fix_10_proceeds_when_context_is_gke(self, expect: ExpectFn) -> None:
        expect(_OUT, stdout=_creds_output(_CREDS))
        expect(_CREDS.split(), stdout="")
        _gke("gke_proj_us-central1_devstash-dev-gke").use_cluster()  # no raise

    def test_raises_when_no_cluster(self, expect: ExpectFn) -> None:
        # Suspended env → get_credentials_command is a sentinel, not a gcloud command.
        expect(_OUT, stdout=_creds_output("(no cluster — run apply)"))
        with pytest.raises(InfraError):
            _gke().use_cluster()


class TestUseClusterSoft:
    def test_bails_soft_when_no_cluster(self, expect: ExpectFn) -> None:
        expect(_OUT, stdout=_creds_output("(suspended)"))
        assert _gke().use_cluster_soft() is False

    def test_returns_true_on_gke_context(self, expect: ExpectFn) -> None:
        expect(_OUT, stdout=_creds_output(_CREDS))
        expect(_CREDS.split(), stdout="")
        assert _gke("gke_proj_x_y").use_cluster_soft() is True


def _write_versions(path: Path, *, eso: str = "2.7.0", reloader: str = "2.2.14") -> Path:
    path.write_text(f"# pinned\nESO_VERSION={eso}\nRELOADER_VERSION={reloader}\n")
    return path


def _noop() -> None:
    return None


class TestEsoReloader:
    def test_eso_installs_both_then_waits_webhook(self, expect: ExpectFn, tmp_path: Path) -> None:
        """`eso` installs ESO at the pinned version, waits the webhook, then installs Reloader."""
        versions = _write_versions(tmp_path / "versions.env")
        expect(_OUT, stdout=_creds_output(_CREDS), occurrences=2)  # use_cluster in eso + reloader
        expect(_CREDS.split(), stdout="", occurrences=2)
        helm = _FakeHelm(deployed="")  # nothing deployed → both install
        kubectl = _FakeKubectl("gke_proj_us-central1_devstash-dev-gke")
        Gke(_CONFIG, Tofu("tf/dev"), kubectl, helm).eso(versions)  # type: ignore[arg-type]

        assert [(i.release, i.version) for i in helm.installs] == [
            ("external-secrets", "2.7.0"),
            ("reloader", "2.2.14"),
        ]
        assert helm.installs[0].sets == dict(ESO.sets)  # the Autopilot 50m block, in order
        # The ESO validating webhook is waited on exactly once (between the two installs).
        assert kubectl.rollouts == ["external-secrets/deploy/external-secrets-webhook@3m"]

    def test_reloader_skips_when_already_at_pinned_version(
        self, expect: ExpectFn, tmp_path: Path
    ) -> None:
        versions = _write_versions(tmp_path / "versions.env")
        expect(_OUT, stdout=_creds_output(_CREDS))
        expect(_CREDS.split(), stdout="")
        helm = _FakeHelm(deployed="reloader-2.2.14")  # skip-guard matches → no install
        Gke(_CONFIG, Tofu("tf/dev"), _FakeKubectl("gke_x"), helm).reloader(versions)  # type: ignore[arg-type]

        assert helm.installs == []
        assert helm.repos == []  # short-circuits before the repo refresh


class TestUpgradeHelm:
    def test_bumps_drifted_version_and_reinstalls(self, expect: ExpectFn, tmp_path: Path) -> None:
        versions = _write_versions(tmp_path / "versions.env")
        # use_cluster fires in upgrade_helm + the eso + reloader it reinstalls through → 3×.
        expect(_OUT, stdout=_creds_output(_CREDS), occurrences=3)
        expect(_CREDS.split(), stdout="", occurrences=3)
        helm = _FakeHelm(deployed="", latest_eso="2.8.0", latest_reloader="2.2.14")
        gke = Gke(_CONFIG, Tofu("tf/dev"), _FakeKubectl("gke_x"), helm)  # type: ignore[arg-type]

        gke.upgrade_helm(versions, ensure_tfvars=_noop, auto_approve=True)

        assert Versions.load(versions).eso == "2.8.0"  # drifted → bumped in place
        assert Versions.load(versions).reloader == "2.2.14"  # already latest → untouched
        # Reinstall through eso() picks up the freshly-written versions.
        assert [i.version for i in helm.installs] == ["2.8.0", "2.2.14"]

    def test_raises_when_latest_version_unavailable(self, expect: ExpectFn, tmp_path: Path) -> None:
        versions = _write_versions(tmp_path / "versions.env")
        expect(_OUT, stdout=_creds_output(_CREDS))
        expect(_CREDS.split(), stdout="")
        helm = _FakeHelm(deployed="", latest_eso="", latest_reloader="2.2.14")  # ESO search miss
        gke = Gke(_CONFIG, Tofu("tf/dev"), _FakeKubectl("gke_x"), helm)  # type: ignore[arg-type]
        with pytest.raises(InfraError):
            gke.upgrade_helm(versions, ensure_tfvars=_noop, auto_approve=True)
        assert helm.installs == []  # bailed before any reinstall


class _ReachKubectl:
    """Answers `cluster_info` False for the first `unreachable` probes, then True."""

    def __init__(self, unreachable: int) -> None:
        self._remaining = unreachable
        self.probes = 0

    def cluster_info(self) -> bool:
        self.probes += 1
        if self._remaining > 0:
            self._remaining -= 1
            return False
        return True


class _ReachContainer:
    """Scripts cluster_listed + teardown_in_progress for the wait_for_cluster #11 pre-gates."""

    def __init__(self, *, listed: bool = True, teardown_after: int | None = None) -> None:
        self._listed = listed
        self._teardown_after = teardown_after  # trip teardown on this poll iteration (1-based)
        self.teardown_calls = 0

    def cluster_listed(self, name: str, *, region: str) -> bool:
        return self._listed

    def teardown_in_progress(self, name: str, *, region: str) -> bool:
        self.teardown_calls += 1
        return self._teardown_after is not None and self.teardown_calls >= self._teardown_after


class _ReachGcloud:
    def __init__(self, container: _ReachContainer) -> None:
        self.container = container


class TestWaitForCluster:
    """#11 reachability wait — the three distinct failure shapes + the happy path."""

    def test_returns_once_reachable(self, capsys: pytest.CaptureFixture[str]) -> None:
        kubectl = _ReachKubectl(unreachable=2)  # answers on the 3rd probe
        gcloud = _ReachGcloud(_ReachContainer())
        wait_for_cluster(
            kubectl,  # type: ignore[arg-type]
            gcloud,  # type: ignore[arg-type]
            cluster="devstash-dev-gke",
            region="us-central1",
            attempts=5,
            gap_s=0,
            clock=ManualClock(),
        )
        assert kubectl.probes == 3
        assert "cluster reachable" in capsys.readouterr().out

    def test_absent_cluster_is_a_hard_fault(self) -> None:
        gcloud = _ReachGcloud(_ReachContainer(listed=False))
        with pytest.raises(InfraError, match="not listable") as exc:
            wait_for_cluster(
                _ReachKubectl(unreachable=0),  # type: ignore[arg-type]
                gcloud,  # type: ignore[arg-type]
                cluster="gone",
                region="us-central1",
                attempts=5,
                gap_s=0,
                clock=ManualClock(),
            )
        assert not isinstance(exc.value, ClusterUnreachable)  # hard fault → trap stays armed

    def test_teardown_aborts_immediately(self) -> None:
        # A teardown detected on the FIRST poll aborts before any reachability window is burned.
        gcloud = _ReachGcloud(_ReachContainer(teardown_after=1))
        kubectl = _ReachKubectl(unreachable=99)
        with pytest.raises(InfraError, match="TORN DOWN") as exc:
            wait_for_cluster(
                kubectl,  # type: ignore[arg-type]
                gcloud,  # type: ignore[arg-type]
                cluster="devstash-dev-gke",
                region="us-central1",
                attempts=5,
                gap_s=0,
                clock=ManualClock(),
            )
        assert not isinstance(exc.value, ClusterUnreachable)  # hard fault → trap stays armed
        assert kubectl.probes == 0  # aborted before the first kubectl probe

    def test_reachability_timeout_is_cluster_unreachable(self) -> None:
        # Cluster exists, never torn down, endpoint never answers → the trap-clearing signal.
        gcloud = _ReachGcloud(_ReachContainer())
        with pytest.raises(ClusterUnreachable, match="never answered"):
            wait_for_cluster(
                _ReachKubectl(unreachable=99),  # type: ignore[arg-type]
                gcloud,  # type: ignore[arg-type]
                cluster="devstash-dev-gke",
                region="us-central1",
                attempts=3,
                gap_s=0,
                clock=ManualClock(),
            )

    def test_empty_cluster_skips_existence_and_teardown_checks(self) -> None:
        # No tofu output → the reachability poll is the sole oracle (existence/teardown skipped).
        container = _ReachContainer(listed=False, teardown_after=1)  # would fault IF consulted
        kubectl = _ReachKubectl(unreachable=1)
        wait_for_cluster(
            kubectl,  # type: ignore[arg-type]
            _ReachGcloud(container),  # type: ignore[arg-type]
            cluster="",
            region="us-central1",
            attempts=5,
            gap_s=0,
            clock=ManualClock(),
        )
        assert container.teardown_calls == 0  # never consulted for an empty cluster name
        assert kubectl.probes == 2


class _FakeTofu:
    """output_json() returns a TofuOutputs built from a plain {name: value} dict."""

    def __init__(self, outputs: dict[str, str]) -> None:
        self._outputs = outputs

    def output_json(self) -> TofuOutputs:
        return TofuOutputs.model_validate({k: {"value": v} for k, v in self._outputs.items()})


class _StatusKubectl:
    """Scripts `get` per target + records the `selector_logs` selector."""

    def __init__(self, gets: dict[str, str]) -> None:
        self._gets = gets
        self.log_selectors: list[str] = []

    def get(
        self, target: str, *, namespace: str, output: str | None = None, sort_by: str | None = None
    ) -> str:
        return self._gets.get(target, "")

    def selector_logs(self, selector: str, *, namespace: str, tail: int) -> str:
        self.log_selectors.append(selector)
        return f"[pod] line (tail={tail})"


class _CertMgr:
    def __init__(self, state: str) -> None:
        self._state = state

    def cert_state(self, name: str) -> str:
        return self._state


class _StatusGcloud:
    def __init__(self, cert_state: str) -> None:
        self.certificate_manager = _CertMgr(cert_state)


def _ok_report(url: str) -> str:
    return '{\n  "status": "ok"\n}'


class TestStatusAndLogs:
    """Read-only display commands (gke.sh status/logs) — best-effort snapshot + pod log tail."""

    def test_status_prints_a_full_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        tofu = _FakeTofu(
            {
                "get_credentials_command": "(suspended)",  # non-gcloud → use_cluster_soft warns
                "cert_name": "devstash-cert",
                "ingress_ip_address": "1.2.3.4",
                "app_domain": "devstash.example",
            }
        )
        kubectl = _StatusKubectl(
            {
                "deploy,statefulset,job,gateway,httproute": "deployment/devstash-web 1/1",
                "pods": "devstash-web-abc Running",
                "externalsecret": "devstash-secrets True",
                "gateway/devstash-web": "devstash-web PROGRAMMED",
            }
        )
        gke = Gke(_CONFIG, tofu, kubectl, _FakeHelm())  # type: ignore[arg-type]
        gke.status(_StatusGcloud("ACTIVE"), health_report=_ok_report)  # type: ignore[arg-type]

        out = capsys.readouterr().out
        assert "deployment/devstash-web 1/1" in out  # workloads
        assert "devstash-web-abc Running" in out  # pods
        assert "devstash-secrets True" in out  # ESO sync
        assert "Cert 'devstash-cert' state: ACTIVE" in out  # Certificate Manager state
        assert "Ingress IP: 1.2.3.4" in out
        assert "App domain: devstash.example" in out
        assert '"status": "ok"' in out  # the deep-health JSON body

    def test_status_shows_dashes_and_unknown_when_suspended(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # A parked env: no tofu outputs, no cert, endpoint down — every read degrades cleanly.
        tofu = _FakeTofu({"get_credentials_command": "(suspended)"})
        gke = Gke(_CONFIG, tofu, _StatusKubectl({}), _FakeHelm())  # type: ignore[arg-type]

        def _no_report(url: str) -> str:
            return ""

        gke.status(_StatusGcloud(""), health_report=_no_report)  # type: ignore[arg-type]
        out = capsys.readouterr().out
        assert "Ingress IP: —" in out  # tf_out fallback
        assert "App domain: —" in out
        assert "state:" not in out  # no cert_name → the "Cert '…' state: …" line is skipped

    def test_logs_tails_the_web_pods(self, capsys: pytest.CaptureFixture[str]) -> None:
        tofu = _FakeTofu({"get_credentials_command": "(suspended)"})
        kubectl = _StatusKubectl({})
        gke = Gke(_CONFIG, tofu, kubectl, _FakeHelm())  # type: ignore[arg-type]
        gke.logs()
        assert kubectl.log_selectors == ["app.kubernetes.io/name=devstash"]
        assert "[pod] line (tail=100)" in capsys.readouterr().out


# ── consolidated-secret verbs (verify_secrets / rotate_secret) ────────────────
# The 9 app-config keys the verify pass requires — stated here as the parity spec (run.sh:1400),
# independent of the module's own tuple so the assertion isn't tautological.
_EXPECTED_KEYS = (
    "auth-secret",
    "auth-github-secret",
    "auth-google-secret",
    "resend-api-key",
    "stripe-secret-key",
    "stripe-webhook-secret",
    "openai-api-key",
    "s3-access-id",
    "s3-secret",
)
_FULL_BLOB = json.dumps(dict.fromkeys(_EXPECTED_KEYS, "x"))


class _FakeSecrets:
    """Secret Manager double — serves one blob, records any add_version payload."""

    def __init__(self, blob: str) -> None:
        self._blob = blob
        self.added: list[str] = []

    def access_blob(self, name: str) -> str:
        return self._blob

    def add_version(self, name: str, payload: str) -> None:
        self.added.append(payload)


class _SecretsGcloud:
    def __init__(self, blob: str) -> None:
        self.secrets = _FakeSecrets(blob)


class _SecretsKubectl:
    """Kubectl double for verify/rotate: gke context, scripts ESO get/describe, records annotate."""

    def __init__(
        self,
        *,
        context: str = "gke_proj_x",
        eso_name: str = "",
        eso_ready: str = "",
        describe: str = "",
    ) -> None:
        self._context = context
        self._eso_name = eso_name
        self._eso_ready = eso_ready
        self._describe = describe
        self.annotations: list[tuple[str, str, str]] = []

    def current_context(self) -> str:
        return self._context

    def get(
        self, target: str, *, namespace: str, output: str | None = None, sort_by: str | None = None
    ) -> str:
        # _report_eso_sync reads existence via `-o name`, then the Ready condition via jsonpath.
        return self._eso_name if output == "name" else self._eso_ready

    def describe(self, resource: str, *, namespace: str) -> str:
        return self._describe

    def annotate(self, resource: str, key: str, value: str, *, namespace: str) -> None:
        self.annotations.append((resource, key, value))


def _verify_gke(kubectl: _SecretsKubectl) -> Gke:
    # A suspended get_credentials_command → use_cluster_soft warns (no proc) but verify continues.
    tofu = _FakeTofu({"get_credentials_command": "(suspended)"})
    return Gke(_CONFIG, tofu, kubectl, _FakeHelm())  # type: ignore[arg-type]


class TestVerifySecrets:
    def test_all_keys_present_and_eso_ready(self, capsys: pytest.CaptureFixture[str]) -> None:
        kubectl = _SecretsKubectl(eso_name="externalsecret/devstash-secrets", eso_ready="True")
        _verify_gke(kubectl).verify_secrets(_SecretsGcloud(_FULL_BLOB))  # type: ignore[arg-type]
        out = capsys.readouterr().out
        assert f"all {len(_EXPECTED_KEYS)} required keys present" in out
        assert "no infra keys" in out  # suspended posture — no database-*/redis-* keys
        assert "Ready=True" in out

    def test_missing_key_warns(self, capsys: pytest.CaptureFixture[str]) -> None:
        partial = json.dumps(dict.fromkeys(_EXPECTED_KEYS[:-1], "x"))  # drop one
        _verify_gke(_SecretsKubectl()).verify_secrets(_SecretsGcloud(partial))  # type: ignore[arg-type]
        out = capsys.readouterr().out
        assert f"MISSING: {_EXPECTED_KEYS[-1]}" in out
        assert "required key(s) absent" in out

    def test_missing_blob_warns_unreadable(self, capsys: pytest.CaptureFixture[str]) -> None:
        _verify_gke(_SecretsKubectl()).verify_secrets(_SecretsGcloud(""))  # type: ignore[arg-type]
        assert "missing or unreadable" in capsys.readouterr().out

    def test_active_infra_keys_reported(self, capsys: pytest.CaptureFixture[str]) -> None:
        blob = json.dumps(dict.fromkeys((*_EXPECTED_KEYS, "database-url", "redis-url"), "x"))
        _verify_gke(_SecretsKubectl()).verify_secrets(_SecretsGcloud(blob))  # type: ignore[arg-type]
        assert "active-only infra keys present: database-url redis-url" in capsys.readouterr().out

    def test_eso_not_found_hints_install(self, capsys: pytest.CaptureFixture[str]) -> None:
        gcloud = _SecretsGcloud(_FULL_BLOB)
        _verify_gke(_SecretsKubectl(eso_name="")).verify_secrets(gcloud)  # type: ignore[arg-type]
        out = capsys.readouterr().out
        assert "ExternalSecret devstash-secrets not found" in out
        assert "devstash-infra gcp eso" in out

    def test_eso_not_ready_dumps_describe(self, capsys: pytest.CaptureFixture[str]) -> None:
        kubectl = _SecretsKubectl(
            eso_name="externalsecret/devstash-secrets",
            eso_ready="SecretSyncedError",
            describe="Events:\n  SecretSyncedError: missing key",
        )
        _verify_gke(kubectl).verify_secrets(_SecretsGcloud(_FULL_BLOB))  # type: ignore[arg-type]
        out = capsys.readouterr().out
        assert "NOT Ready (status: SecretSyncedError)" in out
        assert "SecretSyncedError: missing key" in out  # describe body echoed


def _rotate_gke(kubectl: _SecretsKubectl, *, clock: ManualClock | None = None) -> Gke:
    # rotate uses the HARD use_cluster: a real gcloud get-credentials command that must run.
    return Gke(
        _CONFIG,
        _FakeTofu({"get_credentials_command": _CREDS}),  # type: ignore[arg-type]
        kubectl,  # type: ignore[arg-type]
        _FakeHelm(),  # type: ignore[arg-type]
        clock=clock or ManualClock(),
    )


class TestRotateSecret:
    def test_rotates_and_forces_sync(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_CREDS.split(), stdout="")  # use_cluster get-credentials
        kubectl = _SecretsKubectl(context="gke_proj_x")
        gcloud = _SecretsGcloud(json.dumps({"auth-secret": "old", "openai-api-key": "keep"}))
        _rotate_gke(kubectl, clock=ManualClock(start=123.0)).rotate_secret(
            gcloud,  # type: ignore[arg-type]
            name="auth-secret",
            value="new-val",
        )
        # Exactly one new version, carrying the replaced property with the rest preserved.
        assert len(gcloud.secrets.added) == 1
        rewritten = json.loads(gcloud.secrets.added[0])
        assert rewritten == {"auth-secret": "new-val", "openai-api-key": "keep"}
        # ESO force-synced with the injected clock value.
        assert kubectl.annotations == [("externalsecret/devstash-secrets", "force-sync", "123.0")]
        assert "new version" in capsys.readouterr().out

    def test_unsupported_name_raises_before_cluster(self) -> None:
        # A Terraform-owned generated key is not rotatable — raises before any cluster/SM touch.
        gcloud = _SecretsGcloud(_FULL_BLOB)
        with pytest.raises(InfraError, match="unsupported secret"):
            _rotate_gke(_SecretsKubectl()).rotate_secret(
                gcloud,  # type: ignore[arg-type]
                name="database-url",
                value="x",
            )
        assert gcloud.secrets.added == []

    def test_empty_value_raises(self) -> None:
        with pytest.raises(InfraError, match="must not be empty"):
            _rotate_gke(_SecretsKubectl()).rotate_secret(
                _SecretsGcloud(_FULL_BLOB),  # type: ignore[arg-type]
                name="auth-secret",
                value="",
            )

    def test_missing_blob_raises(self, expect: ExpectFn) -> None:
        expect(_CREDS.split(), stdout="")  # use_cluster get-credentials
        with pytest.raises(InfraError, match="not found"):
            _rotate_gke(_SecretsKubectl(context="gke_proj_x")).rotate_secret(
                _SecretsGcloud(""),  # type: ignore[arg-type]
                name="auth-secret",
                value="new-val",
            )
