"""_quotas.py — the `gcloud alpha quotas` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Quotas"]


class _Quotas:
    """`gcloud alpha quotas` — quota preferences (the `alpha` component is required)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def delete_ssd_preference(self, quota_id: str) -> None:
        """`alpha quotas preferences delete <id> --service=compute.googleapis.com`. Raises."""
        proc.run(
            [
                "gcloud",
                "alpha",
                "quotas",
                "preferences",
                "delete",
                quota_id,
                "--service=compute.googleapis.com",
                f"--project={self._project}",
                "--quiet",
            ]
        )
