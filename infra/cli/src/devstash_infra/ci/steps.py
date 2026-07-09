"""ci/steps.py — consolidated deploy-gke.yml CI step actions. CLI zone (3.14).

Every deploy-gke.yml step that is a THIN pure function over injected clients lives here (they share
the constants block above + the private `_dump_*`/`_echo_block` diagnostics helpers). A step earns
its OWN module only when it owns a result type or more than one non-trivial private helper —
`build_push` (owns `BuildPushResult`), `operators` (the ensure_operator/ensure_operators pair),
`inject_settings`, `prune_registry`, and `wait_secrets_sync`. Trivial single-function steps
(including `render_manifests` below) stay here so "which file is this step in?" has a rule,
not a per-case answer.
"""

import re
from collections.abc import Callable
from pathlib import Path

import typer

from devstash_infra.ci import actions
from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.health import deep_health_ok
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.common import log, ok, poll_until
from devstash_infra.job_gate import JobGate, wait_for_job_gate
from devstash_infra.shared import proc
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError

# ── constants ────────────────────────────────────────────────────────────────
_HOSTNAME_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$")

_WIF_WARNING = (
    "GCP auth failed: the Workload Identity Federation pool is torn down (soft-DELETED after a "
    "full 'devstash-infra gcp down'). CI cannot restore it — undeleting the pool itself needs GCP "
    "auth. Skipping build + deploy. Restore the environment locally with: devstash-infra gcp up "
    "(its reconcile step undeletes + re-adopts the WIF pool, which restores CI auth)."
)

_PARKED_WARNING = (
    "No GKE cluster and this is not a run.sh provision — environment is parked at ~$0. Skipping "
    "build + deploy so no images are wastefully rebuilt/repushed. Bring it back with: "
    "devstash-infra gcp resume"
)

_SUSPENDED_WARNING = (
    "Environment is suspended — the GKE cluster did not appear within the poll window. Skipping "
    "deploy: nothing is deployed and nothing fails. Bring it back with: "
    "devstash-infra gcp resume"
)

_MIGRATION_GLOB = "**/migration.sql"

_LEGACY_OBJECTS = (
    ("ingress", "devstash-web"),
    ("backendconfig", "devstash-backendconfig"),
    ("frontendconfig", "devstash-frontendconfig"),
    ("managedcertificate", "devstash-cert"),
)

_SELECTOR = 'select(.kind != "Deployment")'
_DEPLOYMENT_SELECTOR = 'select(.kind == "Deployment")'

_DROP_EMPTY_ARMOR = (
    'select(.kind == "GCPBackendPolicy" and (.spec.default.securityPolicy // "") == "") '
    "|= del(.spec.default.securityPolicy)"
)

_MIGRATE_JOB = "devstash-migrate"
_IMAGE_EXPR = ".spec.template.spec.containers[0].image = strenv(MIGRATE_IMAGE)"
_MIGRATE_DEADLINE_S = 600.0

FIELD_MANAGER = "devstash-deploy"

_DEPLOYMENT = "deployment/devstash-web"
_POD_SELECTOR = "app.kubernetes.io/name=devstash"
_ROLLOUT_TIMEOUT = "300s"

_FAIL_MESSAGE = "Rollout failed — new web pods did not become healthy within 300s."
_FIX_FORWARD = (
    "DO NOT roll back the Deployment — migrations have already run against the new schema. Fix "
    "forward: push a commit that resolves the pod startup failure. Old pods keep serving "
    "(maxUnavailable: 0), so traffic is uninterrupted while you fix and re-deploy."
)

_NO_DOMAIN_WARNING = (
    "APP_DOMAIN is unset — skipping the public-endpoint gate. The rollout is healthy; only the "
    "end-to-end URL check was skipped."
)

_GENERIC_403 = re.compile(r"403 \(Forbidden\)|That.{0,3}s an error", re.IGNORECASE)
_DRIFT_MESSAGE = (
    "GKE DNS endpoint returned a generic HTTP 403 at the Google Front End — the control plane "
    "refused this runner."
)


# ── step functions ──────────────────────────────────────────────────────────


