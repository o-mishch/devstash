"""gcp/context.py — build the fully-wired collaborator graph from resolved config. CLI zone.

The app-plumbing the shell kept as run.sh globals: resolve config via `gcp/tfvars.resolve_config()`,
then construct the `Environment` + every collaborator (`Deploy`/`Secrets`/`Dns`/`Db`/`Teardown`/
`Gke`) and the `Lifecycle` orchestrator over them, plus the real `ApplyDeps`. `gcp/app.py` (the
typer boundary) calls `build_context()` once per command and dispatches to the piece it needs — no
logic lives here beyond the wiring + `preflight`/`auto_approve_from_env`. The tfvars reader lives
in `gcp/tfvars.py`; the apply-serialisation helpers in `gcp/apply_gate.py`.
"""

import os
import shutil
from dataclasses import dataclass

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.gh import Gh
from devstash_infra.clients.helm import Helm
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import log, ok
from devstash_infra.gcp.apply_gate import (
    cleanup_builds,
    require_state_bucket,
    wait_for_no_autosuspend_build,
)
from devstash_infra.gcp.bootstrap import Bootstrap
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.db import Db
from devstash_infra.gcp.deploy import Deploy
from devstash_infra.gcp.dns import Dns
from devstash_infra.gcp.environment import ApplyDeps, Environment
from devstash_infra.gcp.gke import Gke
from devstash_infra.gcp.lifecycle import Lifecycle
from devstash_infra.gcp.secrets import Secrets
from devstash_infra.gcp.state_recovery import StateLockRecovery
from devstash_infra.gcp.teardown import Teardown
from devstash_infra.gcp.tfvars import TF_DIR, ensure_tfvars, resolve_config
from devstash_infra.paths import repo_path
from devstash_infra.shared.errors import InfraError

_AR_IAM_ADDR_FILE = str(repo_path("infra/data/ar-iam-member-addresses.txt"))
_STATE_LIFECYCLE = str(repo_path("infra/data/tfstate-lifecycle.json"))

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
        config=config,
        gcloud=gcloud,
        tofu=tofu,
        env=env,
        deps=deps,
        lifecycle=lifecycle,
        deploy=deploy,
        secrets=secrets,
        dns=dns,
        db=db,
        teardown=teardown,
        gke=gke,
        bootstrap=bootstrap,
        state_recovery=state_recovery,
    )
