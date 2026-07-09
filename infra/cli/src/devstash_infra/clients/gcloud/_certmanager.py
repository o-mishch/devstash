"""_certmanager.py — the `gcloud certificate-manager` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_CertManager"]


class _CertManager:
    """`gcloud certificate-manager` — the project-scoped managed TLS cert (survives suspend)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def cert_state(self, name: str) -> str:
        """The managed cert's provisioning state (PROVISIONING/ACTIVE/FAILED…), or "" if unreadable.

        TLS is served by the project-scoped Certificate Manager cert (envs/dev/certmanager.tf), not
        a cluster ManagedCertificate — it survives suspend and provisions ONCE. `status` reports it
        so an operator can confirm ACTIVE. Tolerant → "" (the caller prints "unknown"): a read.
        """
        result = proc.run(
            [
                "gcloud",
                "certificate-manager",
                "certificates",
                "describe",
                name,
                f"--project={self._project}",
                "--format=value(managed.state)",
            ],
            check=False,
        )
        return result.out if result.ok else ""
