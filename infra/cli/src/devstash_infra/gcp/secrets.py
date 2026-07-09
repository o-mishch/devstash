"""gcp/secrets.py — push CI's auth secrets + public config to GitHub Actions, then verify.

Port of `secrets()` + `_verify_pushed_secrets()` (infra/run/gcp/run.sh). CLI zone (3.14). A
`Secrets` COLLABORATOR over the typed `Gh` + `Tofu` clients — it reads the applied Terraform outputs
ONCE and writes them to the repo's Actions store, so it must run after a successful `apply`.

Two Actions stores, deliberately split (the split is a hard-won incident fix, not a preference):
- **Secrets** — DEPLOYER_SA / LIFECYCLE_DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER (fed on stdin by
  the `Gh` client, never argv).
- **Variables** — GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS + the
  optional ARMOR_ENABLED / BINAUTHZ_* toggles. GCP_PROJECT_ID *must* be a variable: GitHub masks any
  value defined as a secret, and the build-push job's image_uri/migrate_image outputs embed the
  project id — as a secret they crossed the job boundary EMPTY, so the deploy applied `@sha256:…`
  with no repo base → the migrate Job hit InvalidImageName and the web rollout never started. A
  stale GCP_PROJECT_ID *secret* is deleted each push for the same reason (a lingering secret keeps
  masking). Optional toggles are set-or-cleared so a disabled feature leaves no stale var behind.

The push gates on `require_outputs` FIRST (in-process), so a missing output aborts before any `gh`
write — the shell had to do this too, since a `die` inside a `$(…)` body would only kill the
subshell and let `gh … --body ""` push an empty value. Verification re-reads the store because the
write half of `gh secret/variable set` exits 0 even on a silent failure: required secrets missing →
raise; required variables missing → warn (the push already reported success); optional toggles →
reported only when present (absent by design in the dev $0 posture).
"""

from dataclasses import dataclass
from typing import Protocol

from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import count_missing, log, ok, warn
from devstash_infra.shared.errors import InfraError

# The tofu outputs the push reads to write CI's auth secrets + public config. Single-sourced so the
# push's require_outputs gate and the (future) `_tf_outputs_present` pre-dispatch gate in up()/
# resume() can never disagree on "which outputs must exist before we may push to GitHub".
SECRETS_REQUIRED_OUTPUTS = (
    "gcp_project_id",
    "deployer_service_account_email",
    "lifecycle_deployer_service_account_email",
    "wif_provider",
    "app_domain",
    "email_from",
)

# The three secrets and the four always-present variables the verify pass checks by name. Secrets
# missing is a real setup failure (raise); a missing always-present variable is surfaced but not
# fatal (the push already reported success). The optional toggles are reported only when present.
_REQUIRED_SECRETS = ("DEPLOYER_SA", "LIFECYCLE_DEPLOYER_SA", "WORKLOAD_IDENTITY_PROVIDER")
_REQUIRED_VARIABLES = ("GCP_PROJECT_ID", "APP_DOMAIN", "EMAIL_FROM", "ENABLE_GITHUB_ATTESTATIONS")
_OPTIONAL_VARIABLES = (
    "ARMOR_ENABLED",
    "BINAUTHZ_ATTESTOR",
    "BINAUTHZ_KMS_KEYRING",
    "BINAUTHZ_KMS_KEY",
)


class _Gh(Protocol):
    """The GitHub Actions store operations Secrets drives — the `Gh` subset it depends on.

    A consumer-owned interface (ISP): the real `Gh` client and the test fake satisfy it by shape, so
    nothing subclasses `Gh` to be injected here. `tofu` stays concrete — its tests drive the real
    client through `proc`, so it is never faked.
    """

    def authenticated(self) -> bool: ...
    def secret_set(self, name: str, value: str) -> None: ...
    def secret_delete(self, name: str) -> None: ...
    def variable_set(self, name: str, value: str) -> None: ...
    def variable_delete(self, name: str) -> None: ...
    def secret_names(self) -> list[str]: ...
    def variable_value(self, name: str) -> str: ...


