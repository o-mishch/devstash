"""_compute.py — the `gcloud compute` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc, reap_negs

__all__ = ["_Compute"]


class _Compute:
    """`gcloud compute` — scoped to a project."""

    def __init__(self, project: str) -> None:
        self._project = project

    def global_address(self, name: str) -> str:
        """The reserved GLOBAL static IP `name`, or "" if absent (a tolerant read).

        Ports `_gcp_ingress_ip`'s `… 2>/dev/null || true`: a missing address (suspended env, IP
        released) is a normal empty result, not an error — so an absent resource returns "".
        """
        return proc.run_out(
            [
                "gcloud",
                "compute",
                "addresses",
                "describe",
                name,
                "--global",
                f"--project={self._project}",
                "--format=value(address)",
            ]
        )

    def global_address_exists(self, name: str) -> bool:
        """True iff the reserved GLOBAL static IP `name` exists (a presence probe, no --format)."""
        return proc.run_ok(
            [
                "gcloud",
                "compute",
                "addresses",
                "describe",
                name,
                "--global",
                f"--project={self._project}",
            ]
        )

    def delete_global_address(self, name: str) -> None:
        """`compute addresses delete <name> --global --quiet` — release a reserved global IP.
        Raises (a still-referenced range 409s, which the teardown catches and warns).
        """
        proc.run(
            [
                "gcloud",
                "compute",
                "addresses",
                "delete",
                name,
                "--global",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def network_exists(self, vpc: str) -> bool:
        """True iff the VPC still exists (a probe — a completed `down` already removed it)."""
        return proc.run_ok(
            ["gcloud", "compute", "networks", "describe", vpc, f"--project={self._project}"]
        )

    def router_exists(self, name: str, *, region: str) -> bool:
        """True iff a Cloud Router `name` exists in `region` (a probe — 404 is the common case)."""
        return proc.run_ok(
            [
                "gcloud",
                "compute",
                "routers",
                "describe",
                name,
                f"--region={region}",
                f"--project={self._project}",
            ]
        )

    def delete_router(self, name: str, *, region: str) -> None:
        """`compute routers delete <name> --quiet` — reap an out-of-band router blocking the VPC
        delete. Raises (the teardown catches it and warns).
        """
        proc.run(
            [
                "gcloud",
                "compute",
                "routers",
                "delete",
                name,
                f"--region={region}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def reap_leaked_negs(self, vpc: str) -> None:
        """Reap GKE-leaked NEGs + firewall rules on `vpc`. Delegates to the SAME VPC-scoped reap
        the Cloud Build cleanup step runs (`shared.reap_negs`) — single-sourced in the floor.
        """
        reap_negs.reap_leaked_negs(vpc, self._project)
