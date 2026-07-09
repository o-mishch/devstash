"""gcp/context.py — resolve config from tfvars + build the fully-wired collaborators. CLI zone.

The app-plumbing the shell kept as run.sh globals + `ensure_tfvars`/`require_state_bucket`/
`wait_for_no_autosuspend_build`/`cleanup_builds`: read `terraform.tfvars` → a `GcpConfig`, then
construct the `Environment` + every collaborator (`Deploy`/`Secrets`/`Dns`/`Db`/`Teardown`/`Gke`)
and the `Lifecycle` orchestrator over them, plus the real `ApplyDeps`. `app_gcp.py` (the typer
boundary) calls `build_context()` once per command and dispatches to the piece it needs — no logic
lives here beyond the wiring + the three apply-serialisation helpers.
"""

from __future__ import annotations

import os
import re
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.gh import Gh
from devstash_infra.clients.helm import Helm
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import log, ok, warn
from devstash_infra.config import GcpConfig
from devstash_infra.environment import ApplyDeps, Environment
from devstash_infra.gcp.bootstrap import Bootstrap
from devstash_infra.gcp.db import Db
from devstash_infra.gcp.deploy import Deploy
from devstash_infra.gcp.dns import Dns
from devstash_infra.gcp.gke import Gke
from devstash_infra.gcp.lifecycle import Lifecycle
from devstash_infra.gcp.secrets import Secrets
from devstash_infra.gcp.state_recovery import StateLockRecovery
from devstash_infra.gcp.suspend import Teardown
from devstash_infra.paths import repo_path
from devstash_infra.shared.errors import InfraError

# Repo-anchored paths (run.sh:122-144). The shell assumed cwd == repo root for
# `bash infra/run/gcp/run.sh`; `uv run devstash-infra` runs from infra/cli/, so we anchor to the
# repo root explicitly (see paths.py) rather than depend on the caller's cwd.
TF_DIR = str(repo_path("infra/terraform/envs/dev"))
_TFVARS = Path(TF_DIR) / "terraform.tfvars"
_TFVARS_EXAMPLE = Path(TF_DIR) / "terraform.tfvars.example"
_AR_IAM_ADDR_FILE = str(repo_path("infra/data/ar-iam-member-addresses.txt"))
_STATE_LIFECYCLE = str(repo_path("infra/data/tfstate-lifecycle.json"))
_DB_NAME = "devstash"  # logical DB inside the Cloud SQL instance (run.sh:144)

# Unfilled third_party_secrets placeholders from terraform.tfvars.example (run.sh:479).
_PLACEHOLDER_RE = re.compile(r"sk_\.\.\.|whsec_\.\.\.|re_\.\.\.|openssl rand")
# A scalar `key = value` line (list/object/heredoc shapes this pre-init reader rejects).
_SCALAR_RE = re.compile(r"^\s*(?P<key>[A-Za-z0-9_]+)\s*=\s*(?P<rhs>.*)$")

# wait_for_no_autosuspend_build: cap the wait so a stuck build can't hang the command forever.
_AUTOSUSPEND_WAIT_S = 900
_AUTOSUSPEND_POLL_S = 20

# The versions.env chart-pin file the eso/reloader/upgrade-helm verbs read + rewrite.
VERSIONS_ENV = repo_path("infra/versions.env")

# preflight: every required CLI + its install hint (run.sh:440).
_REQUIRED_CLIS = {
    "gcloud": "https://cloud.google.com/sdk/docs/install",
    "tofu": "https://opentofu.org/docs/intro/install (or use terraform)",
    "gh": "https://cli.github.com",
    "kubectl": "https://kubernetes.io/docs/tasks/tools/",
    "helm": "https://helm.sh/docs/intro/install",
    "jq": "brew install jq",
    "yq": "brew install yq",
}


def preflight() -> None:
    """Assert every required CLI is on PATH, else raise with the install hint. Ports `preflight`."""
    log("Preflight — required CLIs")
    missing = {name: hint for name, hint in _REQUIRED_CLIS.items() if shutil.which(name) is None}
    if missing:
        lines = "\n".join(f"  {name}: {hint}" for name, hint in missing.items())
        raise InfraError(f"missing required CLI(s):\n{lines}")
    ok("all CLIs present")


def auto_approve_from_env() -> bool:
    """AUTO_APPROVE=1 (the shell's non-interactive escape hatch) → skip every confirm prompt."""
    return os.environ.get("AUTO_APPROVE") == "1"