def validate_inputs(
    *,
    project_id: str,
    wif_provider: str,
    deployer_sa: str,
    app_domain: str,
    binauthz_attestor: str = "",
    binauthz_keyring: str = "",
    binauthz_key: str = "",
) -> None:
    """Validate the required deployment inputs; raise `InfraError` on the first problem."""
    required = {
        "GCP_PROJECT_ID": project_id,
        "WORKLOAD_IDENTITY_PROVIDER": wif_provider,
        "DEPLOYER_SA": deployer_sa,
        "APP_DOMAIN": app_domain,
    }
    for name, value in required.items():
        if not value:
            raise InfraError(f"required GitHub deployment input is missing: {name}")

    binauthz = {
        "BINAUTHZ_ATTESTOR": binauthz_attestor,
        "BINAUTHZ_KMS_KEYRING": binauthz_keyring,
        "BINAUTHZ_KMS_KEY": binauthz_key,
    }
    if any(binauthz.values()):
        for name, value in binauthz.items():
            if not value:
                raise InfraError(
                    f"Binary Authorization is partially configured — {name} is missing "
                    "(set all three, or none)"
                )

    if not _HOSTNAME_RE.match(app_domain) or "." not in app_domain:
        raise InfraError("APP_DOMAIN must be a lowercase hostname without scheme, port, or path")


def wif_torn_down_skip() -> bool:
    """Emit the actionable warning and return False (build=false) so the deploy cascade skips."""
    actions.warning(_WIF_WARNING)
    return False


def decide_build(*, dispatch_reason: str, cluster_present: bool) -> bool:
    """Return True iff the deploy should build+push; emits a parked-env warning when False."""
    if dispatch_reason == "provision":
        log("dispatch reason is 'provision' — run.sh is bringing the env up; building")
        return True
    if cluster_present:
        log("GKE cluster is present — environment active; building")
        return True
    actions.warning(_PARKED_WARNING)
    return False


def check_env_active(
    cluster_present: Callable[[], bool],
    *,
    attempts: int = 40,
    gap_s: float = 15,
    clock: Clock = SYSTEM_CLOCK,
) -> bool:
    """Poll for the cluster; return True iff SUSPENDED (absent after `attempts × gap_s`)."""
    for attempt in range(1, attempts + 1):
        if cluster_present():
            log("environment active — GKE cluster present; proceeding with deploy")
            return False
        if attempt < attempts:
            log(f"GKE cluster not listable yet (attempt {attempt}/{attempts}) — waiting {gap_s}s")
            clock.sleep(gap_s)
    actions.warning(_SUSPENDED_WARNING)
    return True


def check_migrations(migrations_root: Path) -> None:
    """Analyze every `migration.sql` under `migrations_root` with pgfence.

    Raises on a risky finding.
    """
    files = sorted(str(path) for path in migrations_root.glob(_MIGRATION_GLOB))
    log(f"Analyzing {len(files)} migration file(s) with pgfence…")
    proc.run(["npx", "--no-install", "pgfence", "analyze", "--ci", *files])
    ok("migrations passed pgfence safety analysis")


def sign_images(
    gcloud: Gcloud,
    *,
    image_uri: str,
    web_digest: str,
    migrate_image: str,
    attestor: str,
    keyring: str,
    key: str,
) -> None:
    """KMS-sign the web (uri@digest) and migrate artifacts for Binary Authorization; raise on error.

    Port of infra/ci/sign-images.sh — the CI half of "step 2" in the GKE module's enforcement path:
    attestations are PROVEN to land BEFORE the cluster rule flips from ALWAYS_ALLOW to
    REQUIRE_ATTESTATION. Hard-fails on error — enforcement is off, so a signing failure cannot brick
    a live deploy, but a silent failure would hide a broken pipeline from whoever flips enforcement
    on. KMS does the signing; no private key touches the runner. The web artifact is
    `<image_uri>@<web_digest>` (an immutable by-digest ref); `migrate_image` is already the full
    by-digest ref build-push emitted, so it is signed as-is. The calling step gates on
    `BINAUTHZ_ATTESTOR != ''`, and validate_inputs guarantees the three BINAUTHZ_* values are
    all-set-or-all-unset, so gating on the attestor alone is sufficient.
    """
    artifacts = [f"{image_uri}@{web_digest}", migrate_image]
    for artifact in artifacts:
        log(f"Signing {artifact} for Binary Authorization…")
        gcloud.container.sign_attestation(artifact, attestor=attestor, keyring=keyring, key=key)
        ok(f"attestation created for {artifact}")


