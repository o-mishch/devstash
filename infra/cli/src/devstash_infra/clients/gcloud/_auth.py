"""_auth.py — the `gcloud auth` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Auth"]


class _Auth:
    """`gcloud auth` — login state + Application Default Credentials."""

    def active_account(self) -> str:
        """The active account email, or "" if none (a tolerant read; shell `|| true`)."""
        result = proc.run(
            ["gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
            check=False,
        )
        return result.out

    def login(self) -> None:
        """Launch the interactive `gcloud auth login` flow (un-captured — it drives the browser)."""
        proc.run(["gcloud", "auth", "login"], capture=False)

    def adc_present(self) -> bool:
        """True iff ADC can mint a token — the Terraform google provider reads these credentials."""
        return proc.run_ok(["gcloud", "auth", "application-default", "print-access-token"])

    def adc_login(self) -> None:
        """Launch the interactive `gcloud auth application-default login` flow (un-captured)."""
        proc.run(["gcloud", "auth", "application-default", "login"], capture=False)
