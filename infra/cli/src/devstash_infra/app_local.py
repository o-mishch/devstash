"""app_local.py — the `devstash-infra local <cmd>` typer sub-app: the run/local/run.sh boundary.

One command per local verb (up/deploy/status/info/down), each the THIN boundary the `LocalStack`
orchestrator was built for: run `preflight()` where the shell did, build the stack via
`local.stack.build_stack()`, and dispatch inside `runtime.guard()` so an `InfraError`/`die` deep in
the orchestration becomes a clean red message + exit code, never a traceback. No policy lives here;
`LocalStack` holds the lifecycle. Mirrors `app_gcp.py`.
"""

import typer

from devstash_infra.local.stack import build_stack, preflight
from devstash_infra.runtime import guard

local_app = typer.Typer(
    name="local",
    help="Local kind stack lifecycle (bring-up, fast deploy, status, teardown).",
    no_args_is_help=True,
    add_completion=False,
)


@local_app.command("up")
def cmd_up() -> None:
    """Bring the whole local stack up on kind: cluster → images → services → migrate → app."""
    with guard():
        preflight()
        build_stack().up()


@local_app.command("deploy")
def cmd_deploy() -> None:
    """Fast app-only iterate: rebuild + reload images, re-run migrate, roll out web."""
    with guard():
        preflight()
        build_stack().deploy()


@local_app.command("status")
def cmd_status() -> None:
    """Print a cluster / app / deep-health summary (requires a running kind cluster)."""
    with guard():
        build_stack().status()


@local_app.command("info")
def cmd_info() -> None:
    """Print all local service URLs (app, Postgres, MinIO, Mailpit, Valkey, billing hint)."""
    with guard():
        build_stack().info()


@local_app.command("down")
def cmd_down() -> None:
    """Tear down the kind cluster (state-tracked OpenTofu destroy)."""
    with guard():
        build_stack().down()
