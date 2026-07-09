"""cloudbuild/prepare.py — step 2: reconstruct the tofu tfvars from Secret Manager. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-prepare.sh. Drop the non-secret tfvars (base64 in
the substitution) and reconstruct the app/Spaceship secret tfvars from Secret Manager, so the
suspend apply re-supplies the required `third_party_secrets` (rather than wiping them) while
setting `environment_active=false`.

FATAL-on-empty is deliberate (unlike the tolerant laptop reads that share the same resolver):
prepare MUST have the consolidated secret to rebuild the tfvars, so an absent ENABLED version
aborts the suspend rather than silently continuing with a wiped credential. The newest-ENABLED
resolution [fix #14] is the shared `shared/secrets.newest_enabled_secret_version`; the tfvars
assembly is the shared `cloudbuild/secrets_tfvars.build_secrets_tfvars`. Unlike the shell (which
staged the fetched blobs to /workspace/sec so a separate python helper could read them), this is
one process — the payloads stay in memory and never touch disk.
"""

import base64
import json
import logging
from pathlib import Path
from typing import cast

from devstash_infra.cloudbuild.env import SUSPEND_SENTINEL, TF_DIR, BuildEnv
from devstash_infra.cloudbuild.secrets_tfvars import build_secrets_tfvars
from devstash_infra.shared import proc
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.secrets import newest_enabled_secret_version

log = logging.getLogger(__name__)

APP_CONFIG_SECRET = "devstash-app-config"  # noqa: S105 — a Secret Manager resource NAME, not a value
OPS_CONFIG_SECRET = "devstash-ops-config"  # noqa: S105 — opt-in DNS ops creds (a project may omit it)

_NONSECRET_TFVARS = "zz-nonsecret.auto.tfvars.json"
_SECRETS_TFVARS = "zz-secrets.auto.tfvars.json"


def _fetch_enabled_secret(secret: str, project: str) -> dict[str, str]:
    """Access `secret`'s newest ENABLED version and parse its JSON blob — FATAL on any gap.

    An absent ENABLED version, an access failure, or an unparseable payload each raise: prepare
    cannot rebuild the tfvars without this secret, so it must fail the build, not continue.
    """
    version = newest_enabled_secret_version(secret, project)
    if not version:
        raise InfraError(f"{secret} has no ENABLED version — cannot proceed")
    # check=True: an access failure (version exists but denied/transient) is fatal here.
    payload = proc.run(
        [
            "gcloud",
            "secrets",
            "versions",
            "access",
            version,
            f"--secret={secret}",
            f"--project={project}",
        ],
    ).out
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise InfraError(f"{secret} payload is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        # A payload that parses to a JSON string/number/array would slip past the cast and blow up
        # later as a TypeError/KeyError past the InfraError-only boundary — fail loud here instead.
        raise InfraError(f"{secret} payload is not a JSON object")
    return cast("dict[str, str]", parsed)


def prepare(env: BuildEnv, *, tf_dir: Path = TF_DIR, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Write the non-secret + reconstructed-secret tfvars into `tf_dir`. No-op unless idle."""
    if not sentinel.exists():
        log.info("not idle — skipping prepare")
        return

    # The non-secret tfvars ride in as base64 (auto-suspend.tf) — decode straight to the tofu-
    # autoloaded file. Written as bytes: it is already serialized JSON, not re-encoded here.
    (tf_dir / _NONSECRET_TFVARS).write_bytes(base64.b64decode(env.nonsecret_b64))

    app_config = _fetch_enabled_secret(APP_CONFIG_SECRET, env.project_id)
    # Ops DNS creds are opt-in — a project without them omits the secret, so only fetch when it
    # exists. Same newest-ENABLED resolution as app-config above.
    ops_config: dict[str, str] | None = None
    if proc.run_ok(
        ["gcloud", "secrets", "describe", OPS_CONFIG_SECRET, f"--project={env.project_id}"]
    ):
        ops_config = _fetch_enabled_secret(OPS_CONFIG_SECRET, env.project_id)

    tfvars = build_secrets_tfvars(app_config, ops_config, env.secret_keys)
    (tf_dir / _SECRETS_TFVARS).write_text(json.dumps(tfvars))
    log.info("prepared tofu tfvars — non-secret + %d third-party secret(s)", len(env.secret_keys))
