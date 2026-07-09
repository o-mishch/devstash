"""_config.py — the `gcloud config` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Config"]


class _Config:
    """`gcloud config` — the mutable active-project pointer."""

    def __init__(self, project: str) -> None:
        self._project = project

    def set_active_project(self) -> None:
        """`config set project <project>` — select the deploy target as active. Raises on error."""
        proc.run(["gcloud", "config", "set", "project", self._project])
