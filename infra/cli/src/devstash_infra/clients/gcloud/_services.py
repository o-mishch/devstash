"""_services.py — the `gcloud services` sub-facade (part of the Gcloud package)."""

from collections.abc import Sequence

from devstash_infra.shared import proc

__all__ = ["_Services"]


class _Services:
    """`gcloud services` — the enabled-API set. `--project` is explicit (config is mutable)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def enable(self, apis: Sequence[str]) -> None:
        """`services enable --project=<project> <apis…>` — idempotent bulk enable. Raises."""
        proc.run(["gcloud", "services", "enable", f"--project={self._project}", *apis])

    def delete_vpc_peering(self, network: str) -> None:
        """Delete the servicenetworking PSA peering on `network`. Raises (the producer lock can
        still hold it for ~4 days, so the teardown catches this and warns rather than failing).
        """
        proc.run(
            [
                "gcloud",
                "services",
                "vpc-peerings",
                "delete",
                f"--network={network}",
                "--service=servicenetworking.googleapis.com",
                f"--project={self._project}",
                "--quiet",
            ]
        )
