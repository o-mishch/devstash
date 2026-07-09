"""paths.py — anchor repo-relative data paths to the repo root, not the process cwd. CLI zone.

The operator CLI (`gcp`/`local`) is normally launched with `uv run devstash-infra …` from
`infra/cli/`, so a bare relative `infra/terraform/…` would resolve against THAT dir and miss (the
shell scripts assumed cwd == repo root; `uv run` does not). Every repo-relative file the operator
surface reads (tofu roots, terraform.tfvars, versions.env, kustomize bases, the AR-IAM data file)
is resolved through `repo_path()` so the commands work from anywhere under the repo — matching the
documented invocation.

`ci/` steps run under GitHub Actions with cwd == repo root (their own contract) and the Cloud Build
path has its own `/workspace/repo` clone anchor, so those two regimes keep their existing relative /
clone-anchored paths; only the human-invoked operator surface routes through here.
"""

from __future__ import annotations

from pathlib import Path


def _find_repo_root() -> Path:
    """Walk up from this module to the repo root, identified by the `infra/terraform` tree.

    Falls back to the fixed src-layout depth (devstash_infra → src → cli → infra → root) if the
    marker is absent — an unusual install of the package outside the repo checkout.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "infra" / "terraform").is_dir():
            return parent
    return here.parents[4]


REPO_ROOT = _find_repo_root()


def repo_path(rel: str) -> Path:
    """Resolve a repo-relative path (e.g. `"infra/versions.env"`) against REPO_ROOT."""
    return REPO_ROOT / rel
