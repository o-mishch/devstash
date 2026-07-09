"""gcp/reconcile.py — adopt-vs-destroy reconcile for stranded resources [fix #6].

CLI zone (3.14). Ports the heart of run/gcp/lib/reconcile.sh. Re-architected onto the Python-native
paradigm: the pure primitives (`reconcile_choose`, `in_state`, `read_tfvar`, `adopt`,
`psc_subnet_replace`) stay module functions over the typed `Tofu` client, while the stateful
per-branch logic becomes a `Reconcile` COLLABORATOR over `GcpConfig` + the typed `Gcloud`/`Tofu`
clients. Every describe/delete argv now lives in the client (`gcloud.container.cluster_exists`,
`gcloud.sql.delete_instance`, …) — the shell's describe-vector + `_swap_verb` trick is gone,
replaced by explicit typed methods; the argv-parity for them lives in tests/clients/test_gcloud.py.

[fix #6] The gate runs EXACTLY ONE of adopt/destroy and NEVER leaves the strand unhealed (an
unhealed strand re-wedges the very apply this unblocks). The self-healing contract the unattended
paths depend on: `auto_approve` → always ADOPT, the destroy vector NEVER fires without a human.

Destroy vectors are best-effort (`_suppressed`) — the shell ran each delete UNCHECKED, so a failed
delete is non-fatal (the strand simply survives to the next apply). The state-manipulation heals
(WIF undelete, stranded-entry purge) RAISE loudly instead — a failed state-rm must stop the apply.
"""

import contextlib
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import confirm, log, ok, poll_until, warn
from devstash_infra.config import GcpConfig
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError
from devstash_infra.shared.reconcile_ar_iam import purge_stranded_ar_iam

# WIF undelete is async: poll up to ~60s for the pool/provider to read ACTIVE before importing
# (reconcile.sh:165). Module constants so a test can shrink the gap to 0 without a real minute.
_WIF_POLL_ATTEMPTS = 12
_WIF_POLL_GAP_S = 5.0

# The three stranded Cloud SQL addresses, leaves-BEFORE-instance so a purge mirrors Terraform's
# own destroy order (reconcile.sh:530). Shared by the arm-check and the purge.
_SQL_STRANDED_ADDRS = (
    "module.cloudsql.google_sql_user.app[0]",
    "module.cloudsql.google_sql_database.devstash[0]",
    "module.cloudsql.google_sql_database_instance.postgres[0]",
)

_PSC_PURPOSE_RE = re.compile(r'^\s*purpose\s*=\s*"([^"]+)"', re.MULTILINE)


# ── pure primitives (over the Tofu client) ───────────────────────────────────
def in_state(tofu: Tofu, addr: str) -> bool:
    """True iff `addr` is tracked in state — exact match, not a substring (reconcile.sh:31).

    `state list <addr>` filters to that address; the exact-line check guards against a substring
    line fooling the match (an unrelated resource that contains `addr` as a prefix).
    """
    return addr in tofu.state_list(addr)


def read_tfvar(tf_dir: str, key: str) -> str:
    """Value of a `key = true|false` toggle in active.auto.tfvars, or "" if absent.

    Ports _reconcile_tfvar (reconcile.sh:38) with pathlib + regex. A missing file (fresh/empty
    post-`down` state) yields "" — no crash.
    """
    path = Path(tf_dir) / "active.auto.tfvars"
    try:
        text = path.read_text()
    except OSError:
        return ""
    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*(true|false)", text, re.MULTILINE)
    return match.group(1) if match else ""


def adopt(tofu: Tofu, addr: str, import_id: str, label: str, *, fatal: bool = True) -> None:
    """Import `addr` into state: adopted / already-managed-warn / (fatal→raise).

    Ports _reconcile_adopt (reconcile.sh:58). The import is idempotent: a stale state read right
    after `init` could miss an address that import then reports as already-managed, so that outcome
    is success (the "already managed — skipped" warn); only a genuinely-still-absent address
    afterwards is fatal (when `fatal`). `fatal=False` for the quota case (a genuinely-absent
    preference is a normal plan CREATE, not a 409).
    """
    log(
        f"Reconcile: importing {label} into state (created by a prior apply that did "
        "not persist state)"
    )
    try:
        tofu.import_(addr, import_id, lock_timeout="120s")
        ok(f"{label} adopted into state")
    except ProcError:
        if in_state(tofu, addr):
            warn(f"{label} was already managed in state — import skipped")
        elif fatal:
            raise InfraError(
                f"failed to import {addr} — resolve manually, then re-run apply"
            ) from None