def read_tfvar(key: str, tfvars: Path = _TFVARS) -> str:
    """The scalar value of `key` in `tfvars`, or "" if absent. Ports `tfvar` (run.sh:199).

    A pre-init reader (runs before `tofu init`), so it parses the file by hand, not via tofu.
    Raises `InfraError` on a non-scalar shape (list/object/heredoc) so a mistyped tfvars fails
    here instead of leaking a truncated value into the state-bucket name / `gcloud --project`.
    """
    if not tfvars.is_file():
        return ""
    for line in tfvars.read_text(encoding="utf-8").splitlines():
        match = _SCALAR_RE.match(line)
        if match is None or match.group("key") != key:
            continue
        rhs = match.group("rhs")
        if rhs[:1] in ("[", "{") or "<<" in rhs:
            raise InfraError(
                f"tfvar: '{key}' in {tfvars} is not a simple scalar (list/object/heredoc) — this "
                "early pre-init reader only supports quoted or bare scalars"
            )
        # Strip a trailing inline comment, then surrounding quotes + whitespace.
        return re.sub(r"\s*#.*$", "", rhs).strip().strip('"')
    return ""


def ensure_tfvars(tfvars: Path = _TFVARS) -> None:
    """Create tfvars from the example if missing, then reject leftover placeholders.

    Raises `InfraError` (the shell's `die`) when the file was just created (operator must fill it)
    or still holds a `third_party_secrets` placeholder — pods won't start until every secret is set.
    Idempotent: a complete, placeholder-free tfvars passes silently on every call.
    """
    if not tfvars.is_file():
        tfvars.write_text(_TFVARS_EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        warn(f"Created {tfvars} from the example.")
        warn("Fill in: project_id, github_repository, github_owner_id, app_domain,")
        warn("and the real third_party_secrets (Stripe/Resend/OAuth/OpenAI/auth-secret).")
        raise InfraError(f"Edit {tfvars}, then re-run.")
    if _PLACEHOLDER_RE.search(tfvars.read_text(encoding="utf-8")):
        raise InfraError(
            f"third_party_secrets still contain placeholders. Fill real values in {tfvars} before "
            "apply (08-gcp-bootstrap.md §7b). Pods will not start until every secret is set."
        )


def resolve_config() -> GcpConfig:
    """Validate tfvars, then read project/region/environment → a `GcpConfig` (derives state bucket).

    Combines `ensure_tfvars` + the run.sh:464-472 global derivation. The state bucket defaults to
    `<project>-tfstate-<environment>` (GCS names are global, so the globally-unique project id
    avoids collisions); an existing `STATE_BUCKET` env override is the deliberate escape hatch.
    """
    ensure_tfvars()
    project = read_tfvar("project_id")
    if not project:
        raise InfraError(f"project_id not set in {_TFVARS}")
    environment = read_tfvar("environment") or "dev"
    state_bucket = os.environ.get("STATE_BUCKET") or f"{project}-tfstate-{environment}"
    return GcpConfig(
        project=project,
        region=read_tfvar("region") or "us-central1",
        environment=environment,
        db_name=_DB_NAME,
        state_bucket=state_bucket,
    )


def require_state_bucket(gcloud: Gcloud, state_bucket: str) -> None:
    """Assert the GCS backend bucket exists before `tofu init` (run.sh:488) — else a cryptic error.

    Raises `InfraError` with an actionable "run bootstrap first" message when the bucket is absent.
    """
    if not gcloud.storage.bucket_exists(f"gs://{state_bucket}"):
        raise InfraError(
            f"State bucket gs://{state_bucket} not found — run 'bootstrap' first to create it."
        )


def wait_for_no_autosuspend_build(
    gcloud: Gcloud,
    config: GcpConfig,
    *,
    sleep: Callable[[float], None] = time.sleep,
    deadline_s: int = _AUTOSUSPEND_WAIT_S,
    poll_s: float = _AUTOSUSPEND_POLL_S,
) -> None:
    """Serialise against the scheduled idle auto-suspend build before touching state.

    That build and a human `apply/suspend/resume` share ONE OpenTofu state lock; if both run the
    second dies mid-flight (and cancelling the build to break the collision can orphan the lock).
    The remote lock only rejects the loser AFTER it starts, so pre-check the CI side: if an
    auto-suspend build for THIS env is QUEUED/WORKING, wait for it. Bounded (`deadline_s`) so a
    genuinely stuck build raises an actionable `InfraError` rather than hanging forever. `sleep`
    is injected so the poll is driven without a real wait in tests.
    """
    trigger = f"devstash-{config.environment}-auto-suspend"
    waited = 0.0
    while True:
        ids = gcloud.builds.ongoing_autosuspend_ids(config.region, config.environment)
        if not ids:
            return
        if waited >= deadline_s:
            raise InfraError(
                f"auto-suspend build {ids[0]} ({trigger}) still running after {deadline_s}s — it "
                f"holds the state lock. Wait for it to finish (gcloud builds log {ids[0]} "
                f"--region={config.region}) or cancel it, then re-run."
            )
        warn(
            f"auto-suspend build {ids[0]} ({trigger}) is running and holds the state lock — "
            "waiting for it to finish before applying…"
        )
        sleep(poll_s)
        waited += poll_s


def cleanup_builds(gcloud: Gcloud, config: GcpConfig) -> None:
    """Cancel in-flight auto-suspend builds + delete the Cloud Build staging bucket.

    Best-effort, off the destroy path: scoped to THIS env's auto-suspend trigger so it never
    cancels an unrelated deploy-gke run a teammate kicked off, and the `${project}_cloudbuild`
    staging-bucket delete tolerates an already-gone bucket.
    """
    ids = gcloud.builds.ongoing_autosuspend_ids(config.region, config.environment)
    if ids:
        log(f"Cancelling in-flight auto-suspend Cloud Builds: {' '.join(ids)}")
        for build_id in ids:
            gcloud.builds.cancel(build_id, region=config.region)
    log(f"Deleting Cloud Build staging bucket gs://{config.project}_cloudbuild")
    gcloud.storage.remove_recursive(f"gs://{config.project}_cloudbuild")


@dataclass(frozen=True)
class GcpContext:
    """Every wired collaborator a `gcp` command dispatches to, from one resolved config."""

    config: GcpConfig
    gcloud: Gcloud
    tofu: Tofu
    env: Environment
    deps: ApplyDeps
    lifecycle: Lifecycle
    deploy: Deploy
    secrets: Secrets
    dns: Dns
    db: Db
    teardown: Teardown
    gke: Gke
    bootstrap: Bootstrap
    state_recovery: StateLockRecovery


def build_context(*, auto_approve: bool = False) -> GcpContext:
    """Resolve config, construct the collaborator graph + `Lifecycle` — the boundary's factory."""
    config = resolve_config()
    gcloud = Gcloud(config.project)
    tofu = Tofu(TF_DIR)
    gh = Gh()
    env = Environment(config, tofu=tofu, gcloud=gcloud, kubectl=Kubectl(), helm=Helm())

    deps = ApplyDeps(
        ensure_tfvars=ensure_tfvars,
        require_state_bucket=lambda: require_state_bucket(gcloud, config.state_bucket),
        wait_for_no_autosuspend_build=lambda: wait_for_no_autosuspend_build(gcloud, config),
        ar_iam_addr_file=_AR_IAM_ADDR_FILE,
    )
    deploy = Deploy(gh=gh, tofu=tofu)
    secrets = Secrets(gh=gh, tofu=tofu)
    dns = Dns(config=config, gcloud=gcloud, tofu=tofu)
    db = Db(config, gcloud, tofu)
    teardown = Teardown(config, gcloud, tofu)
    gke = Gke(config, tofu, env.kubectl, env.helm)
    bootstrap = Bootstrap(
        config=config,
        gcloud=gcloud,
        ensure_tfvars=ensure_tfvars,
        state_lifecycle=_STATE_LIFECYCLE,
    )
    lifecycle = Lifecycle(
        env,
        deps,
        deploy=deploy,
        secrets=secrets,
        dns=dns,
        bootstrap=bootstrap,
        db=db,
        teardown=teardown,
        cleanup_builds=lambda: cleanup_builds(gcloud, config),
        auto_approve=auto_approve,
    )
    # Recovery force-unlocks over a SEPARATE non-recovering Tofu so a lock error during its own
    # force_unlock can't re-enter recovery. Then wire that recovery into the orchestrators' `tofu`,
    # so a stuck lock on apply/suspend/resume auto-launches the guided recovery (shell parity) —
    # instead of failing outright and forcing a manual `gcp unlock` + re-run.
    state_recovery = StateLockRecovery(
        config=config,
        gcloud=gcloud,
        gh=gh,
        tofu=Tofu(TF_DIR),
        deploy_run_id=os.environ.get("DEPLOY_RUN_ID", ""),
        auto_approve=auto_approve,
    )
    tofu.set_recover(state_recovery.recover)
    return GcpContext(
        config=config, gcloud=gcloud, tofu=tofu, env=env, deps=deps, lifecycle=lifecycle,
        deploy=deploy, secrets=secrets, dns=dns, db=db, teardown=teardown,
        gke=gke, bootstrap=bootstrap, state_recovery=state_recovery,
    )  # fmt: skip
