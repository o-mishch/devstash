"""ci/env.py — read the deploy-gke.yml per-step env contract + the fixed repo paths. CLI zone.

The ci steps' config is NOT one monolithic object (unlike cloudbuild's `BuildEnv`): deploy-gke.yml
passes a DIFFERENT env subset to each step (job constants + repo vars + build-push outputs). So the
`ci` boundary reads each step's specific vars here and passes them as params. `require` mirrors the
shell's `: "${VAR:?}"` fail-fast; `optional` mirrors `${VAR:-default}` (GH Actions sets an undefined
repo var to EMPTY, so empty == unset).
"""

import os
from pathlib import Path

from devstash_infra.common import DEVSTASH_NS  # re-exported below (ci steps read env.DEVSTASH_NS)
from devstash_infra.shared.errors import InfraError

__all__ = ["DEVSTASH_NS", "optional", "optional_int", "require"]

# Fixed repo paths the steps read/write, relative to the CI working dir (repo root). RENDERED_PATH /
# BAKE_METADATA are shared ACROSS separate `devstash-infra ci` invocations in one job, so they must
# be the same fixed paths the shell used — not per-process temp files.
OVERLAY_DIR = Path("infra/k8s/overlays/gcp")
RENDERED_PATH = Path("/tmp/rendered.yaml")  # noqa: S108 — fixed cross-step path (matches the shell)
MIGRATE_MANIFEST = OVERLAY_DIR / "migrate-job.yaml"
MIGRATIONS_ROOT = Path("prisma/migrations")
BAKE_FILE = Path("infra/data/docker-bake.hcl")
BAKE_METADATA = Path("/tmp/meta-bake.json")  # noqa: S108 — fixed path (matches the shell)


def require(name: str) -> str:
    """The env var `name`, or raise `InfraError` if it is unset/empty (the shell's `${VAR:?}`)."""
    value = os.environ.get(name, "")
    if not value:
        raise InfraError(f"required GitHub deployment input {name} is not set")
    return value


def optional(name: str, default: str = "") -> str:
    """The env var `name`, or `default` when unset/empty (the shell's `${VAR:-default}`)."""
    return os.environ.get(name) or default


def optional_int(name: str, default: int) -> int:
    """The env var `name` parsed as int, or `default` when unset/empty (the shell's `${VAR:-n}`)."""
    raw = os.environ.get(name) or ""
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise InfraError(f"env var {name} must be an integer, got {raw!r}") from exc