def psc_subnet_replace(tofu: Tofu) -> str | None:
    """`-replace=<addr>` when the PSC subnet still carries the legacy purpose, else None.

    Ports _reconcile_psc_subnet (reconcile.sh:243). PRIVATE_SERVICE_CONNECT is immutable (cannot be
    patched in place) so it must be replaced with a PRIVATE subnet. A pure value-returning function
    (the shell emitted on stdout for the caller to append).
    """
    addr = "module.network.google_compute_subnetwork.psc"
    text = tofu.state_show(addr)
    if not text:
        return None
    match = _PSC_PURPOSE_RE.search(text)
    if match and match.group(1) == "PRIVATE_SERVICE_CONNECT":
        warn(
            "Reconcile: PSC subnet has legacy purpose PRIVATE_SERVICE_CONNECT — "
            "scheduling a replace with a PRIVATE subnet"
        )
        return f"-replace={addr}"
    return None


def reconcile_choose(
    label: str,
    adopt_action: Callable[[], None],
    *,
    destroy_action: Callable[[], None] | None = None,
    destroy_note: str = "",
    auto_approve: bool = False,
) -> None:
    """The single adopt-vs-destroy gate every reconcile branch routes through [fix #6].

    Runs EXACTLY ONE of adopt/destroy; the final fallback is ALWAYS the safe adopt so the strand is
    never left unhealed. `destroy_action=None` is the IMPOSSIBLE sentinel — destroy is never offered
    (a soft-DELETED WIF name, etc.); the note is printed and we adopt.

    Decision order (reconcile.sh:95):
      1. auto_approve → ADOPT immediately, NO prompt (the unattended self-heal contract).
      2. destroy impossible → warn the note, then ADOPT (no prompt).
      3. interactive → confirm adopt? yes→ADOPT; no→confirm destroy? yes→DESTROY; no→ADOPT.
    """
    if auto_approve:
        adopt_action()
        return

    strand_msg = f"Reconcile: {label} already exists in GCP but is not tracked in Terraform state."

    if destroy_action is None:
        warn(strand_msg)
        if destroy_note:
            warn(destroy_note)
        adopt_action()
        return

    warn(strand_msg)
    if confirm(f"Adopt {label} into state and keep the existing resource?"):
        adopt_action()
        return
    if destroy_note:
        warn(destroy_note)
    if confirm(f"Destroy {label} in GCP and re-provision it from config instead?"):
        destroy_action()
        return
    warn("Neither confirmed — defaulting to adopt so the strand is healed and the apply proceeds.")
    adopt_action()


def _suppressed(action: Callable[[], None]) -> Callable[[], None]:
    """Wrap a destroy vector so its ProcError is swallowed — the shell ran each delete UNCHECKED, so
    a failed delete is non-fatal (the strand survives to the next apply, which retries).
    """

    def _run() -> None:
        with contextlib.suppress(ProcError):
            action()

    return _run


@dataclass(frozen=True)
class _Singleton:
    """One entry in the singleton adopt-vs-reprovision table (reconcile.sh:318).

    `exists=None` means the import itself is the presence probe (the quota case). `destroy` is the
    raw gcloud delete (wrapped best-effort at the call site). `adopt_prelude` runs before the import
    (the SQL RUNNABLE wait). Self-disabling: a no-op once `addr` is tracked or the resource is gone.
    """

    addr: str
    label: str
    import_id: str
    destroy_note: str
    destroy: Callable[[], None]
    exists: Callable[[], bool] | None = None
    gate_active: bool = True
    adopt_prelude: Callable[[], None] | None = None
    fatal: bool = True


