"""gcp/bootstrap.py — the GCP prerequisites that must exist BEFORE `tofu init` can run.

Port of infra/run/gcp/lib/bootstrap.sh. CLI zone (3.14). Re-architected onto the Python-native
paradigm: a `Bootstrap` COLLABORATOR that drives the typed `Gcloud` client (no argv, no exit-code
branching) and RAISES to the CLI boundary (`Aborted` on a declined gate, `InfraError` on a hard
stop) instead of `die`-ing mid-stack.

The chicken-and-egg ordering is the whole point, so `run()` reads as a table of contents:
auth → project → billing → ADC → state bucket → APIs. Every step is idempotent (existence-checked
via the client's probes), so the confirm gate is about consent to the FIRST-time creations, not
re-runs — and a partial failure is safe to re-run.

`ensure_tfvars` (a run.sh core helper that ports with the app phase) is injected as a callable so
bootstrap stays a pure, testable unit until the app dispatch wires the real one.
"""

from collections.abc import Callable
from dataclasses import dataclass

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.common import confirm, log, ok, warn
from devstash_infra.config import GcpConfig
from devstash_infra.shared.errors import Aborted, InfraError

# The APIs to pre-enable — data, not inline argv. Must stay in sync with the list in
# infra/terraform/envs/dev/main.tf (bootstrap.sh:_bootstrap_apis). Pre-enabling here just
# speeds the first `tofu apply` (Terraform enables them too via google_project_service).
REQUIRED_APIS = (
    "compute.googleapis.com",
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "certificatemanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "servicenetworking.googleapis.com",
    "memorystore.googleapis.com",
    "orgpolicy.googleapis.com",
    "binaryauthorization.googleapis.com",
    "containeranalysis.googleapis.com",
    "cloudresourcemanager.googleapis.com",
)


@dataclass(frozen=True)
class Bootstrap:
    """The GCP-prerequisites collaborator: config + the `Gcloud` client, run in dependency order.

    Idempotent + re-runnable. `state_lifecycle` is the path to tfstate-lifecycle.json;
    `billing_account` is the optional BILLING_ACCOUNT override (else the first open account).
    """

    config: GcpConfig
    gcloud: Gcloud
    ensure_tfvars: Callable[[], None]
    state_lifecycle: str
    billing_account: str = ""

    def run(self, *, auto_approve: bool = False) -> None:
        """Run every prerequisite in dependency order. Ports `bootstrap`."""
        self.ensure_tfvars()
        self._confirm(auto_approve=auto_approve)
        log(f"GCP bootstrap for project '{self.config.project}' (region {self.config.region})")
        self._auth()
        self._project()
        self._billing()
        self._adc()
        self._state_bucket()
        self._apis()

    def _confirm(self, *, auto_approve: bool) -> None:
        """The upfront intent gate — its steps create billable GCP-org-level resources.

        Ports `_confirm_bootstrap`. Decline → `Aborted` before `_auth` touches anything.
        """
        cfg = self.config
        log(
            f"'bootstrap' prepares the GCP prerequisites for project '{cfg.project}' "
            f"(region {cfg.region}). It will, if absent:"
        )
        log(f"  • create the GCP project '{cfg.project}' and set it active")
        log("  • LINK a billing account (BILLING_ACCOUNT, else the first open account)")
        log(f"  • create + harden the Terraform state bucket gs://{cfg.state_bucket}")
        log("  • enable the required GCP APIs (compute, container, sqladmin, secretmanager, …)")
        if not confirm(
            "Proceed with 'bootstrap'? (nothing has touched GCP yet)", auto_approve=auto_approve
        ):
            raise Aborted("aborted before any GCP changes")

    def _auth(self) -> None:
        """Ensure an active gcloud login, launching the interactive flow if none."""
        if not self.gcloud.auth.active_account():
            warn("no active gcloud account — launching login")
            self.gcloud.auth.login()
        ok("gcloud authenticated")

    def _project(self) -> None:
        """Create the (globally-unique) project if it can't be described, then select it."""
        if self.gcloud.projects.exists():
            ok("project exists")
        else:
            log(f"Creating project {self.config.project}")
            self.gcloud.projects.create(name="DevStash")
        self.gcloud.config.set_active_project()
        ok("active project set")

    def _billing(self) -> None:
        """Link a billing account — most APIs (and the $300 credit) require one.

        Uses `billing_account` (the BILLING_ACCOUNT override) if set, else the first open
        account; raises if none is available.
        """
        if self.gcloud.billing.is_linked():
            ok("billing linked")
            return
        account = self.billing_account or self.gcloud.billing.first_open_account()
        if not account:
            raise InfraError(
                "no open billing account found",
                hint="set BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX",
            )
        log(f"Linking billing account {account}")
        self.gcloud.billing.link(account)

    def _adc(self) -> None:
        """Ensure Application Default Credentials exist — the Terraform provider reads ADC."""
        if self.gcloud.auth.adc_present():
            ok("ADC present")
        else:
            warn("no ADC — launching application-default login")
            self.gcloud.auth.adc_login()

    def _state_bucket(self) -> None:
        """Create (if absent) + harden the Terraform state bucket. Ports `_bootstrap_state_bucket`.

        Security props are reconciled even for a pre-existing bucket: existence alone does not
        prove versioning is on or public-access is prevented. Location is IMMUTABLE — a bucket in
        a different region must be recreated + state migrated, not updated in place.
        """
        uri = f"gs://{self.config.state_bucket}"
        if self.gcloud.storage.bucket_exists(uri):
            ok(f"state bucket {uri} exists")
        else:
            log(f"Creating state bucket {uri} (single-region {self.config.region})")
            self.gcloud.storage.create_bucket(uri, location=self.config.region)
        self.gcloud.storage.harden_bucket(uri)
        ok("state bucket has uniform access, public-access prevention, and versioning")
        self.gcloud.storage.set_bucket_lifecycle(uri, lifecycle_file=self.state_lifecycle)
        ok("state bucket lifecycle: keep 2 noncurrent state versions (3 total), drop older")

    def _apis(self) -> None:
        """Pre-enable the required APIs (idempotent). --project is explicit — config is mutable."""
        log("Enabling required APIs (idempotent)")
        self.gcloud.services.enable(REQUIRED_APIS)
        ok("APIs enabled")
