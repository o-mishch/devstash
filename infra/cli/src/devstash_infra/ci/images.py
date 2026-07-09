"""ci/images.py — Artifact Registry image coordinates. CLI zone (3.14).

Ports the shared `ds_image_base` + `DEVSTASH_IMAGES` from lib/common.sh — the SAME coordinates the
CI build-push and prune-registry steps use, kept in one place so a repo/region/name change lands
once. No gcloud here — pure string coordinates.
"""

KNOWN_IMAGES = ("web", "migrate")  # the build's runtime images (ports DEVSTASH_IMAGES)


def image_base(region: str, project: str, repo: str) -> str:
    """The Artifact Registry repo path every image lives under (ports ds_image_base)."""
    return f"{region}-docker.pkg.dev/{project}/{repo}"
