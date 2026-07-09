"""Consolidated tests for steps in devstash_infra/ci/steps.py."""

from pathlib import Path

import pytest

from devstash_infra.ci import steps as run_migrations_mod  # for monkeypatching wait_for_job_gate
from devstash_infra.ci.steps import (
    apply_infra,
    check_env_active,
    check_migrations,
    decide_build,
    render_manifests,
    rollout_web,
    run_migrations,
    sign_images,
    ssa_apply,
    validate_inputs,
    verify_control_plane,
    wait_endpoint,
    wait_rollout,
    wif_torn_down_skip,
)
from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.job_gate import JobGate
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError, Result
from tests.conftest import ExpectFn, RecordedCallsFn
from tests.doubles import ManualClock


# ── wif_torn_down_skip tests ──────────────────────────────────────────────────
def test_emits_actionable_warning_and_returns_false(capsys: pytest.CaptureFixture[str]) -> None:
    assert wif_torn_down_skip() is False  # build=false
    out = capsys.readouterr().out
    assert out.startswith("::warning::")
    assert "devstash-infra gcp up" in out  # the actionable recovery hint


# ── decide_build tests ────────────────────────────────────────────────────────
def test_provision_always_builds_without_probing_cluster() -> None:
    assert decide_build(dispatch_reason="provision", cluster_present=False) is True


def test_present_cluster_builds() -> None:
    assert decide_build(dispatch_reason="", cluster_present=True) is True


def test_parked_env_skips_with_warning(capsys: pytest.CaptureFixture[str]) -> None:
    assert decide_build(dispatch_reason="", cluster_present=False) is False
    assert "parked at ~$0" in capsys.readouterr().out


# ── check_env_active tests ────────────────────────────────────────────────────
class _PresentAfter:
    def __init__(self, appear_on: int) -> None:
        self.appear_on = appear_on
        self.calls = 0

    def __call__(self) -> bool:
        self.calls += 1
        return self.calls >= self.appear_on


def test_active_on_first_probe_no_sleep() -> None:
    clock = ManualClock()
    assert check_env_active(_PresentAfter(1), attempts=5, clock=clock) is False
    assert clock.slept == []  # never waited


def test_resume_in_flight_becomes_active() -> None:
    present = _PresentAfter(3)  # appears on the 3rd poll
    clock = ManualClock()
    assert check_env_active(present, attempts=5, clock=clock) is False
    assert present.calls == 3
    assert len(clock.slept) == 2  # slept between the first three probes


def test_parked_env_exhausts_window_and_reports_suspended(
    capsys: pytest.CaptureFixture[str],
) -> None:
    present = _PresentAfter(999)  # never appears
    clock = ManualClock()
    assert check_env_active(present, attempts=4, clock=clock) is True
    assert present.calls == 4
    assert len(clock.slept) == 3  # attempts - 1 gaps, no trailing sleep
    assert "Environment is suspended" in capsys.readouterr().out


# ── check_migrations tests ────────────────────────────────────────────────────
def _make_migration(root: Path, name: str) -> str:
    path = root / name / "migration.sql"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("ALTER TABLE x ADD COLUMN y int;")
    return str(path)


