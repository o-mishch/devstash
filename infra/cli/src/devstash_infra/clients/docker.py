"""clients/docker.py — a typed facade over the docker CLI. CLI zone (3.14).

Starts with the ONE read prune-registry needs — the child-manifest digests of a multi-arch image —
and grows the `buildx bake` verb alongside the build-push port. docker stays subprocess (no Python
SDK is worth the dependency here) behind a typed facade, argv asserted in this client's tests.
"""

import json
import os
from collections.abc import Mapping
from typing import ReadOnly, TypedDict, cast

from devstash_infra.shared import proc


class _ChildManifest(TypedDict, total=False):
    digest: ReadOnly[str]


class _ManifestIndex(TypedDict, total=False):
    manifests: ReadOnly[list[_ChildManifest]]


class Docker:
    """`docker …` — build (local) + `manifest inspect` (prune) + `buildx bake` (build-push)."""

    def build(self, tag: str, *, target: str | None = None, context: str = ".") -> None:
        """`docker build -t <tag> [--target <target>] <context>` — build a local image. Raises.

        The local kind stack builds the web image and the `migrator` target from the ONE root
        Dockerfile, then loads both into kind. A build failure must abort the bring-up, so this
        raises (unlike the tolerant reads); no BuildKit metadata is needed here (that is the CI
        `buildx bake` path), just a plain tagged build.
        """
        argv = ["docker", "build", "-t", tag]
        if target is not None:
            argv += ["--target", target]
        argv.append(context)
        proc.run(argv)

    def buildx_bake(
        self, bake_file: str, *, metadata_file: str, env_extra: Mapping[str, str] | None = None
    ) -> None:
        """`docker buildx bake --file <bake_file> --metadata-file <metadata_file>`. Raises.

        Both images build in ONE bake session (shared deps/builder stages computed once, targets
        built concurrently). `env_extra` is merged OVER the process environment so the bake file's
        `variable` blocks (IMAGE_URI/MIGRATE_URI/GITHUB_SHA) resolve; `--metadata-file` records each
        target's registry digest for the caller to read back (no re-pull).
        """
        env = {**os.environ, **dict(env_extra or {})} if env_extra else None
        proc.run(
            ["docker", "buildx", "bake", "--file", bake_file, "--metadata-file", metadata_file],
            env=env,
        )

    def manifest_child_digests(self, image_ref: str) -> list[str]:
        """Child platform/attestation manifest digests of `image_ref` via `docker manifest inspect`.

        A multi-arch push is a TAGGED index referencing UNTAGGED child manifests. Prune must protect
        those children when it keeps their parent index, so it never deletes a live image's child.
        Tolerant → [] for a childless single-arch image or an absent ref (the shell `jq … || true`).
        """
        result = proc.run(["docker", "manifest", "inspect", image_ref], check=False)
        if not result.ok:
            return []
        try:
            payload: object = json.loads(result.out)
        except json.JSONDecodeError:
            return []
        if not isinstance(payload, dict):
            return []
        manifests = cast("_ManifestIndex", payload).get("manifests")
        if not isinstance(manifests, list):
            return []
        return [digest for entry in manifests if isinstance(digest := entry.get("digest"), str)]
