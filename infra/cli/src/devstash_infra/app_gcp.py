"""app_gcp.py — the `devstash-infra gcp <cmd>` typer sub-app: the run.sh dispatch boundary.

One command per run.sh verb. Each is the THIN boundary the ported collaborators were built for:
resolve config + wire the collaborator graph via `gcp/context.build_context()`, run the dispatch
inside `runtime.guard()` (so an `InfraError` deep in the orchestration becomes a clean red message +
exit code, never a traceback), and — for the few verbs that take operator input — resolve prompts to
already-resolved params before calling the method (the "boundary resolves input → params" pattern).
No policy lives here; the `Lifecycle`/`Gke`/`Db`/`Dns` methods hold the logic.
"""

import typer

from devstash_infra.common import read_secret
from devstash_infra.gcp.context import (
    VERSIONS_ENV,
    auto_approve_from_env,
    build_context,
    ensure_tfvars,
    preflight,
    require_state_bucket,
)
from devstash_infra.runtime import guard

gcp_app = typer.Typer(
    name="gcp",
    help="GCP environment lifecycle (bring-up, deploy, suspend/resume, teardown).",
    no_args_is_help=True,
    add_completion=False,
)


# ── bring-up / apply ─────────────────────────────────────────────────────────
@gcp_app.command("up")
def cmd_up() -> None:
    """First-ever / post-down bring-up: bootstrap + provision + overlapped deploy."""
    with guard():
        preflight()
        build_context(auto_approve=auto_approve_from_env()).lifecycle.up()


@gcp_app.command("bootstrap")
def cmd_bootstrap() -> None:
    """Provision the GCP prerequisites (project / billing / state bucket / APIs)."""
    with guard():
        preflight()
        auto_approve = auto_approve_from_env()
        build_context(auto_approve=auto_approve).bootstrap.run(auto_approve=auto_approve)


@gcp_app.command("apply")
def cmd_apply() -> None:
    """Apply the reviewed plan, overlapping the CI image build with the provision."""
    with guard():
        preflight()
        build_context(auto_approve=auto_approve_from_env()).lifecycle.apply_with_overlap()


# ── suspend / resume ─────────────────────────────────────────────────────────
@gcp_app.command("suspend")
def cmd_suspend() -> None:
    """Deep-suspend to ~$0: dump + verify the DB, then destroy compute + Cloud SQL."""
    with guard():
        preflight()
        build_context(auto_approve=auto_approve_from_env()).lifecycle.suspend()


@gcp_app.command("resume")
def cmd_resume() -> None:
    """Bring the environment back from deep-suspend: recreate, restore the dump, redeploy."""
    with guard():
        preflight()
        build_context(auto_approve=auto_approve_from_env()).lifecycle.resume()


@gcp_app.command("down")
def cmd_down() -> None:
    """Force-destroy the entire environment (buckets + the last DB dump included)."""
    with guard():
        preflight()
        auto_approve = auto_approve_from_env()
        build_context(auto_approve=auto_approve).teardown.down(auto_approve=auto_approve)


# ── operators / secrets ──────────────────────────────────────────────────────
@gcp_app.command("eso")
def cmd_eso() -> None:
    """Install / upgrade the External Secrets Operator to its pinned chart version."""
    with guard():
        build_context().gke.eso(VERSIONS_ENV)


@gcp_app.command("reloader")
def cmd_reloader() -> None:
    """Install / upgrade Stakater Reloader to its pinned chart version."""
    with guard():
        build_context().gke.reloader(VERSIONS_ENV)


@gcp_app.command("upgrade-helm")
def cmd_upgrade_helm() -> None:
    """Bump ESO + Reloader to their latest published chart versions, then reinstall."""
    with guard():
        auto_approve = auto_approve_from_env()
        build_context(auto_approve=auto_approve).gke.upgrade_helm(
            VERSIONS_ENV, ensure_tfvars=ensure_tfvars, auto_approve=auto_approve
        )


@gcp_app.command("secrets")
def cmd_secrets() -> None:
    """Push the tofu outputs to GitHub Actions as secrets/variables, then verify."""
    with guard():
        build_context().secrets.push()


@gcp_app.command("verify-secrets")
def cmd_verify_secrets() -> None:
    """Report which Secret-Manager app-config keys are present + whether ESO has synced."""
    with guard():
        ctx = build_context()
        ctx.gke.verify_secrets(ctx.gcloud)


@gcp_app.command("rotate-secret")
def cmd_rotate_secret(
    name: str = typer.Argument(..., help="the app-config property to rotate"),
) -> None:
    """Replace ONE app-config property, then force ESO to sync it now."""
    with guard():
        ctx = build_context()
        value = read_secret(f"New value for '{name}': ")  # never echoed / never on argv
        ctx.gke.rotate_secret(ctx.gcloud, name=name, value=value)


# ── deploy / observe ─────────────────────────────────────────────────────────
@gcp_app.command("deploy")
def cmd_deploy() -> None:
    """Dispatch the deploy-gke CI workflow (build → push → migrate → rollout)."""
    with guard():
        build_context().deploy.dispatch()


@gcp_app.command("smoke")
def cmd_smoke() -> None:
    """Wait for the latest deploy-gke run, then health-check the public endpoint."""
    with guard():
        build_context().deploy.smoke()


@gcp_app.command("status")
def cmd_status() -> None:
    """Print a read-only picture of the cluster, secrets, ingress, cert, and health."""
    with guard():
        ctx = build_context()
        ctx.gke.status(ctx.gcloud)


@gcp_app.command("logs")
def cmd_logs() -> None:
    """Tail every devstash-web pod's logs (pod-prefixed)."""
    with guard():
        build_context().gke.logs()


# ── database ─────────────────────────────────────────────────────────────────
@gcp_app.command("dump-db")
def cmd_dump_db() -> None:
    """Export + verify the Cloud SQL database to its GCS dump object."""
    with guard():
        build_context().db.dump()


@gcp_app.command("restore-db")
def cmd_restore_db() -> None:
    """Import the latest GCS dump into the live Cloud SQL instance (never over live data)."""
    with guard():
        db = build_context().db
        db.restore(db.resolve_dump_target())


# ── DNS ──────────────────────────────────────────────────────────────────────
@gcp_app.command("update-dns")
def cmd_update_dns(
    ingress_ip: str = typer.Option("", "--ingress-ip", help="override the resolved ingress IP"),
) -> None:
    """Re-point the app's A-record at the current ingress IP via Spaceship (best-effort)."""
    with guard():
        build_context().dns.update(ingress_ip_override=ingress_ip)


@gcp_app.command("set-dns-creds")
def cmd_set_dns_creds() -> None:
    """Store the Spaceship API key + secret in Secret Manager (read without echo)."""
    with guard():
        ctx = build_context()
        key = read_secret("Spaceship API key: ")
        secret = read_secret("Spaceship API secret: ")
        ctx.dns.set_dns_creds(key, secret)


# ── state-lock recovery ──────────────────────────────────────────────────────
@gcp_app.command("unlock")
def cmd_unlock() -> None:
    """Interactively inspect + release a stuck OpenTofu state lock (never breaks a live one)."""
    with guard():
        preflight()
        ctx = build_context(auto_approve=auto_approve_from_env())
        require_state_bucket(ctx.gcloud, ctx.config.state_bucket)
        # force-unlock needs an initialised backend to address the remote lock; init won't contend.
        ctx.tofu.init(ctx.config.state_bucket)
        ctx.state_recovery.recover()