@dataclass(frozen=True)
class Secrets:
    """Push tofu outputs to the GitHub Actions store, then verify they landed."""

    gh: _Gh
    tofu: Tofu

    def push(self) -> None:
        """Read the applied tofu outputs and write them as GitHub Actions secrets/variables.

        Must run after a successful `apply` (the outputs must exist). Gates on gh auth + the
        required outputs before any write, then verifies the whole set landed.
        """
        log("Pushing GitHub Actions secrets from tofu output")
        if not self.gh.authenticated():
            raise InfraError("gh CLI not authenticated — run: gh auth login")
        outputs = self.tofu.output_json()
        # Gate FIRST so a missing output aborts before any `gh` write pushes an empty value.
        missing = outputs.missing(*SECRETS_REQUIRED_OUTPUTS)
        if missing:
            raise InfraError(f"required tofu outputs missing or empty: {', '.join(missing)}")

        self.gh.secret_set("DEPLOYER_SA", outputs.value("deployer_service_account_email"))
        self.gh.secret_set(
            "LIFECYCLE_DEPLOYER_SA", outputs.value("lifecycle_deployer_service_account_email")
        )
        self.gh.secret_set("WORKLOAD_IDENTITY_PROVIDER", outputs.value("wif_provider"))

        self.gh.variable_set("GCP_PROJECT_ID", outputs.value("gcp_project_id"))
        # Delete any stale GCP_PROJECT_ID *secret* left from before this became a variable — a
        # lingering secret keeps GitHub masking the image-URI job outputs and re-breaks the deploy.
        self.gh.secret_delete("GCP_PROJECT_ID")
        self.gh.variable_set("APP_DOMAIN", outputs.value("app_domain"))
        self.gh.variable_set("EMAIL_FROM", outputs.value("email_from"))
        self.gh.variable_set("ENABLE_GITHUB_ATTESTATIONS", "false")

        # Cloud Armor toggle — inject-settings keys the GCPBackendPolicy securityPolicy on this.
        armor = "true" if outputs.value("armor_enabled", "false") == "true" else ""
        self._var_set_or_clear("ARMOR_ENABLED", armor)

        # Binary Authorization attestor/KMS names (non-secret). null when binauthz_enabled=false,
        # so the vars are cleared and the CI signing step self-skips. attestor gates the KMS pair:
        # it is non-empty iff the pipeline is provisioned, so the reads below never hit a null one.
        attestor = outputs.value("binauthz_attestor_name")
        keyring = key = ""
        if attestor:
            kms_missing = outputs.missing("binauthz_kms_keyring", "binauthz_kms_key")
            if kms_missing:
                raise InfraError(
                    f"required tofu outputs missing or empty: {', '.join(kms_missing)}"
                )
            keyring = outputs.value("binauthz_kms_keyring")
            key = outputs.value("binauthz_kms_key")
        self._var_set_or_clear("BINAUTHZ_ATTESTOR", attestor)
        self._var_set_or_clear("BINAUTHZ_KMS_KEYRING", keyring)
        self._var_set_or_clear("BINAUTHZ_KMS_KEY", key)

        if attestor:
            ok(
                "DEPLOYER_SA / LIFECYCLE_DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; "
                "GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS / BINAUTHZ_*"
                " set as variables"
            )
        else:
            ok(
                "DEPLOYER_SA / LIFECYCLE_DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; "
                "GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS set as "
                "variables (Binary Authorization disabled — BINAUTHZ_* cleared)"
            )

        self._verify_pushed()

    def _var_set_or_clear(self, name: str, value: str) -> None:
        """Set variable `name` when `value` is non-empty, else best-effort delete any stale copy.

        Collapses the set-if-present-else-delete pattern the push repeats for every optional toggle
        so a disabled feature (Cloud Armor / Binary Authorization) leaves no lingering var.
        """
        if value:
            self.gh.variable_set(name, value)
        else:
            self.gh.variable_delete(name)

    def _verify_pushed(self) -> None:
        """Re-read the Actions store and confirm every value the push set actually landed.

        The write half of `gh secret/variable set` exits 0 even on a silent failure, so a read-back
        is the only proof. Required secrets missing → raise (a real setup failure); required
        variables missing → warn (the push already reported success); optional toggles → reported
        only when present (absent by design in the dev $0 posture).
        """
        log("Verifying GitHub Actions secrets are present")
        # JSON names so column-aligned table text never causes a false miss. APP_DOMAIN is a
        # variable, not a secret, so it is verified below via the per-name value fetch, not here.
        missing = count_missing(self.gh.secret_names(), *_REQUIRED_SECRETS)
        if missing:
            raise InfraError(f"{missing} secret(s) not confirmed in GitHub — re-run 'secrets'")

        # `gh variable list` exits 0 even when empty, so a per-name value fetch is the only reliable
        # presence check. Always-present variables — a missing one is surfaced but not fatal.
        for name in _REQUIRED_VARIABLES:
            value = self.gh.variable_value(name)
            if value:
                ok(f"{name} variable = {value}")
            else:
                warn(
                    f"{name} variable not found in GitHub — gh variable set may have failed; "
                    "re-run 'secrets'"
                )

        # Optional feature toggles — absent by design in the dev $0 posture (Binary Authorization
        # off, Cloud Armor off), so report only when present rather than warning on absence.
        for name in _OPTIONAL_VARIABLES:
            value = self.gh.variable_value(name)
            if value:
                ok(f"{name} variable = {value}")
