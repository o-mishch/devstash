"""ci/inject_settings.py — inject per-environment values into the overlay before rendering.

CLI zone (3.14). Port of infra/ci/inject-settings.sh. Mutates the overlay's single source of truth
(settings.yaml) IN PLACE; kustomize `replacements` then fan the values into the WI SA annotation,
HTTPRoute host, Gateway cert-map/static-IP, NEXTAUTH_URL, etc. The web image is pinned separately in
kustomization.yaml (its digest is build output, not env config), BY NAME not index so a prepended
sidecar entry can't silently leave web at `:latest`.

GCP_PROJECT_ID is REQUIRED and guarded LOUDLY here [incident]: yq's `strenv` returns "" for an unset
var, which would render projectId="" and saEmail="devstash-app@.iam.gserviceaccount.com" — a
malformed SA email that makes ESO's SecretStore fail InvalidProviderConfig, so the ExternalSecret
never syncs and wait-secrets-sync blocks its whole timeout (exactly what happened when the render
job was split out of `deploy` without carrying this var). The optional app-config vars fall back to
the committed settings.yaml value on empty (`select(. != "") // <existing>`). The ingress-IP /
cert-map / armor / bucket names are DERIVED from the Terraform name_prefix "devstash-dev" rather
than read from `tofu output` (which would need remote-state auth in CI); update BOTH these literals
AND deploy-gke.yml's CLUSTER if `var.environment` is ever renamed.
"""

from pathlib import Path

import typer

from devstash_infra.clients.yq import Yq
from devstash_infra.common import log
from devstash_infra.shared.errors import InfraError

# settings.yaml transform — strenv() returns "" for empty/unset (no error under GH Actions' empty
# repo vars); `select(. != "")` drops the empty so `//` keeps the committed default.
_SETTINGS_EXPR = """
  .data.projectId            = strenv(GCP_PROJECT_ID) |
  .data.saEmail              = "devstash-app@" + strenv(GCP_PROJECT_ID) + ".iam.gserviceaccount.com" |
  .data.domain               = strenv(APP_DOMAIN) |
  .data.emailFrom            = strenv(EMAIL_FROM) |
  .data.nextAuthUrl          = "https://" + strenv(APP_DOMAIN) |
  .data.ingressIpName        = "devstash-dev-ip" |
  .data.certMapName          = "devstash-dev-certmap" |
  .data.armorPolicyName      = ({"true": "devstash-dev-armor"} | .[strenv(ARMOR_ENABLED)] // "") |
  .data.s3Bucket             = strenv(GCP_PROJECT_ID) + "-devstash-dev-uploads" |
  .data.authGithubId         = ((strenv(AUTH_GITHUB_ID) | select(. != "")) // .data.authGithubId) |
  .data.authGoogleId         = ((strenv(AUTH_GOOGLE_ID) | select(. != "")) // .data.authGoogleId) |
  .data.stripePublishableKey = ((strenv(STRIPE_PUBLISHABLE_KEY) | select(. != "")) // .data.stripePublishableKey) |
  .data.stripePriceIdMonthly = ((strenv(STRIPE_PRICE_ID_MONTHLY) | select(. != "")) // .data.stripePriceIdMonthly) |
  .data.stripePriceIdYearly  = ((strenv(STRIPE_PRICE_ID_YEARLY) | select(. != "")) // .data.stripePriceIdYearly)
"""  # noqa: E501 — verbatim yq transform (parity); wrapping would change the expression

# Pin the web image to the immutable registry digest — select BY NAME (index-independent).
_IMAGE_EXPR = """
  (.images[] | select(.name == "devstash")) |= (
    .newName = strenv(IMAGE_URI) |
    .digest = strenv(WEB_DIGEST) |
    del(.newTag)
  )
"""


def inject_settings(
    yq: Yq,
    *,
    overlay_dir: Path,
    project_id: str,
    app_domain: str,
    email_from: str,
    image_uri: str,
    web_digest: str,
    armor_enabled: str = "",
    auth_github_id: str = "",
    auth_google_id: str = "",
    stripe_publishable_key: str = "",
    stripe_price_id_monthly: str = "",
    stripe_price_id_yearly: str = "",
) -> None:
    """Inject env values into settings.yaml and pin the web image in kustomization.yaml. Raises."""
    if not project_id:
        raise InfraError(
            "GCP_PROJECT_ID must be set and non-empty",
            hint=(
                "an empty value renders projectId= and a malformed saEmail, breaking the ESO "
                "SecretStore and stalling the deploy on wait-secrets-sync"
            ),
        )

    log("Injecting per-environment settings into the GCP overlay…")
    settings_env = {
        "GCP_PROJECT_ID": project_id,
        "APP_DOMAIN": app_domain,
        "EMAIL_FROM": email_from,
        "ARMOR_ENABLED": armor_enabled,
        "AUTH_GITHUB_ID": auth_github_id,
        "AUTH_GOOGLE_ID": auth_google_id,
        "STRIPE_PUBLISHABLE_KEY": stripe_publishable_key,
        "STRIPE_PRICE_ID_MONTHLY": stripe_price_id_monthly,
        "STRIPE_PRICE_ID_YEARLY": stripe_price_id_yearly,
    }
    yq.eval_in_place(_SETTINGS_EXPR, str(overlay_dir / "settings.yaml"), env_extra=settings_env)
    yq.eval_in_place(
        _IMAGE_EXPR,
        str(overlay_dir / "kustomization.yaml"),
        env_extra={"IMAGE_URI": image_uri, "WEB_DIGEST": web_digest},
    )

    typer.echo("--- settings.yaml after injection ---")
    typer.echo((overlay_dir / "settings.yaml").read_text())