def ssa_apply(
    kubectl: Kubectl,
    yq: Yq,
    *,
    selector: str,
    rendered_path: Path,
    field_manager: str = FIELD_MANAGER,
) -> None:
    """Select docs from `rendered_path` with `selector` and server-side-apply them. Raises."""
    manifest = yq.eval(selector, str(rendered_path))
    kubectl.apply_server_side(manifest, field_manager=field_manager)


def apply_infra(kubectl: Kubectl, yq: Yq, *, namespace: str, rendered_path: Path) -> None:
    """Delete the legacy Ingress stack, then SSA-apply the render minus the web Deployment."""
    for kind, name in _LEGACY_OBJECTS:
        kubectl.delete(kind, name, namespace=namespace)

    log("Applying infra (everything except the web Deployment)…")
    ssa_apply(kubectl, yq, selector=_SELECTOR, rendered_path=rendered_path)


def rollout_web(kubectl: Kubectl, yq: Yq, *, rendered_path: Path) -> None:
    """Server-side-apply the web Deployment from `rendered_path`, triggering the rolling update."""
    log("Applying the web Deployment to trigger the rolling update…")
    ssa_apply(kubectl, yq, selector=_DEPLOYMENT_SELECTOR, rendered_path=rendered_path)
    ok("web Deployment applied — rollout triggered")


def run_migrations(
    kubectl: Kubectl, yq: Yq, *, namespace: str, migrate_image: str, manifest_path: Path
) -> None:
    """Apply the digest-pinned migrate Job and block on its gate; raise on Failed/timeout."""
    log("Running the migrate Job unconditionally (prisma migrate deploy is idempotent).")

    # Capture a prior failed run's logs BEFORE deleting it — the delete destroys the pod + its logs.
    prior_logs = kubectl.job_logs(_MIGRATE_JOB, namespace=namespace, tail=100)
    if prior_logs:
        typer.echo("--- Logs from previous migrate job (captured before delete) ---")
        typer.echo(prior_logs)

    kubectl.delete_job(_MIGRATE_JOB, namespace=namespace)
    patched = yq.eval(_IMAGE_EXPR, str(manifest_path), env_extra={"MIGRATE_IMAGE": migrate_image})
    kubectl.apply_stdin(patched)

    gate = wait_for_job_gate(
        kubectl, namespace=namespace, job=_MIGRATE_JOB, deadline_s=_MIGRATE_DEADLINE_S
    )
    if gate is JobGate.FAILED:
        raise InfraError("migration job reached Failed condition")
    if gate is JobGate.TIMEOUT:
        raise InfraError("migration job did not complete within 600s")

    ok("migrate Job completed")
    final_logs = kubectl.job_logs(_MIGRATE_JOB, namespace=namespace, tail=50)
    if final_logs:
        typer.echo(final_logs)


def wait_rollout(kubectl: Kubectl, *, namespace: str) -> None:
    """Block until `devstash-web` rolls out; on timeout emit diagnostics and raise `InfraError`."""
    log(f"Waiting up to {_ROLLOUT_TIMEOUT} for {_DEPLOYMENT} to roll out…")
    try:
        kubectl.rollout_status(_DEPLOYMENT, namespace=namespace, timeout=_ROLLOUT_TIMEOUT)
    except ProcError as exc:
        _dump_rollout_diagnostics(kubectl, namespace)
        raise InfraError(_FAIL_MESSAGE, hint=_FIX_FORWARD) from exc


def _dump_rollout_diagnostics(kubectl: Kubectl, namespace: str) -> None:
    """Print the deployment's recent events and each failing pod's previous-container logs."""
    describe = kubectl.describe(_DEPLOYMENT, namespace=namespace)
    _echo_block("Recent pod events", "\n".join(describe.splitlines()[-20:]))

    # `logs --previous` is rejected alongside a label selector, so collect pod names first and
    # fetch each pod's previous-container logs individually.
    logs = [
        block
        for pod in kubectl.pod_names(_POD_SELECTOR, namespace=namespace)
        if (block := kubectl.previous_logs(pod, namespace=namespace, tail=100))
    ]
    _echo_block("Logs from failing pods", "\n".join(logs))


