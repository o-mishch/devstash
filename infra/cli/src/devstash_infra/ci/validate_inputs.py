"""ci/validate_inputs.py — fail the deploy BEFORE builds/auth if a required input is missing.

CLI zone (3.14). Port of infra/ci/validate-inputs.sh. Empty GitHub secrets/variables expand to
empty strings; without this guard the failures surface much later as malformed image names, STS
errors, or a Gateway/HTTPRoute with an empty host. Raises `InfraError` (the ci boundary maps it to
an `::error::` annotation + exit 1) — never a silent pass.
"""

import re

from devstash_infra.shared.errors import InfraError

# A bare lowercase hostname — no scheme, port, or path — that also contains a dot (a real FQDN).
_HOSTNAME_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$")


def validate_inputs(
    *,
    project_id: str,
    wif_provider: str,
    deployer_sa: str,
    app_domain: str,
    binauthz_attestor: str = "",
    binauthz_keyring: str = "",
    binauthz_key: str = "",
) -> None:
    """Validate the required deployment inputs; raise `InfraError` on the first problem.

    Required inputs must be non-empty (checked in the shell's order). Binary Authorization is
    optional but all-or-nothing: a partial config (attestor set, keyring/key missing) would fail
    signing mid-deploy, so it is rejected up front. `app_domain` must be a bare FQDN.
    """
    required = {
        "GCP_PROJECT_ID": project_id,
        "WORKLOAD_IDENTITY_PROVIDER": wif_provider,
        "DEPLOYER_SA": deployer_sa,
        "APP_DOMAIN": app_domain,
    }
    for name, value in required.items():
        if not value:
            raise InfraError(f"required GitHub deployment input is missing: {name}")

    binauthz = {
        "BINAUTHZ_ATTESTOR": binauthz_attestor,
        "BINAUTHZ_KMS_KEYRING": binauthz_keyring,
        "BINAUTHZ_KMS_KEY": binauthz_key,
    }
    if any(binauthz.values()):
        for name, value in binauthz.items():
            if not value:
                raise InfraError(
                    f"Binary Authorization is partially configured — {name} is missing "
                    "(set all three, or none)"
                )

    if not _HOSTNAME_RE.match(app_domain) or "." not in app_domain:
        raise InfraError("APP_DOMAIN must be a lowercase hostname without scheme, port, or path")
