"""cloudbuild/env.py — the Cloud Build substitution contract, parsed once into a typed shape.

3.14 floor, stdlib-only — this whole subpackage runs on cloud-sdk:slim's bundled Cloud SDK
python3 (3.14.5, located via `gcloud info`) with zero install. Ports the `$_VAR` env-var
contract the six auto-suspend step scripts read
(auto-suspend.tf:194-219 maps every substitution onto every step's `env`, so each step sees the
full set). The shell read these as ambient `$_FOO`; here they parse ONCE into a frozen `BuildEnv`
so a missing/malformed value fails loudly at the entrypoint (with the offending key) instead of
surfacing as an empty string mid-teardown.

The `WORKSPACE_*` paths are the fixed Cloud Build filesystem contract the steps share: the shim
git-clones the repo into `REPO_DIR`, the guard writes `SUSPEND_SENTINEL`, prepare drops fetched
secrets under `SECRETS_DIR`, and the new tofu-bin extract step (Option 4) drops the digest-pinned
static tofu binary into `TOFU_BIN_DIR` for the suspend step to run from.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from devstash_infra.shared.errors import InfraError

# Cloud Build's shared per-build volume (auto-suspend.tf). Everything a step writes here is visible
# to later steps — the mechanism the port uses to hand the pinned tofu binary from the opentofu
# image to the cloud-sdk:slim suspend step, and to carry the /workspace/SUSPEND idle sentinel.
WORKSPACE = Path("/workspace")
REPO_DIR = WORKSPACE / "repo"  # the shim's shallow git clone of the repo
SUSPEND_SENTINEL = WORKSPACE / "SUSPEND"  # guard writes it; steps 2-6 skip when it is absent
TOFU_BIN_DIR = WORKSPACE / "bin"  # the extract step drops the pinned static tofu binary here
TF_DIR = REPO_DIR / "infra/terraform/envs/dev"  # the OpenTofu root the suspend apply runs in
# The committed AR-IAM address data file (reconcile reads it). Lives in the clone under infra/data/,
# so both the loop (reconcile_ar_iam) and the CLI's laptop path read the one shared copy.
AR_IAM_ADDR_FILE = REPO_DIR / "infra/data/ar-iam-member-addresses.txt"


def _require(environ: Mapping[str, str], key: str) -> str:
    """Return a non-empty substitution value, or raise loudly naming the missing key."""
    value = environ.get(key, "")
    if not value:
        raise InfraError(f"auto-suspend build env is missing required substitution {key}")
    return value


def _require_int(environ: Mapping[str, str], key: str) -> int:
    """Return an integer substitution value, or raise naming the key + the bad value."""
    raw = _require(environ, key)
    try:
        return int(raw)
    except ValueError:
        raise InfraError(f"auto-suspend build env {key}={raw!r} is not an integer") from None


def _optional_int(environ: Mapping[str, str], key: str, default: int) -> int:
    """Return an int, `default` when unset/empty, else raise naming the key + the bad value."""
    raw = environ.get(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        raise InfraError(f"auto-suspend build env {key}={raw!r} is not an integer") from None


@dataclass(frozen=True)
class BuildEnv:
    """The typed auto-suspend build environment — one parse of the `$_VAR` substitutions.

    Fields mirror the substitution names (auto-suspend.tf `auto_suspend_build_env`); `secret_keys`
    is the space-separated `_SECRET_KEYS` split into the third-party key list prepare extracts.
    """

    project_id: str
    region: str
    state_bucket: str
    repo_slug: str
    repo_branch: str
    secret_keys: tuple[str, ...]
    nonsecret_b64: str
    idle_window_s: int
    max_uptime_s: int
    db_instance: str
    db_dumps_bucket: str
    db_dump_object: str
    db_dump_keep: int
    vpc: str
    build_id: str
    trigger_name: str

    @classmethod
    def from_environ(cls, environ: Mapping[str, str]) -> BuildEnv:
        """Parse the `$_VAR` substitutions into a `BuildEnv`, raising on any missing/malformed key.

        `_DB_DUMP_KEEP` defaults to 2 (the shell default) when unset; every other key is required
        because Cloud Build maps the full substitution set onto every step (auto-suspend.tf).
        """
        return cls(
            project_id=_require(environ, "_PROJECT_ID"),
            region=_require(environ, "_REGION"),
            state_bucket=_require(environ, "_STATE_BUCKET"),
            repo_slug=_require(environ, "_REPO_SLUG"),
            repo_branch=_require(environ, "_REPO_BRANCH"),
            secret_keys=tuple(_require(environ, "_SECRET_KEYS").split()),
            nonsecret_b64=_require(environ, "_NONSECRET_B64"),
            idle_window_s=_require_int(environ, "_IDLE_WINDOW"),
            max_uptime_s=_require_int(environ, "_MAX_UPTIME"),
            db_instance=_require(environ, "_DB_INSTANCE"),
            db_dumps_bucket=_require(environ, "_DB_DUMPS_BUCKET"),
            db_dump_object=_require(environ, "_DB_DUMP_OBJECT"),
            db_dump_keep=_optional_int(environ, "_DB_DUMP_KEEP", 2),
            vpc=_require(environ, "_VPC"),
            build_id=_require(environ, "_BUILD_ID"),
            trigger_name=_require(environ, "_TRIGGER_NAME"),
        )

    @property
    def dump_uri(self) -> str:
        """The GCS URI the DB dump exports to (dump step) — `gs://<bucket>/<object>`."""
        return f"gs://{self.db_dumps_bucket}/{self.db_dump_object}"