def _echo_block(title: str, body: str) -> None:
    typer.echo(f"--- {title} ---", err=True)
    if body:
        typer.echo(body, err=True)


def wait_endpoint(
    kubectl: Kubectl,
    *,
    app_domain: str,
    namespace: str,
    health_ok: Callable[[str], bool] = deep_health_ok,
    attempts: int = 60,
    gap_s: float = 10.0,
    clock: Clock = SYSTEM_CLOCK,
) -> None:
    """Poll the public /api/health?deep=1 URL until it serves; raise `InfraError` on timeout."""
    if not app_domain:
        actions.warning(_NO_DOMAIN_WARNING)
        return

    url = f"https://{app_domain}/api/health?deep=1"
    log(f"Waiting for the public endpoint to serve: {url}")
    if poll_until(lambda: health_ok(url), attempts=attempts, gap_seconds=gap_s, clock=clock):
        ok(f"public endpoint is serving — {url} reports status:ok")
        return

    _dump_gateway_diagnostics(kubectl, namespace)
    raise InfraError(
        f"Public endpoint {url} did not report healthy within 10m.",
        hint=(
            "Pods are healthy (wait-rollout passed) but the load balancer never routed to a "
            "healthy backend — check the Gateway/HTTPRoute status and namespace events above."
        ),
    )


def _dump_gateway_diagnostics(kubectl: Kubectl, namespace: str) -> None:
    """Print Gateway/HTTPRoute status and the newest namespace events to stderr on a failure."""
    typer.echo("--- Gateway / HTTPRoute status ---", err=True)
    typer.echo(kubectl.get("gateway,httproute", namespace=namespace, output="wide"), err=True)
    typer.echo("--- Recent namespace events ---", err=True)
    events = kubectl.get("events", namespace=namespace, sort_by=".lastTimestamp")
    typer.echo("\n".join(events.splitlines()[-30:]), err=True)


def _drift_hint(cluster: str, region: str) -> str:
    return (
        "Gate 1 (IAM): a resource-name IAM Condition on the deployer role (modules/iam/main.tf "
        "deployer_gke) never matches over the DNS endpoint, which evaluates container.clusters."
        "connect on the endpoint resource — this was the confirmed cause, fixed in a051ad7. Do NOT "
        "re-add such a condition.\n"
        "Gate 2 (network): allow_external_traffic drifted off. Confirm: gcloud container clusters "
        f"describe {cluster} --region {region} "
        "--format='value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)'  "
        "# expect True\n"
        "Reconcile drift with: tofu apply  (from infra/terraform/envs/dev)."
    )


def verify_control_plane(kubectl: Kubectl, *, cluster: str, region: str) -> bool:
    """Probe `/readyz`; True=reachable, False=treated-as-unavailable. Raise on the 403 drift."""
    log("Verifying the control plane is reachable over the DNS endpoint before Helm…")
    probe = kubectl.get_raw("/readyz")
    if probe.ok:
        ok(f"control plane reachable via DNS endpoint: {probe.out}")
        return True

    combined = f"{probe.stdout}\n{probe.stderr}"
    if _GENERIC_403.search(combined):
        raise InfraError(_DRIFT_MESSAGE, hint=_drift_hint(cluster, region))

    actions.warning(
        "Control plane not reachable over the DNS endpoint and this is not the generic-403 drift "
        "signature — treating GCP as unavailable and skipping the preflight."
    )
    return False


def render_manifests(kubectl: Kubectl, yq: Yq, *, overlay_dir: Path, rendered_path: Path) -> None:
    """Render `overlay_dir` to `rendered_path`, then drop an empty armor securityPolicy field."""
    log(f"Rendering the GCP overlay to {rendered_path}…")
    rendered_path.write_text(kubectl.kustomize(str(overlay_dir)))
    yq.eval_in_place(_DROP_EMPTY_ARMOR, str(rendered_path))
    ok(f"rendered manifests written to {rendered_path}")
