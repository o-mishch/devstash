"""_billing.py — the `gcloud billing` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Billing"]


class _Billing:
    """`gcloud billing` — the project↔account link (most APIs + the credit require it)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def is_linked(self) -> bool:
        """True iff a billing account is linked (`billingEnabled == "True"`; a tolerant probe)."""
        result = proc.run(
            [
                "gcloud",
                "billing",
                "projects",
                "describe",
                self._project,
                "--format=value(billingEnabled)",
            ],
            check=False,
        )
        return result.out == "True"

    def first_open_account(self) -> str:
        """The first OPEN billing account name, or "" (shell `… | head -1`; a tolerant read)."""
        result = proc.run(
            ["gcloud", "billing", "accounts", "list", "--filter=open=true", "--format=value(name)"],
            check=False,
        )
        return result.out.splitlines()[0] if result.out else ""

    def link(self, account: str) -> None:
        """`billing projects link <project> --billing-account=<account>`. Raises on failure."""
        proc.run(
            ["gcloud", "billing", "projects", "link", self._project, f"--billing-account={account}"]
        )
