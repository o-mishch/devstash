"""Top-level typer app + console-script entrypoint (`devstash-infra`).

Mounts the three sub-apps (gcp / local / ci), installs structured logging (obs.py)
and a runtime floor assertion. Sub-apps are attached as they are ported; this
scaffold wires the skeleton so `uv sync` and `devstash-infra --help` resolve.
"""

import os
import sys
import uuid

import typer

from devstash_infra import obs
from devstash_infra.app_gcp import gcp_app
from devstash_infra.app_local import local_app
from devstash_infra.ci.app import ci_app

# Runtime floor assertion (defense-in-depth §Idempotency & runtime floor assertion).
# Single floor: 3.14. The Cloud Build path runs cloud-sdk:slim's bundled Cloud SDK
# Python 3.14.5; dev/CI run 3.14 too. If a caller somehow launches on an older
# interpreter, fail loud and immediately rather than mid-operation.
if sys.version_info < (3, 14):  # noqa: UP036  # pragma: no cover - deliberate runtime floor guard
    raise SystemExit(f"devstash-infra requires Python >= 3.14, got {sys.version.split()[0]}")

app = typer.Typer(
    name="devstash-infra",
    help="Typed Python port of the DevStash infra/ shell layer.",
    no_args_is_help=True,
    add_completion=False,
)


def _resolve_run_id() -> str:
    """A correlation id for this invocation: the CI run id when present, else a fresh uuid4.

    Mirrors the Cloud Build path's precedence (`cloudbuild/__main__` reads `$BUILD_ID`) so a CLI
    run triggered inside GitHub Actions correlates to its workflow run, and a local run still gets
    a unique id for its JSON log stream.
    """
    return os.environ.get("GITHUB_RUN_ID") or os.environ.get("BUILD_ID") or uuid.uuid4().hex


@app.callback()
def bootstrap() -> None:
    """Configure the structured-logging stream once before any sub-app dispatch (§Observability)."""
    obs.configure(_resolve_run_id())


# The three sub-apps: `ci` (deploy-gke.yml steps), `gcp` (run.sh dispatch), `local` (kind stack).
app.add_typer(ci_app, name="ci")
app.add_typer(gcp_app, name="gcp")
app.add_typer(local_app, name="local")


if __name__ == "__main__":  # pragma: no cover
    app()
