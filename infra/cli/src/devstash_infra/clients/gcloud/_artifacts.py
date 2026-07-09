"""_artifacts.py — the `gcloud artifacts` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Artifacts"]


class _Artifacts:
    """`gcloud artifacts repositories` — Artifact Registry, project-scoped (location per-call)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def repo_exists(self, name: str, *, location: str) -> bool:
        """True iff Artifact Registry repo `name` exists in `location` (a presence probe)."""
        return proc.run_ok(
            [
                "gcloud",
                "artifacts",
                "repositories",
                "describe",
                name,
                f"--location={location}",
                f"--project={self._project}",
            ]
        )

    def delete_repo(self, name: str, *, location: str) -> None:
        """`artifacts repositories delete <n> --location=<l>` — removes ALL images. Raises."""
        proc.run(
            [
                "gcloud",
                "artifacts",
                "repositories",
                "delete",
                name,
                f"--location={location}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def list_packages(self, repo: str, *, location: str) -> list[str]:
        """Short package names in `repo` (last path segment of each `value(name)`). Tolerant → [].

        `value(name)` returns the full resource path (…/packages/<pkg>); the package segment may be
        URL-encoded (a nested `foo%2Fbar`) — leave it encoded, since the docker image path uses the
        same encoding. Used to DISCOVER every package live so the prune sweep also collapses ones
        the static known-image list doesn't name.
        """
        result = proc.run(
            [
                "gcloud",
                "artifacts",
                "packages",
                "list",
                f"--repository={repo}",
                f"--location={location}",
                f"--project={self._project}",
                "--format=value(name)",
            ],
            check=False,
        )
        return [line.rsplit("/", 1)[-1] for line in result.out.splitlines() if line]

    def superseded_manifests(
        self, image_path: str, *, created_before: str
    ) -> list[tuple[str, str]]:
        """`(version, mediaType)` rows for `image_path` created before `created_before`. Tolerant.

        The `createTime < <cutoff>` filter protects recent images from a concurrent/overlapping run.
        Output is tab-separated `value(version,metadata.mediaType)`; a missing media type → "".
        """
        result = proc.run(
            [
                "gcloud",
                "artifacts",
                "docker",
                "images",
                "list",
                image_path,
                f"--filter=createTime < {created_before}",
                "--format=value(version,metadata.mediaType)",
                f"--project={self._project}",
            ],
            check=False,
        )
        rows: list[tuple[str, str]] = []
        for line in result.out.splitlines():
            if not line:
                continue
            version, _, media_type = line.partition("\t")
            rows.append((version, media_type))
        return rows

    def newest_tagged_index(self, image_path: str) -> str:
        """Digest of the newest TAGGED OCI index for `image_path`, or "" (tolerant).

        For an EXTRA (unknown) package with no just-deployed digest to protect, "keep only 1" means
        keep the newest. A TAGGED index (not any newest manifest) is chosen so the kept digest is a
        real image whose children can be enumerated — its untagged children are protected elsewhere.
        """
        result = proc.run(
            [
                "gcloud",
                "artifacts",
                "docker",
                "images",
                "list",
                image_path,
                "--include-tags",
                "--sort-by=~createTime",
                "--filter=metadata.mediaType~index AND tags:*",
                "--format=value(version)",
                "--limit=1",
                f"--project={self._project}",
            ],
            check=False,
        )
        lines = result.out.splitlines()
        return lines[0] if lines else ""

    def delete_docker_image(self, image_ref: str) -> bool:
        """`docker images delete <ref> --delete-tags --quiet` → True on success (best-effort).

        `--delete-tags` lets an old TAGGED index be removed; Artifact Registry then GCs the children
        it orphans. Never raises — a prune hiccup must not fail an already-successful deploy.
        """
        return proc.run_ok(
            [
                "gcloud",
                "artifacts",
                "docker",
                "images",
                "delete",
                image_ref,
                "--delete-tags",
                "--quiet",
                f"--project={self._project}",
            ]
        )
