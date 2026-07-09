"""ci/build_push.py — build + push the web and migrate images, return their registry digests.

CLI zone (3.14). Port of infra/ci/build-push.sh. Both images build in ONE `docker buildx bake`
session; the caller (the `ci` boundary) publishes the returned digests to $GITHUB_ENV/$GITHUB_OUTPUT
so later steps deploy BY DIGEST (a commit-SHA tag can be overwritten by a re-run; a content digest
cannot).

Gate the push on Artifact Registry being WRITABLE [fix #12]: resume/first-apply PRE-DISPATCHES this
cluster-independent build so it overlaps `tofu apply`, but the AR repo AND the deployer's
repo-scoped repoAdmin binding are count=environment_active — recreated only PARTWAY THROUGH that
apply. Pushing before the binding lands is a hard `denied: uploadArtifacts` (not a flake — both step
retries hit the same 403). `ArtifactRegistry.wait_until_writable` polls the AR `testIamPermissions`
API (works under WIF, where a self-identity policy match returns empty) so ONLY the push waits; the
deps/builder stages still build concurrently with apply. A short settle absorbs the read→plane gap.
"""

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import ReadOnly, TypedDict, cast

from devstash_infra.ci.images import image_base
from devstash_infra.clients.ar import ArtifactRegistry
from devstash_infra.clients.docker import Docker
from devstash_infra.common import log, ok
from devstash_infra.shared.errors import InfraError

_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_SETTLE_S = 5.0  # IAM policy can read back a beat before it propagates to the registry data plane

# buildx --metadata-file shape: {"<target>": {"containerimage.digest": "sha256:…"}}. The key has a
# dot, so this needs the functional TypedDict form (a class attribute can't be named that).
_TargetMeta = TypedDict("_TargetMeta", {"containerimage.digest": ReadOnly[str]}, total=False)


class _BakeMeta(TypedDict, total=False):
    web: ReadOnly[_TargetMeta]
    migrate: ReadOnly[_TargetMeta]


@dataclass(frozen=True)
class BuildPushResult:
    """The image coordinates + immutable registry digests build-push emits for downstream steps."""

    image_uri: str
    web_digest: str
    migrate_uri: str
    migrate_digest: str

    @property
    def migrate_image(self) -> str:
        """The digest-pinned migrate reference run-migrations/sign-images consume."""
        return f"{self.migrate_uri}@{self.migrate_digest}"


def build_push(
    ar: ArtifactRegistry,
    docker: Docker,
    *,
    region: str,
    project: str,
    repo: str,
    image: str,
    image_migrate: str,
    github_sha: str,
    bake_file: Path,
    metadata_file: Path,
    sleep: Callable[[float], None] = time.sleep,
) -> BuildPushResult:
    """Gate on AR-writable, bake both images, and return their validated registry digests."""
    base = image_base(region, project, repo)
    image_uri = f"{base}/{image}"
    migrate_uri = f"{base}/{image_migrate}"

    log(f"Waiting for Artifact Registry '{repo}' to be writable by the deployer SA…")
    if not ar.wait_until_writable():
        raise InfraError(
            f"Artifact Registry '{repo}' not writable by the deployer SA after the wait",
            hint=(
                "the repo is missing or the deployer lacks uploadArtifacts (per testIamPermissions)"
                " — a resume apply may still be recreating it; see modules/iam deployer"
            ),
        )
    ok(f"Artifact Registry '{repo}' is writable — proceeding to build + push")
    sleep(_SETTLE_S)  # absorb the residual IAM-read → registry-data-plane propagation gap

    docker.buildx_bake(
        str(bake_file),
        metadata_file=str(metadata_file),
        env_extra={"IMAGE_URI": image_uri, "MIGRATE_URI": migrate_uri, "GITHUB_SHA": github_sha},
    )

    meta = _load_bake_metadata(metadata_file)
    result = BuildPushResult(
        image_uri=image_uri,
        web_digest=_digest_of(meta.get("web")),
        migrate_uri=migrate_uri,
        migrate_digest=_digest_of(meta.get("migrate")),
    )
    ok(f"built + pushed web@{result.web_digest} migrate@{result.migrate_digest}")
    return result


def _load_bake_metadata(metadata_file: Path) -> _BakeMeta:
    raw: object = json.loads(metadata_file.read_text())
    if not isinstance(raw, dict):
        raise InfraError("BuildKit did not return valid registry image digests")
    return cast("_BakeMeta", raw)


def _digest_of(target: _TargetMeta | None) -> str:
    """Validate + return a target's `containerimage.digest`, else raise (the shell regex)."""
    digest = target.get("containerimage.digest", "") if target else ""
    if not _DIGEST_RE.match(digest):
        raise InfraError("BuildKit did not return valid registry image digests")
    return digest