@dataclass(frozen=True)
class Reconcile:
    """Adopt-vs-destroy reconcile over the typed clients. `auto_approve` is the unattended
    self-heal flag [fix #6]: it forces adopt everywhere and the destroy vector never fires.
    """

    config: GcpConfig
    gcloud: Gcloud
    tofu: Tofu
    auto_approve: bool = False

    # ── branch 1: the abandoned-but-existing Cloud SQL database ──────────────
    def reconcile_db_database(self, *, db_active: bool) -> None:
        """Adopt an untracked-but-existing Cloud SQL database (reconcile.sh:217).

        ONLY when db_active — during a suspend (db_active=false) the database resource is count→0,
        so an `import` target has no config and errors, blocking the very suspend meant to destroy
        it. A suspend WANTS the database gone, so there is nothing to adopt: skip.
        """
        addr = "module.cloudsql.google_sql_database.devstash[0]"
        if not db_active or in_state(self.tofu, addr):
            return
        instance = self.tofu.output_json().value("db_instance_name")
        if not instance:
            return
        db_name = self.config.db_name
        if not self.gcloud.sql.database_exists(db_name, instance=instance):
            return
        import_id = f"projects/{self.config.project}/instances/{instance}/databases/{db_name}"
        label = f"Cloud SQL database '{db_name}'"
        reconcile_choose(
            label,
            lambda: adopt(self.tofu, addr, import_id, label),
            destroy_action=_suppressed(
                lambda: self.gcloud.sql.delete_database(db_name, instance=instance)
            ),
            destroy_note=(
                "Destroying the database drops ALL its rows — the next apply recreates it empty "
                "(run.sh restores the last GCS dump on resume)."
            ),
            auto_approve=self.auto_approve,
        )

    # ── branch 3 helpers: SQL RUNNABLE wait + the singleton runner ───────────
    def wait_sql_runnable(self, sql_name: str) -> None:
        """Block until the Cloud SQL instance reads RUNNABLE, up to ~10min (reconcile.sh:259).

        Best-effort — adopt is attempted regardless of timeout. Guards a resume that races the prior
        apply's in-flight create from importing a PENDING_CREATE instance.
        """
        if self.gcloud.sql.instance_state(sql_name) == "RUNNABLE":
            return
        warn(f"Reconcile: Cloud SQL '{sql_name}' exists but is not RUNNABLE yet — waiting")
        poll_until(
            lambda: self.gcloud.sql.instance_state(sql_name) == "RUNNABLE",
            attempts=60,
            gap_seconds=10.0,
        )

    def _adopt_singleton(self, s: _Singleton) -> None:
        """Run one singleton branch: gate → in_state → presence → the uniform choose tail."""
        if not s.gate_active or in_state(self.tofu, s.addr):
            return
        if s.exists is not None and not s.exists():
            return  # not in GCP → let the plan CREATE it normally

        def _do_adopt() -> None:
            if s.adopt_prelude is not None:
                s.adopt_prelude()
            adopt(self.tofu, s.addr, s.import_id, s.label, fatal=s.fatal)

        reconcile_choose(
            s.label,
            _do_adopt,
            destroy_action=_suppressed(s.destroy),
            destroy_note=s.destroy_note,
            auto_approve=self.auto_approve,
        )

    def reconcile_singletons(self, *, db_active: bool, env_active: bool) -> None:
        """Adopt untracked-but-existing GLOBALLY-UNIQUE resources a partial apply stranded
        (reconcile.sh:318). Ordered exactly as the shell: bucket, quota, SQL, GKE, Valkey, AR-repo,
        ingress-IP, then the two WIF resources.
        """
        gc, p, r, e = self.gcloud, self.config.project, self.config.region, self.config.environment
        bucket = f"{p}-devstash-{e}-db-dumps"
        quota_id = f"compute-ssd-total-gb-{r}"
        sql_name = f"devstash-{e}-pg"
        gke_name = f"devstash-{e}-gke"
        valkey_name = f"devstash-{e}-valkey"
        ip_name = f"devstash-{e}-ip"

        singletons = (
            _Singleton(
                addr="google_storage_bucket.db_dumps",
                label=f"GCS bucket '{bucket}'",
                import_id=f"{p}/{bucket}",
                exists=lambda: gc.storage.bucket_exists(f"gs://{bucket}"),
                destroy=lambda: gc.storage.delete_bucket_recursive(f"gs://{bucket}"),
                destroy_note=(
                    "Destroying the bucket deletes ALL its objects, including the last Cloud SQL "
                    "dump — there is no restore after that."
                ),
            ),
            _Singleton(
                addr="google_cloud_quotas_quota_preference.compute_ssd_total_gb",
                label=f"quota preference '{quota_id}'",
                import_id=f"projects/{p}/locations/global/quotaPreferences/{quota_id}",
                exists=None,  # no probe (Cloud Quotas describe needs `alpha`); the import is it
                destroy=lambda: gc.quotas.delete_ssd_preference(quota_id),
                destroy_note=(
                    "Deleting a quota preference needs the gcloud 'alpha' component and is rarely "
                    "necessary — a stranded preference re-creates cleanly on the next apply."
                ),
                fatal=False,
            ),
            _Singleton(
                gate_active=db_active,
                addr="module.cloudsql.google_sql_database_instance.postgres[0]",
                label=f"Cloud SQL instance '{sql_name}'",
                import_id=f"{p}/{sql_name}",
                exists=lambda: bool(gc.sql.instance_state(sql_name)),
                destroy=lambda: gc.sql.delete_instance(sql_name),
                destroy_note=(
                    "Deleting the instance destroys the database and ALL its data — the next apply "
                    "recreates an empty instance (run.sh restores the last GCS dump on resume)."
                ),
                adopt_prelude=lambda: self.wait_sql_runnable(sql_name),
            ),
            _Singleton(
                gate_active=env_active,
                addr="module.gke.google_container_cluster.primary[0]",
                label=f"GKE cluster '{gke_name}'",
                import_id=f"projects/{p}/locations/{r}/clusters/{gke_name}",
                exists=lambda: gc.container.cluster_exists(gke_name, region=r),
                destroy=lambda: gc.container.delete_cluster(gke_name, region=r),
                destroy_note=(
                    "Deleting the cluster tears down every running workload on it and takes "
                    "several minutes to recreate."
                ),
            ),
            _Singleton(
                gate_active=env_active,
                addr="module.memorystore[0].google_memorystore_instance.cache",
                label=f"Valkey instance '{valkey_name}'",
                import_id=f"projects/{p}/locations/{r}/instances/{valkey_name}",
                exists=lambda: gc.memorystore.instance_exists(valkey_name, location=r),
                destroy=lambda: gc.memorystore.delete_instance(valkey_name, location=r),
                destroy_note=(
                    "Deleting the cache instance drops all cached data (rebuilt on demand) and "
                    "takes a few minutes to recreate."
                ),
            ),
            _Singleton(
                gate_active=env_active,
                addr="module.artifact_registry.google_artifact_registry_repository.docker[0]",
                label="Artifact Registry repo 'devstash'",
                import_id=f"projects/{p}/locations/{r}/repositories/devstash",
                exists=lambda: gc.artifacts.repo_exists("devstash", location=r),
                destroy=lambda: gc.artifacts.delete_repo("devstash", location=r),
                destroy_note=(
                    "Deleting the repo permanently removes ALL images pushed to it — the next "
                    "apply recreates it empty, so CI must rebuild + repush before a deploy runs."
                ),
            ),
            _Singleton(
                gate_active=env_active,
                addr="module.network.google_compute_global_address.ingress_ip[0]",
                label=f"ingress static IP '{ip_name}'",
                import_id=f"{p}/{ip_name}",
                exists=lambda: gc.compute.global_address_exists(ip_name),
                destroy=lambda: gc.compute.delete_global_address(ip_name),
                destroy_note=(
                    "Deleting the IP releases it back to the pool — DNS keeps pointing at the old "
                    "address until resume re-points it, so the app becomes unreachable until the "
                    "next apply/resume completes."
                ),
            ),
        )
        for singleton in singletons:
            self._adopt_singleton(singleton)

        # WIF pool + its child provider (import id nests under the pool). No active gate — each
        # self-checks in_state + GCP presence; a soft-DELETED name needs undelete first.
        pool_id = f"projects/{p}/locations/global/workloadIdentityPools/github-actions"
        self.adopt_wif(
            addr="module.iam.google_iam_workload_identity_pool.github",
            import_id=pool_id,
            state=lambda: gc.iam.wif_pool_state("github-actions"),
            undelete=lambda: gc.iam.undelete_wif_pool("github-actions"),
            delete=lambda: gc.iam.delete_wif_pool("github-actions"),
        )
        self.adopt_wif(
            addr="module.iam.google_iam_workload_identity_pool_provider.github",
            import_id=f"{pool_id}/providers/github",
            state=lambda: gc.iam.wif_provider_state("github", pool="github-actions"),
            undelete=lambda: gc.iam.undelete_wif_provider("github", pool="github-actions"),
            delete=lambda: gc.iam.delete_wif_provider("github", pool="github-actions"),
        )

    # ── branch 3h: WIF pool/provider adoption (soft-delete aware) ────────────
    def adopt_wif(
        self,
        *,
        addr: str,
        import_id: str,
        state: Callable[[], str],
        undelete: Callable[[], None],
        delete: Callable[[], None],
    ) -> None:
        """Gate one WIF resource absent from state but present in GCP (reconcile.sh:185). No-op when
        already tracked or genuinely absent. A soft-DELETED strand → destroy is IMPOSSIBLE (the name
        stays reserved ~30d, a fresh create 409s) so the gate never offers it: it explains and
        adopts (undelete + import). An ACTIVE-but-untracked strand → destroy IS possible; offered.
        """
        if in_state(self.tofu, addr):
            return
        if not state():
            return  # not in GCP at all → let the plan CREATE it normally
        label = f"WIF resource '{import_id}'"
        if state() == "DELETED":
            reconcile_choose(
                label,
                lambda: self._wif_undelete_import(addr, import_id, state, undelete),
                destroy_action=None,  # IMPOSSIBLE — soft-deleted name is reserved ~30d
                destroy_note=(
                    "It is soft-DELETED: the name stays reserved for ~30d and cannot be freed "
                    "early, so destroy-and-re-provision is impossible (a fresh create would 409). "
                    "Undeleting + adopting is the only path that works."
                ),
                auto_approve=self.auto_approve,
            )
            return
        reconcile_choose(
            label,
            lambda: adopt(self.tofu, addr, import_id, label),
            destroy_action=_suppressed(delete),
            destroy_note=(
                "Deleting a WIF pool/provider soft-deletes it — its name is then reserved ~30d, so "
                "it cannot be recreated until the reservation lapses. Adopt is strongly preferred."
            ),
            auto_approve=self.auto_approve,
        )

    def _wif_undelete_import(
        self, addr: str, import_id: str, state: Callable[[], str], undelete: Callable[[], None]
    ) -> None:
        """ADOPT vector for a WIF resource: if soft-DELETED, undelete + poll-for-ACTIVE, then import
        (reconcile.sh:153). Undelete is async, so poll before the shared import tail.
        """
        if state() == "DELETED":
            warn(
                f"Reconcile: WIF resource '{import_id}' is soft-DELETED but its name is still "
                "reserved — undeleting before import"
            )
            try:
                undelete()
            except ProcError:
                raise InfraError(
                    f"failed to undelete WIF resource '{import_id}' — resolve manually, then "
                    "re-run apply"
                ) from None
            poll_until(
                lambda: state() == "ACTIVE",
                attempts=_WIF_POLL_ATTEMPTS,
                gap_seconds=_WIF_POLL_GAP_S,
            )
        adopt(self.tofu, addr, import_id, f"WIF resource '{import_id}'")

    # ── branch 4: stranded repo-scoped AR-IAM members ────────────────────────
    def purge_stranded_ar_iam_branch(self, addr_file: str) -> None:
        """Drop stranded repo-scoped AR-IAM members from state when the repo is GONE
        (reconcile.sh:484). Pre-gates (repo absent AND ≥1 member still tracked) so a clean env stays
        a silent no-op — only then routes through the IMPOSSIBLE-destroy gate. The heal runs the
        SHARED POSIX helper and RAISES its non-zero so a laptop apply stops loudly on a failed
        state-rm.
        """
        repo = "devstash"  # mirrors modules/artifact-registry local.repository_id
        if self.gcloud.artifacts.repo_exists(repo, location=self.config.region):
            return  # present → managed, no-op
        addrs = [
            line.strip()
            for line in Path(addr_file).read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        if not any(in_state(self.tofu, a) for a in addrs):
            return  # nothing tracked → no real work → no prompt

        def _heal() -> None:
            if not purge_stranded_ar_iam(repo, self.config.region, self.config.project, addr_file):
                raise InfraError(
                    "failed to purge stranded AR-IAM member(s) from state — resolve manually, "
                    "then re-run apply"
                )

        reconcile_choose(
            f"stranded AR-IAM member(s) for repo '{repo}'",
            _heal,
            destroy_action=None,  # IMPOSSIBLE — no repo left to setIamPolicy on
            destroy_note=(
                "The repo is gone in GCP, so these members cannot be removed through the API — "
                "the only heal is to drop the dangling state entries; the next apply recreates the "
                "repo + members."
            ),
            auto_approve=self.auto_approve,
        )

    # ── branch 5: stranded Cloud SQL state entries ───────────────────────────
    def purge_stranded_sql(self) -> None:
        """Drop stranded Cloud SQL state entries when the instance is GONE (reconcile.sh:542).

        The inverse of branches 1/3c: a TRACKED-but-GONE instance whose surviving state entries make
        every plan's refresh 404 and abort. ONLY when the instance is genuinely absent; pre-gates on
        ≥1 tracked address so a clean env is a silent no-op. Destroy is IMPOSSIBLE — purging the
        dangling entries is the only heal, and resume recreates the instance + DB + user.
        """
        sql_name = f"devstash-{self.config.environment}-pg"
        if self.gcloud.sql.instance_state(sql_name):
            return  # present → nothing stranded
        if not any(in_state(self.tofu, a) for a in _SQL_STRANDED_ADDRS):
            return  # nothing tracked → no real work → no prompt

        def _heal() -> None:
            # Leaves (user, database) removed BEFORE the instance — Terraform's destroy order.
            for a in _SQL_STRANDED_ADDRS:
                if not in_state(self.tofu, a):
                    continue
                warn(
                    f"Reconcile: Cloud SQL instance '{sql_name}' is absent in GCP but '{a}' is "
                    "still in state — purging the stranded entry"
                )
                try:
                    self.tofu.state_rm(a)
                except ProcError:
                    raise InfraError(
                        f"failed to purge stranded Cloud SQL entry '{a}' from state — resolve "
                        "manually, then re-run apply"
                    ) from None

        reconcile_choose(
            f"stranded Cloud SQL state entries for '{sql_name}'",
            _heal,
            destroy_action=None,  # IMPOSSIBLE — instance already gone
            destroy_note=(
                "The instance is already gone in GCP, so there is nothing to delete — the only "
                "heal is to drop the dangling state entries; resume recreates the instance + DB + "
                "user and restores the last dump."
            ),
            auto_approve=self.auto_approve,
        )

    # ── driver ───────────────────────────────────────────────────────────────
    def run(self, ar_iam_addr_file: str) -> list[str]:
        """Heal state↔cloud drift a plain `tofu plan` can't resolve (reconcile.sh:580).

        A slim orchestrator over the self-disabling per-branch methods. Returns the `-replace=`
        targets for the caller to fold into `tofu plan`. MUST run AFTER `tofu init`. The two tfvar
        toggles gate the count-based resources: db_active gates the SQL database + instance;
        environment_active gates GKE/Valkey/AR/IP.
        """
        # A toggle counts as active unless it is literally "false" (absent/"" ⇒ active).
        db_active = read_tfvar(self.tofu.tf_dir, "db_active") != "false"
        env_active = read_tfvar(self.tofu.tf_dir, "environment_active") != "false"

        replace: list[str] = []
        self.reconcile_db_database(db_active=db_active)
        psc = psc_subnet_replace(self.tofu)
        if psc:
            replace.append(psc)
        self.reconcile_singletons(db_active=db_active, env_active=env_active)
        self.purge_stranded_ar_iam_branch(ar_iam_addr_file)
        self.purge_stranded_sql()
        return replace
