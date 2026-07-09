"""_iam.py — the `gcloud iam` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Iam"]


class _Iam:
    """`gcloud iam workload-identity-pools` — WIF pools + their providers.

    A soft-DELETED pool/provider keeps its name reserved ~30d, so undelete (not re-create) is the
    only recovery — hence explicit `*_state`/`undelete_*`/`delete_*` triples per kind.
    """

    def __init__(self, project: str) -> None:
        self._project = project

    def _pool(self, name: str, verb: str) -> list[str]:
        return [
            "gcloud",
            "iam",
            "workload-identity-pools",
            verb,
            name,
            "--location=global",
            f"--project={self._project}",
        ]

    def _provider(self, name: str, verb: str, *, pool: str) -> list[str]:
        return [
            "gcloud",
            "iam",
            "workload-identity-pools",
            "providers",
            verb,
            name,
            f"--workload-identity-pool={pool}",
            "--location=global",
            f"--project={self._project}",
        ]

    def wif_pool_state(self, name: str) -> str:
        """The pool's `state` (ACTIVE / DELETED), or "" if absent (tolerant)."""
        return proc.run_out([*self._pool(name, "describe"), "--format=value(state)"])

    def undelete_wif_pool(self, name: str) -> None:
        """`workload-identity-pools undelete <n>` — restore a soft-deleted pool. Raises."""
        proc.run(self._pool(name, "undelete"))

    def delete_wif_pool(self, name: str) -> None:
        """`workload-identity-pools delete <n> --quiet` — soft-delete (name reserved ~30d)."""
        proc.run([*self._pool(name, "delete"), "--quiet"])

    def wif_provider_state(self, name: str, *, pool: str) -> str:
        """The provider's `state` (ACTIVE / DELETED), or "" if absent (tolerant)."""
        return proc.run_out([*self._provider(name, "describe", pool=pool), "--format=value(state)"])

    def undelete_wif_provider(self, name: str, *, pool: str) -> None:
        """`providers undelete <n> --workload-identity-pool=<pool>` — restore. Raises."""
        proc.run(self._provider(name, "undelete", pool=pool))

    def delete_wif_provider(self, name: str, *, pool: str) -> None:
        """`providers delete <n> --workload-identity-pool=<pool> --quiet` — soft-delete. Raises."""
        proc.run([*self._provider(name, "delete", pool=pool), "--quiet"])