def test_analyzes_all_migrations_sorted(
    tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    b = _make_migration(tmp_path, "20240102_b")
    a = _make_migration(tmp_path, "20240101_a")
    files = sorted([a, b])
    expect(["npx", "--no-install", "pgfence", "analyze", "--ci", *files])

    check_migrations(tmp_path)

    assert recorded_calls() == [["npx", "--no-install", "pgfence", "analyze", "--ci", *files]]


def test_risky_migration_raises(tmp_path: Path, expect: ExpectFn) -> None:
    file = _make_migration(tmp_path, "20240101_drop")
    expect(
        ["npx", "--no-install", "pgfence", "analyze", "--ci", file],
        returncode=1,
        stderr="high-risk: DROP COLUMN",
    )
    with pytest.raises(ProcError):
        check_migrations(tmp_path)


# ── ssa_apply & apply_infra & rollout_web tests ──────────────────────────────
class _FakeYq:
    def __init__(self, output: str) -> None:
        self._output = output
        self.selectors: list[str] = []

    def eval(
        self, expression: str, input_path: str, *, env_extra: dict[str, str] | None = None
    ) -> str:
        self.selectors.append(expression)
        return self._output


class _FakeKubectl:
    def __init__(self) -> None:
        self.deleted: list[tuple[str, str, str]] = []
        self.applied: list[tuple[str, str]] = []

    def delete(self, kind: str, name: str, *, namespace: str) -> None:
        self.deleted.append((kind, name, namespace))

    def apply_server_side(self, manifest: str, *, field_manager: str) -> None:
        self.applied.append((manifest, field_manager))


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq(fake: _FakeYq) -> Yq:
    return fake  # type: ignore[return-value]


def test_rollout_web_applies_only_the_deployment() -> None:
    yq = _FakeYq("kind: Deployment\n")
    kubectl = _FakeKubectl()
    rollout_web(_kubectl(kubectl), _yq(yq), rendered_path=Path("rendered.yaml"))
    assert yq.selectors == ['select(.kind == "Deployment")']
    assert kubectl.applied == [("kind: Deployment\n", "devstash-deploy")]


def test_ssa_apply_threads_selector_and_field_manager() -> None:
    yq = _FakeYq("kind: Gateway\n")
    kubectl = _FakeKubectl()
    ssa_apply(
        _kubectl(kubectl),
        _yq(yq),
        selector='select(.kind != "Deployment")',
        rendered_path=Path("rendered.yaml"),
        field_manager="custom-mgr",
    )
    assert yq.selectors == ['select(.kind != "Deployment")']
    assert kubectl.applied == [("kind: Gateway\n", "custom-mgr")]


def test_deletes_legacy_stack_then_applies_non_deployment() -> None:
    yq = _FakeYq("kind: Gateway\n")
    kubectl = _FakeKubectl()
    apply_infra(_kubectl(kubectl), _yq(yq), namespace="devstash", rendered_path=Path("r.yaml"))

    assert kubectl.deleted == [
        ("ingress", "devstash-web", "devstash"),
        ("backendconfig", "devstash-backendconfig", "devstash"),
        ("frontendconfig", "devstash-frontendconfig", "devstash"),
        ("managedcertificate", "devstash-cert", "devstash"),
    ]
    assert yq.selectors == ['select(.kind != "Deployment")']
    assert kubectl.applied == [("kind: Gateway\n", "devstash-deploy")]


# ── run_migrations tests ─────────────────────────────────────────────────────
_MANIFEST = Path("/repo/infra/k8s/overlays/gcp/migrate-job.yaml")


class _FakeKubectlMigrate:
    def __init__(self, *, gate: str, prior_logs: str = "") -> None:
        self._gate = gate
        self._prior_logs = prior_logs
        self.events: list[str] = []
        self.applied: str | None = None

    def job_logs(self, job: str, *, namespace: str, tail: int) -> str:
        if tail == 100:
            self.events.append("capture-prior")
            return self._prior_logs
        return "final logs"

    def delete_job(self, job: str, *, namespace: str) -> None:
        self.events.append(f"delete:{job}")

    def apply_stdin(self, manifest: str) -> None:
        self.events.append("apply")
        self.applied = manifest

    def job_condition(self, job: str, condition: str, *, namespace: str) -> str:
        return "True" if condition == self._gate else ""

    def describe(self, resource: str, *, namespace: str) -> str:
        return "job desc"


class _FakeYqMigrate:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def eval(
        self, expression: str, input_path: str, *, env_extra: dict[str, str] | None = None
    ) -> str:
        image = (env_extra or {}).get("MIGRATE_IMAGE", "")
        self.calls.append((expression, input_path, image))
        return f"kind: Job # image={image}\n"


def _kubectl_m(fake: _FakeKubectlMigrate) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq_m(fake: _FakeYqMigrate) -> Yq:
    return fake  # type: ignore[return-value]


def test_complete_applies_patched_manifest_in_order() -> None:
    kubectl = _FakeKubectlMigrate(gate="Complete", prior_logs="earlier failure trace")
    yq = _FakeYqMigrate()
    run_migrations(
        _kubectl_m(kubectl),
        _yq_m(yq),
        namespace="devstash",
        migrate_image="reg/migrate@sha256:abc",
        manifest_path=_MANIFEST,
    )
    assert kubectl.events == ["capture-prior", "delete:devstash-migrate", "apply"]
    assert yq.calls == [
        (
            ".spec.template.spec.containers[0].image = strenv(MIGRATE_IMAGE)",
            str(_MANIFEST),
            "reg/migrate@sha256:abc",
        )
    ]
    assert kubectl.applied == "kind: Job # image=reg/migrate@sha256:abc\n"


def test_failed_gate_raises() -> None:
    kubectl = _FakeKubectlMigrate(gate="Failed")
    with pytest.raises(InfraError, match="reached Failed condition"):
        run_migrations(
            _kubectl_m(kubectl),
            _yq_m(_FakeYqMigrate()),
            namespace="devstash",
            migrate_image="reg/migrate@sha256:abc",
            manifest_path=_MANIFEST,
        )


def test_timeout_gate_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def _timeout_gate(*_args: object, **_kwargs: object) -> JobGate:
        return JobGate.TIMEOUT

    monkeypatch.setattr(run_migrations_mod, "wait_for_job_gate", _timeout_gate)
    with pytest.raises(InfraError, match="did not complete within 600s"):
        run_migrations(
            _kubectl_m(_FakeKubectlMigrate(gate="")),
            _yq_m(_FakeYqMigrate()),
            namespace="devstash",
            migrate_image="reg/migrate@sha256:abc",
            manifest_path=_MANIFEST,
        )


# ── wait_rollout tests ────────────────────────────────────────────────────────
class _FakeKubectlRollout:
    def __init__(self, *, rollout_ok: bool, pods: list[str] | None = None) -> None:
        self._rollout_ok = rollout_ok
        self._pods = pods or []
        self.rollouts: list[tuple[str, str]] = []
        self.previous_logs_for: list[str] = []

    def rollout_status(self, resource: str, *, namespace: str, timeout: str) -> None:
        self.rollouts.append((resource, timeout))
        if not self._rollout_ok:
            raise ProcError(Result([resource], "", "timed out", 1))

    def describe(self, resource: str, *, namespace: str) -> str:
        return "Events:\n  Warning  FailedScheduling"

    def pod_names(self, selector: str, *, namespace: str) -> list[str]:
        return self._pods

    def previous_logs(self, pod: str, *, namespace: str, tail: int) -> str:
        self.previous_logs_for.append(pod)
        return f"panic in {pod}"


def _kubectl_r(fake: _FakeKubectlRollout) -> Kubectl:
    return fake  # type: ignore[return-value]


def test_successful_rollout_returns_and_targets_web_deployment() -> None:
    fake = _FakeKubectlRollout(rollout_ok=True)
    wait_rollout(_kubectl_r(fake), namespace="devstash")
    assert fake.rollouts == [("deployment/devstash-web", "300s")]


def test_failed_rollout_raises_with_fix_forward_hint(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectlRollout(rollout_ok=False, pods=["pod/web-a", "pod/web-b"])
    with pytest.raises(InfraError) as excinfo:
        wait_rollout(_kubectl_r(fake), namespace="devstash")
    assert "DO NOT roll back" in excinfo.value.hint
    assert fake.previous_logs_for == ["pod/web-a", "pod/web-b"]
    err = capsys.readouterr().err
    assert "Logs from failing pods" in err and "panic in pod/web-a" in err


def test_failed_rollout_with_no_pods_still_raises(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectlRollout(rollout_ok=False, pods=[])
    with pytest.raises(InfraError):
        wait_rollout(_kubectl_r(fake), namespace="devstash")
    assert fake.previous_logs_for == []


# ── wait_endpoint tests ───────────────────────────────────────────────────────
class _FakeKubectlEndpoint:
    def get(
        self, target: str, *, namespace: str, output: str | None = None, sort_by: str | None = None
    ) -> str:
        return f"diagnostics for {target}"


def _kubectl_ep(fake: _FakeKubectlEndpoint) -> Kubectl:
    return fake  # type: ignore[return-value]


class _HealthAfter:
    def __init__(self, serve_on: int) -> None:
        self.serve_on = serve_on
        self.urls: list[str] = []

    def __call__(self, url: str) -> bool:
        self.urls.append(url)
        return len(self.urls) >= self.serve_on


def test_unset_domain_skips_with_warning(capsys: pytest.CaptureFixture[str]) -> None:
    wait_endpoint(_kubectl_ep(_FakeKubectlEndpoint()), app_domain="", namespace="devstash")
    assert "::warning::" in capsys.readouterr().out


def test_serving_endpoint_returns() -> None:
    health = _HealthAfter(serve_on=1)
    wait_endpoint(
        _kubectl_ep(_FakeKubectlEndpoint()),
        app_domain="app.example.com",
        namespace="devstash",
        health_ok=health,
        attempts=3,
        gap_s=0,
    )
    assert health.urls == ["https://app.example.com/api/health?deep=1"]


def test_endpoint_becomes_healthy_before_deadline() -> None:
    health = _HealthAfter(serve_on=3)
    wait_endpoint(
        _kubectl_ep(_FakeKubectlEndpoint()),
        app_domain="app.example.com",
        namespace="devstash",
        health_ok=health,
        attempts=5,
        gap_s=0,
    )
    assert len(health.urls) == 3


def test_never_healthy_raises_and_dumps_gateway(capsys: pytest.CaptureFixture[str]) -> None:
    health = _HealthAfter(serve_on=999)
    with pytest.raises(Exception, match="did not report healthy"):
        wait_endpoint(
            _kubectl_ep(_FakeKubectlEndpoint()),
            app_domain="app.example.com",
            namespace="devstash",
            health_ok=health,
            attempts=3,
            gap_s=0,
        )
    err = capsys.readouterr().err
    assert "Gateway / HTTPRoute status" in err and "Recent namespace events" in err


# ── validate_inputs tests ─────────────────────────────────────────────────────
_VALID_INPUTS = {
    "project_id": "proj",
    "wif_provider": "projects/1/locations/global/workloadIdentityPools/p/providers/gh",
    "deployer_sa": "deployer@proj.iam.gserviceaccount.com",
    "app_domain": "app.example.com",
}


def test_full_valid_inputs_pass() -> None:
    validate_inputs(**_VALID_INPUTS)


@pytest.mark.parametrize("missing", ["project_id", "wif_provider", "deployer_sa", "app_domain"])
def test_missing_required_input_raises(missing: str) -> None:
    args = {**_VALID_INPUTS, missing: ""}
    with pytest.raises(InfraError, match="required GitHub deployment input is missing"):
        validate_inputs(**args)


def test_all_binauthz_set_passes() -> None:
    validate_inputs(**_VALID_INPUTS, binauthz_attestor="a", binauthz_keyring="kr", binauthz_key="k")


def test_partial_binauthz_raises() -> None:
    with pytest.raises(InfraError, match=r"partially configured.*BINAUTHZ_KMS_KEY"):
        validate_inputs(**_VALID_INPUTS, binauthz_attestor="a", binauthz_keyring="kr")


@pytest.mark.parametrize(
    "bad", ["https://app.example.com", "App.Example.Com", "nodots", "app.example.com/path"]
)
def test_bad_app_domain_raises(bad: str) -> None:
    with pytest.raises(InfraError, match="APP_DOMAIN must be a lowercase hostname"):
        validate_inputs(**{**_VALID_INPUTS, "app_domain": bad})


# ── verify_control_plane tests ────────────────────────────────────────────────
class _FakeKubectlCP:
    def __init__(self, probe: Result) -> None:
        self._probe = probe
        self.paths: list[str] = []

    def get_raw(self, path: str) -> Result:
        self.paths.append(path)
        return self._probe


def _kubectl_cp(fake: _FakeKubectlCP) -> Kubectl:
    return fake  # type: ignore[return-value]


def _probe(stdout: str = "", stderr: str = "", code: int = 0) -> Result:
    return Result(["kubectl", "get", "--raw=/readyz"], stdout, stderr, code)


def test_reachable_returns_true() -> None:
    fake = _FakeKubectlCP(_probe(stdout="ok"))
    assert verify_control_plane(_kubectl_cp(fake), cluster="c", region="r") is True
    assert fake.paths == ["/readyz"]


def test_generic_403_forbidden_raises_with_gate_guidance() -> None:
    fake = _FakeKubectlCP(_probe(stderr="error: 403 (Forbidden)\n<html>...", code=1))
    with pytest.raises(InfraError) as excinfo:
        verify_control_plane(_kubectl_cp(fake), cluster="devstash-dev-gke", region="us-central1")
    exc = excinfo.value
    assert "Google Front End" in exc.message
    assert "a051ad7" in exc.hint
    assert "allow_external_traffic" in exc.hint
    assert "devstash-dev-gke" in exc.hint and "us-central1" in exc.hint


def test_google_error_page_signature_raises() -> None:
    fake = _FakeKubectlCP(_probe(stderr="That’s an error.", code=1))
    with pytest.raises(InfraError):
        verify_control_plane(_kubectl_cp(fake), cluster="c", region="r")


def test_other_unreachable_warns_and_skips(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectlCP(
        _probe(stderr="Unable to connect to the server: dial tcp: no route", code=1)
    )
    assert verify_control_plane(_kubectl_cp(fake), cluster="c", region="r") is False
    assert "::warning::" in capsys.readouterr().out


# ── render_manifests tests ────────────────────────────────────────────────────
_RENDERED = "apiVersion: v1\nkind: ConfigMap\n"


class _FakeKubectlRender:
    def kustomize(self, directory: str) -> str:
        self.rendered_from = directory
        return _RENDERED


class _RecordingYq:
    def __init__(self) -> None:
        self.edits: list[tuple[str, str]] = []

    def eval_in_place(
        self, expression: str, path: str, *, env_extra: dict[str, str] | None = None
    ) -> None:
        self.edits.append((expression, path))


def _kubectl_render(fake: _FakeKubectlRender) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq_render(fake: _RecordingYq) -> Yq:
    return fake  # type: ignore[return-value]


def test_writes_rendered_file_then_drops_empty_armor(tmp_path: Path) -> None:
    rendered = tmp_path / "rendered.yaml"
    yq = _RecordingYq()
    render_manifests(
        _kubectl_render(_FakeKubectlRender()),
        _yq_render(yq),
        overlay_dir=Path("overlays/gcp"),
        rendered_path=rendered,
    )
    # the kustomize output lands in the shared file…
    assert rendered.read_text() == _RENDERED
    # …then the empty-armor securityPolicy delete runs against that file.
    assert len(yq.edits) == 1
    expression, path = yq.edits[0]
    assert path == str(rendered)
    assert "GCPBackendPolicy" in expression and "del(.spec.default.securityPolicy)" in expression


# ── sign-images (Binary Authorization) ───────────────────────────────────────
class _RecordingContainer:
    def __init__(self, *, fail_on: str | None = None) -> None:
        self.fail_on = fail_on
        self.signed: list[tuple[str, str, str, str]] = []

    def sign_attestation(self, artifact: str, *, attestor: str, keyring: str, key: str) -> None:
        if artifact == self.fail_on:
            raise RuntimeError("kms signing failed")
        self.signed.append((artifact, attestor, keyring, key))


class _FakeGcloud:
    def __init__(self, container: _RecordingContainer) -> None:
        self.container = container


def _gcloud(container: _RecordingContainer) -> Gcloud:
    return _FakeGcloud(container)  # type: ignore[return-value]


def test_sign_images_web_by_digest_and_migrate_ref() -> None:
    container = _RecordingContainer()
    sign_images(
        _gcloud(container),
        image_uri="reg/repo/web",
        web_digest="sha256:abc",
        migrate_image="reg/repo/migrate@sha256:def",
        attestor="att",
        keyring="kr",
        key="k",
    )
    signed_artifacts = [entry[0] for entry in container.signed]
    assert signed_artifacts == ["reg/repo/web@sha256:abc", "reg/repo/migrate@sha256:def"]
    assert container.signed[0][1:] == ("att", "kr", "k")  # attestor/keyring/key threaded through


def test_sign_images_signing_failure_propagates() -> None:
    container = _RecordingContainer(fail_on="reg/repo/web@sha256:abc")
    with pytest.raises(RuntimeError, match="kms signing failed"):
        sign_images(
            _gcloud(container),
            image_uri="reg/repo/web",
            web_digest="sha256:abc",
            migrate_image="reg/repo/migrate@sha256:def",
            attestor="att",
            keyring="kr",
            key="k",
        )
    assert container.signed == []  # failed on the first artifact — never reached migrate
