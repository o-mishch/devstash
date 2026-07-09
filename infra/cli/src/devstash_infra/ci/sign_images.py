"""ci/sign_images.py — sign every deployed digest for Binary Authorization.

CLI zone (3.14). Port of infra/ci/sign-images.sh — the CI half of "step 2" in the GKE module's
enforcement path: attestations are PROVEN to land BEFORE the cluster rule is ever switched from
ALWAYS_ALLOW to REQUIRE_ATTESTATION. Hard-fails on error — enforcement is off, so a signing failure
cannot brick a live deploy, but a silent failure would hide a broken pipeline from whoever
eventually flips enforcement on. KMS does the signing; no private key ever touches the runner.

The calling step gates on `BINAUTHZ_ATTESTOR != ''`, and validate_inputs guarantees the three
BINAUTHZ_* values are all-set-or-all-unset, so gating on the attestor alone is sufficient here.
"""

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.common import log, ok


def sign_images(
    gcloud: Gcloud,
    *,
    image_uri: str,
    web_digest: str,
    migrate_image: str,
    attestor: str,
    keyring: str,
    key: str,
) -> None:
    """KMS-sign the web (uri@digest) and migrate artifacts for Binary Authorization; raise on error.

    The web artifact is `<image_uri>@<web_digest>` (an immutable by-digest ref); `migrate_image` is
    already the full by-digest ref build-push emitted, so it is signed as-is.
    """
    artifacts = [f"{image_uri}@{web_digest}", migrate_image]
    for artifact in artifacts:
        log(f"Signing {artifact} for Binary Authorization…")
        gcloud.container.sign_attestation(artifact, attestor=attestor, keyring=keyring, key=key)
        ok(f"attestation created for {artifact}")
