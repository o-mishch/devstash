"""cloudbuild/secrets_tfvars.py — assemble the auto-suspend secrets tfvars blob. 3.14 floor.

Port of terraform/envs/dev/scripts/build-secrets-tfvars.py (Cloud Build prepare step 2), stdlib-
only so it runs on cloud-sdk:slim's python3 with zero install. Pure assembly: the prepare step
reads the fetched app-config / ops-config JSON off disk and this turns them into the tofu-autoloaded
`*.auto.tfvars.json` object — kept out of an inline heredoc so the logic is lintable/testable.

Extracts ONLY the `third_party_secrets` subset named in `keys` (the user keys), NOT the TF-minted
database-*/redis-*/s3-* properties — Terraform re-derives those infra keys itself on the suspend
apply, matching what `var.third_party_secrets` expects. The Spaceship creds are folded in only when
the ops blob is present (a project without DNS automation omits it; the tofu default is "").
"""

from collections.abc import Mapping, Sequence

# Ops blob property → tofu variable name for the two Spaceship DNS creds.
_SPACESHIP_VARS = (
    ("spaceship_api_key", "spaceship-api-key"),
    ("spaceship_api_secret", "spaceship-api-secret"),
)


def build_secrets_tfvars(
    app_config: Mapping[str, str],
    ops_config: Mapping[str, str] | None,
    keys: Sequence[str],
) -> dict[str, object]:
    """Build the secrets tfvars object: `third_party_secrets` subset + optional spaceship creds.

    A `keys` entry missing from `app_config` raises `KeyError` BY DESIGN — a required
    third_party_secrets key absent from the blob is a real misconfiguration that must fail the
    build, never silently drop the key. `ops_config` is None (or missing a cred) → that var is
    omitted, so a project without DNS automation just gets the tofu default.
    """
    out: dict[str, object] = {"third_party_secrets": {key: app_config[key] for key in keys}}
    if ops_config is not None:
        for var, prop in _SPACESHIP_VARS:
            if ops_config.get(prop):
                out[var] = ops_config[prop]
    return out
