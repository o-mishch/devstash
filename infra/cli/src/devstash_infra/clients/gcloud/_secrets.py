"""_secrets.py — the `gcloud secrets` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc, secrets

__all__ = ["_Secrets"]


class _Secrets:
    """`gcloud secrets` — Secret Manager reads, project-scoped.

    The newest-ENABLED-version read [#14] is nontrivial (list → filter ENABLED → newest → access)
    AND shared with the stdlib Cloud Build path, so its logic stays single-sourced in the floor
    (`shared/secrets.py`); this facade is the CLI's typed door onto it (adds the project scope).
    """

    def __init__(self, project: str) -> None:
        self._project = project

    def access_blob(self, name: str) -> str:
        """The secret's payload from its newest ENABLED version [#14] — never `access latest`."""
        return secrets.access_secret_blob(name, self._project)

    def newest_version(self, name: str) -> str:
        """The newest ENABLED version number of `name`, or "" if none [#14]. For re-import ids."""
        return secrets.newest_enabled_secret_version(name, self._project)

    def exists(self, name: str) -> bool:
        """True iff secret `name` is describable — set-dns-creds's create-if-absent gate."""
        return proc.run_ok(["gcloud", "secrets", "describe", name, f"--project={self._project}"])

    def create(self, name: str) -> None:
        """Create secret `name` with automatic replication (as elsewhere). Raises on failure."""
        proc.run(
            [
                "gcloud",
                "secrets",
                "create",
                name,
                "--replication-policy=automatic",
                f"--project={self._project}",
            ]
        )

    def add_version(self, name: str, payload: str) -> None:
        """Add a version to `name` from stdin (`--data-file=-`) — payload never touches argv."""
        proc.run(
            [
                "gcloud",
                "secrets",
                "versions",
                "add",
                name,
                "--data-file=-",
                f"--project={self._project}",
            ],
            input=payload,
        )
