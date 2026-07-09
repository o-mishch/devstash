"""gcp/tfvars.py — pre-init tfvars reader + config resolution. CLI zone (3.14).

Reads `terraform.tfvars` BY HAND (before `tofu init`, so no tofu) and derives the immutable
`GcpConfig` the whole gcp surface runs on, plus the placeholder guard. Split out of `gcp/context.py`
so the config-resolution logic is reusable without importing the whole collaborator factory (run.sh
kept these as globals; here they are one leaf module the factory consumes).
"""

import os
import re
from pathlib import Path

from devstash_infra.common import warn
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.paths import repo_path
from devstash_infra.shared.errors import InfraError

# Repo-anchored paths (run.sh:122-144). The shell assumed cwd == repo root for
# `bash infra/run/gcp/run.sh`; `uv run devstash-infra` runs from infra/cli/, so we anchor to the
# repo root explicitly (see paths.py) rather than depend on the caller's cwd.
TF_DIR = str(repo_path("infra/terraform/envs/dev"))
_TFVARS = Path(TF_DIR) / "terraform.tfvars"
_TFVARS_EXAMPLE = Path(TF_DIR) / "terraform.tfvars.example"
_DB_NAME = "devstash"  # logical DB inside the Cloud SQL instance (run.sh:144)

# Unfilled third_party_secrets placeholders from terraform.tfvars.example (run.sh:479).
_PLACEHOLDER_RE = re.compile(r"sk_\.\.\.|whsec_\.\.\.|re_\.\.\.|openssl rand")
# A scalar `key = value` line (list/object/heredoc shapes this pre-init reader rejects).
_SCALAR_RE = re.compile(r"^\s*(?P<key>[A-Za-z0-9_]+)\s*=\s*(?P<rhs>.*)$")


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
