"""ci/actions.py — GitHub Actions workflow-command helpers (step outputs + annotations).

CLI zone (3.14). The `ci/` steps run as `deploy-gke.yml` `run:` steps and speak the Actions
protocol: a step output is `name=value` appended to `$GITHUB_OUTPUT` (consumed by a downstream
`if: steps.X.outputs.Y == '…'`), and an annotation is a `::warning::…` line on stdout the runner
surfaces in the UI. Both are stdout/file writes that bypass the human console stream (`common.log`
et al. go to stderr), so they live here behind named helpers rather than raw writes at call sites.
"""

import os
import sys
from pathlib import Path


def set_output(name: str, value: str) -> None:
    """Append a step output `name=value` to `$GITHUB_OUTPUT` (no-op outside Actions).

    Single-line values only (all current outputs are `synced=true|false`); the multiline heredoc
    form is not needed. When `$GITHUB_OUTPUT` is unset (a local run) this is a no-op — the output
    only matters to a downstream workflow step.
    """
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def set_env(name: str, value: str) -> None:
    """Append `name=value` to `$GITHUB_ENV` so LATER steps in the same job inherit it as env.

    Single-line values only (build-push exports IMAGE_URI/WEB_DIGEST/MIGRATE_IMAGE). No-op outside
    Actions (`$GITHUB_ENV` unset), same as `set_output`.
    """
    path = os.environ.get("GITHUB_ENV")
    if not path:
        return
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def warning(message: str) -> None:
    """Emit a GitHub Actions `::warning::` annotation on stdout (captured by the runner)."""
    # Actions workflow commands are a stdout protocol, distinct from the human console (stderr).
    sys.stdout.write(f"::warning::{message}\n")
