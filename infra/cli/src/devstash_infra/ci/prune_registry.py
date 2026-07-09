"""ci/prune_registry.py — post-rollout prune: collapse every image to its just-deployed version.

CLI zone (3.14). Port of infra/ci/prune-registry.sh. The repo's keep-recent policy already does this
on Artifact Registry's ~daily async sweep; this makes the deletion happen the moment a deploy is
proven healthy (it runs AFTER wait-rollout, so no older version is still served). EXHAUSTIVE — every
package is DISCOVERED live, so the sweep also collapses packages the static known-image list misses
(a renamed target, a stray tag, an orphaned package). Each package routes to one of two policies:

  • KNOWN images (web/migrate): keep the SPECIFIC just-deployed digest (from `keep_digests`) + its
    children. If that digest is absent (run outside the normal CI flow), the package is SKIPPED —
    never prune a known image without knowing which digest is live, or we could delete what serves.
  • EXTRA packages: keep the NEWEST tagged index + its children, delete the rest.

SAFETY — multi-manifest images: a buildx push is a TAGGED index plus UNTAGGED child platform/SLSA
manifests. We only ever delete TAGGED indexes whose digest isn't kept; `--delete-tags` then orphans
that old index's children, which Artifact Registry GCs on its own. The kept index + every child it
references are protected, so a live image is never touched. Best-effort throughout: a prune hiccup
must never fail an already-successful deploy — every delete failure is warned and skipped.
"""

from collections.abc import Mapping
from datetime import timedelta

from devstash_infra.ci import actions
from devstash_infra.ci.images import KNOWN_IMAGES, image_base
from devstash_infra.clients.docker import Docker
from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.common import log
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock

# 30-minute cutoff — protect very recent images from deletion by a concurrent/overlapping GHA run.
_RECENT_WINDOW = timedelta(minutes=30)


def prune_registry(
    gcloud: Gcloud,
    docker: Docker,
    *,
    region: str,
    project: str,
    repo: str,
    keep_digests: Mapping[str, str],
    clock: Clock = SYSTEM_CLOCK,
    known_images: tuple[str, ...] = KNOWN_IMAGES,
) -> None:
    """Collapse every package in `repo` to its keep digest + children. Never raises (best-effort).

    `keep_digests` maps a known image name → its just-deployed digest (the boundary reads WEB_DIGEST
    etc. from env). The injected `clock` anchors the 30-minute cutoff window, so it is testable.
    """
    base = image_base(region, project, repo)
    cutoff = (clock.now() - _RECENT_WINDOW).strftime("%Y-%m-%dT%H:%M:%SZ")

    packages = gcloud.artifacts.list_packages(repo, location=region)
    if not packages:
        log("prune-registry: package discovery returned nothing — falling back to the static list")
        packages = list(known_images)

    for pkg in packages:
        image_path = f"{base}/{pkg}"
        keep_digest = _keep_digest_for(gcloud, pkg, image_path, keep_digests, known_images)
        if keep_digest:
            _prune_package(gcloud, docker, image_path, keep_digest, cutoff=cutoff)


def _keep_digest_for(
    gcloud: Gcloud,
    pkg: str,
    image_path: str,
    keep_digests: Mapping[str, str],
    known_images: tuple[str, ...],
) -> str:
    """The digest to protect for `pkg`, or "" to skip it (with the reason logged/warned)."""
    if pkg in known_images:
        digest = keep_digests.get(pkg, "")
        if not digest:
            # Never prune a live image without its deployed digest — could delete what's served.
            actions.warning(f"prune-registry: no keep digest for known image '{pkg}'; skipping")
        return digest
    digest = gcloud.artifacts.newest_tagged_index(image_path)
    if not digest:
        log(f"prune-registry: no tagged index in extra package '{pkg}' — nothing to keep, skipping")
    return digest


def _prune_package(
    gcloud: Gcloud, docker: Docker, image_path: str, keep_digest: str, *, cutoff: str
) -> None:
    """Collapse one package to `keep_digest` + its children via two ordered delete passes."""
    keep = {keep_digest, *docker.manifest_child_digests(f"{image_path}@{keep_digest}")}
    log(f"prune-registry: {image_path} — keeping {keep_digest} and its children")
    # Pass 1 deletes OCI Indexes (parent manifests) first — that orphans the children pass 2 then
    # collects; each pass re-lists (not caches) because pass 1 is what creates pass 2's work.
    _prune_pass(gcloud, image_path, keep, cutoff=cutoff, want_index=True)
    _prune_pass(gcloud, image_path, keep, cutoff=cutoff, want_index=False)


def _prune_pass(
    gcloud: Gcloud, image_path: str, keep: set[str], *, cutoff: str, want_index: bool
) -> None:
    """Delete every superseded manifest of the selected class (index vs non-index) not in `keep`."""
    for version, media_type in gcloud.artifacts.superseded_manifests(
        image_path, created_before=cutoff
    ):
        if ("index" in media_type) != want_index:
            continue
        if version in keep:
            continue
        image_ref = f"{image_path}@{version}"
        if not gcloud.artifacts.delete_docker_image(image_ref):
            actions.warning(f"prune-registry: failed to delete {image_ref} (continuing)")
