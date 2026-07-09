"""_projects.py — the `gcloud projects` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Projects"]


class _Projects:
    """`gcloud projects` — the project resource itself."""

    def __init__(self, project: str) -> None:
        self._project = project

    def exists(self) -> bool:
        """True iff the project can be described (a probe — never raises)."""
        return proc.run_ok(["gcloud", "projects", "describe", self._project])

    def create(self, *, name: str) -> None:
        """`projects create <project> --name=<name>` — create the globally-unique project."""
        proc.run(["gcloud", "projects", "create", self._project, f"--name={name}"], capture=False)
