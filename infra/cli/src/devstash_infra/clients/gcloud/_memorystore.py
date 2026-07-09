"""_memorystore.py — the `gcloud memorystore` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Memorystore"]


class _Memorystore:
    """`gcloud memorystore instances` — Valkey/Redis, project-scoped (location is per-call)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def instance_exists(self, name: str, *, location: str) -> bool:
        """True iff the Memorystore instance `name` exists in `location` (a presence probe)."""
        return proc.run_ok(
            [
                "gcloud",
                "memorystore",
                "instances",
                "describe",
                name,
                f"--location={location}",
                f"--project={self._project}",
            ]
        )

    def delete_instance(self, name: str, *, location: str) -> None:
        """`memorystore instances delete <n> --location=<l> --quiet` — drops cached data. Raises."""
        proc.run(
            [
                "gcloud",
                "memorystore",
                "instances",
                "delete",
                name,
                f"--location={location}",
                f"--project={self._project}",
                "--quiet",
            ]
        )
