"""clients/gcloud.py — a typed facade over the gcloud CLI. CLI zone (3.14).

`Gcloud` groups the CLI by service (`.auth`, `.config`, `.projects`, `.billing`, `.services`,
`.storage`, `.compute`, …), mirroring gcloud's own command tree so calls read like the tool. The
client is scoped to ONE project (the deploy target), so service facades that need it close over
`self._project` rather than making every caller repeat it.

Each method builds its argv (asserted in this client's tests — the argv-parity anchor) and picks
its error contract EXPLICITLY, replacing the shell's three implicit modes:

- a probe (`… && …` / `[ -n "$(…)" ]`) → a `bool` / value (via `proc.run_ok` / a tolerant read);
- a best-effort op (`… 2>/dev/null || true`) → catches `ProcError` internally and returns a
  tolerant value ("" / None), so tolerance is a VISIBLE method decision, not a buried `|| true`;
- a hard mutation → lets `ProcError` (an `InfraError`) propagate to the boundary.

Interactive flows (`auth login`, ADC login) run with `capture=False` so gcloud can drive the
browser/console the way the shell's un-redirected calls did.
"""

import contextlib
from collections.abc import Sequence

from devstash_infra.common import warn
from devstash_infra.shared import proc, reap_negs, secrets
from devstash_infra.shared.proc import ProcError


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


class _Config:
    """`gcloud config` — the mutable active-project pointer."""

    def __init__(self, project: str) -> None:
        self._project = project

    def set_active_project(self) -> None:
        """`config set project <project>` — select the deploy target as active. Raises on error."""
        proc.run(["gcloud", "config", "set", "project", self._project])


class _Projects:
    """`gcloud projects` — the project resource itself."""

    def __init__(self, project: str) -> None:
        self._project = project

    def exists(self) -> bool:
        """True iff the project can be described (a probe — never raises)."""
        return proc.run_ok(["gcloud", "projects", "describe", self._project])

    def create(self, *, name: str) -> None:
        """`projects create <project> --name=<name>` — create the globally-unique project."""
        proc.run(["gcloud", "projects", "create", self._project, f"--name={name}"], capture=False)


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


class _Secrets:
    """`gcloud secrets` — Secret Manager reads, project-scoped.

    The newest-ENABLED-version read [#14] is nontrivial (list → filter ENABLED → newest → access)
    AND shared with the stdlib Cloud Build path, so its logic stays single-sourced in the floor
    (`shared/secrets.py`); this facade is the CLI's typed door onto it (adds the project scope).
    """

    def __init__(self, project: str) -> None:
        self._project = project

    def access_blob(self, name: str) -> str:
        """The secret's payload from its newest ENABLED version [#14] — never `access latest`."""
        return secrets.access_secret_blob(name, self._project)

    def newest_version(self, name: str) -> str:
        """The newest ENABLED version number of `name`, or "" if none [#14]. For re-import ids."""
        return secrets.newest_enabled_secret_version(name, self._project)

    def exists(self, name: str) -> bool:
        """True iff secret `name` is describable — set-dns-creds's create-if-absent gate."""
        return proc.run_ok(["gcloud", "secrets", "describe", name, f"--project={self._project}"])

    def create(self, name: str) -> None:
        """Create secret `name` with automatic replication (as elsewhere). Raises on failure."""
        proc.run(
            [
                "gcloud",
                "secrets",
                "create",
                name,
                "--replication-policy=automatic",
                f"--project={self._project}",
            ]
        )

    def add_version(self, name: str, payload: str) -> None:
        """Add a version to `name` from stdin (`--data-file=-`) — payload never touches argv."""
        proc.run(
            [
                "gcloud",
                "secrets",
                "versions",
                "add",
                name,
                "--data-file=-",
                f"--project={self._project}",
            ],
            input=payload,
        )


class _Sql:
    """`gcloud sql` — Cloud SQL instances + databases, project-scoped."""

    def __init__(self, project: str) -> None:
        self._project = project

    def instance_exists(self, name: str) -> bool:
        """True iff `name` is describable at all, regardless of state (db.sh:51 presence probe).

        Distinct from `instance_state` (which adds `--format=value(state)`): the resume overlap
        driver snapshots this BEFORE apply to decide `was_already_live` for the restore [#5].
        """
        return proc.run_ok(
            ["gcloud", "sql", "instances", "describe", name, f"--project={self._project}"]
        )

    def database_exists(self, database: str, *, instance: str) -> bool:
        """True iff `database` exists on `instance` (a presence probe)."""
        return proc.run_ok(
            [
                "gcloud",
                "sql",
                "databases",
                "describe",
                database,
                f"--instance={instance}",
                f"--project={self._project}",
            ]
        )

    def create_database(self, database: str, *, instance: str) -> None:
        """`sql databases create <db> --instance=<i> --quiet`. Raises on failure."""
        proc.run(
            [
                "gcloud",
                "sql",
                "databases",
                "create",
                database,
                f"--instance={instance}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def delete_database(self, database: str, *, instance: str) -> None:
        """`sql databases delete <db> --instance=<i> --quiet`. Raises on failure."""
        proc.run(
            [
                "gcloud",
                "sql",
                "databases",
                "delete",
                database,
                f"--instance={instance}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def import_sql(self, instance: str, dump_uri: str, *, database: str) -> None:
        """`sql import sql <i> <uri> --database=<db> --quiet` — restore a dump. Raises (NOT
        idempotent: a re-import over existing objects hits 'relation already exists', so the
        caller resets the DB to empty first, making a retry safe) [#5].
        """
        proc.run(
            [
                "gcloud",
                "sql",
                "import",
                "sql",
                instance,
                dump_uri,
                f"--database={database}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def instance_state(self, name: str) -> str:
        """The instance's `state` (e.g. RUNNABLE / PENDING_CREATE), or "" if absent (tolerant)."""
        result = proc.run(
            [
                "gcloud",
                "sql",
                "instances",
                "describe",
                name,
                f"--project={self._project}",
                "--format=value(state)",
            ],
            check=False,
        )
        return result.out if result.ok else ""

    def delete_instance(self, name: str) -> None:
        """`sql instances delete <n> --quiet` — destroys the instance + ALL its data. Raises."""
        proc.run(
            ["gcloud", "sql", "instances", "delete", name, f"--project={self._project}", "--quiet"]
        )

    def patch_activation_policy(self, name: str, policy: str) -> None:
        """`sql instances patch <n> --activation-policy=<p> --quiet`. Raises on failure (db.sh:79).

        The suspend dump starts a compute-only-suspended (STOPPED) instance just long enough to
        take a dump — `ALWAYS` brings it to RUNNABLE; the apply that follows destroys it anyway.
        """
        proc.run(
            [
                "gcloud",
                "sql",
                "instances",
                "patch",
                name,
                f"--project={self._project}",
                f"--activation-policy={policy}",
                "--quiet",
            ]
        )


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


class _Container:
    """`gcloud container clusters` — GKE, project-scoped (region is per-call)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def cluster_exists(self, name: str, *, region: str) -> bool:
        """True iff GKE cluster `name` exists in `region` (a presence probe)."""
        return proc.run_ok(
            [
                "gcloud",
                "container",
                "clusters",
                "describe",
                name,
                f"--region={region}",
                f"--project={self._project}",
            ]
        )

    def cluster_listed(self, name: str, *, region: str) -> bool:
        """True iff `name` is LISTABLE in `region` via `clusters list --filter=name=` — the shell's
        `ds_cluster_present`.

        LOUD-fail on a gcloud error (raises `ProcError`) so a real API/auth fault is NEVER misread
        as "absent" — the decide-build / check-env-active contract. This differs deliberately from
        the describe-based `cluster_exists` (which folds a 404 and an API error into one `False`): a
        filtered `list` echoes the name when present and prints nothing when genuinely absent, so
        present/absent is distinguishable from error.
        """
        result = proc.run(
            [
                "gcloud", "container", "clusters", "list",
                f"--project={self._project}", f"--region={region}",
                f"--filter=name={name}", "--format=value(name)",
            ]
        )  # fmt: skip
        return bool(result.out)

    def teardown_in_progress(self, name: str, *, region: str) -> bool:
        """True iff `name` is TORN DOWN — status STOPPING/ERROR, or an in-flight DELETE_CLUSTER op.

        The join guard `wait_for_cluster` [fix #11] checks this each poll: a KNOWN second operator
        can down/auto-suspend the same env mid-resume, and then the control-plane endpoint never
        answers because the cluster is DELETING — a blind reachability poll would burn its whole
        window (observed 2026-07-07). A STOPPING/deleting cluster is STILL LISTABLE, so
        `cluster_listed` can't tell "coming up" from "being destroyed"; this describe probe can.
        DEGRADED is EXCLUDED (it means "needs user action", not teardown). Both sub-probes
        are TOLERANT — a transient gcloud error warns once and returns not-torn-down so a blip never
        aborts a healthy resume (the caller re-checks next pass); a PERSISTENT failure surfaces via
        the warn rather than silently blinding the guard down to a plain timeout.
        """
        status = proc.run(
            [
                "gcloud", "container", "clusters", "describe", name,
                f"--project={self._project}", f"--region={region}", "--format=value(status)",
            ],
            check=False,
        )  # fmt: skip
        if not status.ok:
            warn(f"teardown probe: 'clusters describe {name}' failed — status signal unavailable")
        elif status.out in ("STOPPING", "ERROR"):
            return True

        # A DELETE issued by another actor can land before the status flips to STOPPING, so also
        # look for an unfinished DELETE_CLUSTER op targeting this cluster (`$` end-anchors it).
        ops = proc.run(
            [
                "gcloud", "container", "operations", "list",
                f"--project={self._project}", f"--location={region}",
                f"--filter=operationType=DELETE_CLUSTER AND status!=DONE "
                f"AND targetLink~/clusters/{name}$",
                "--format=value(name)",
            ],
            check=False,
        )  # fmt: skip
        if not ops.ok:
            warn(f"teardown probe: 'operations list' {name} failed — DELETE-op signal unavailable")
            return False
        return bool(ops.out)

    def delete_cluster(self, name: str, *, region: str) -> None:
        """`container clusters delete <n> --region=<r> --quiet` — tears down all workloads."""
        proc.run(
            [
                "gcloud",
                "container",
                "clusters",
                "delete",
                name,
                f"--region={region}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def sign_attestation(self, artifact: str, *, attestor: str, keyring: str, key: str) -> None:
        """KMS-sign `artifact` for Binary Authorization (`binauthz attestations sign-and-create`).

        Hard-fails (raises `ProcError`): enforcement is off when this runs, so a signing failure
        can't brick a live deploy, but a silent one would hide a broken pipeline from whoever later
        flips the cluster rule to REQUIRE_ATTESTATION. The attestor and the KMS key live in THIS
        project; KMS does the signing so no private key ever touches the runner.
        """
        proc.run(
            [
                "gcloud", "container", "binauthz", "attestations", "sign-and-create",
                f"--artifact-url={artifact}",
                f"--attestor={attestor}",
                f"--attestor-project={self._project}",
                f"--keyversion-project={self._project}",
                "--keyversion-location=global",
                f"--keyversion-keyring={keyring}",
                f"--keyversion-key={key}",
                "--keyversion=1",
            ]
        )  # fmt: skip


class _Memorystore:
    """`gcloud memorystore instances` — Valkey/Redis, project-scoped (location is per-call)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def instance_exists(self, name: str, *, location: str) -> bool:
        """True iff the Memorystore instance `name` exists in `location` (a presence probe)."""
        return proc.run_ok(
            [
                "gcloud",
                "memorystore",
                "instances",
                "describe",
                name,
                f"--location={location}",
                f"--project={self._project}",
            ]
        )

    def delete_instance(self, name: str, *, location: str) -> None:
        """`memorystore instances delete <n> --location=<l> --quiet` — drops cached data. Raises."""
        proc.run(
            [
                "gcloud",
                "memorystore",
                "instances",
                "delete",
                name,
                f"--location={location}",
                f"--project={self._project}",
                "--quiet",
            ]
        )


class _Artifacts:
    """`gcloud artifacts repositories` — Artifact Registry, project-scoped (location per-call)."""

    def __init__(self, project: str) -> None:
        self._project = project

    def repo_exists(self, name: str, *, location: str) -> bool:
        """True iff Artifact Registry repo `name` exists in `location` (a presence probe)."""
        return proc.run_ok(
            [
                "gcloud",
                "artifacts",
                "repositories",
                "describe",
                name,
                f"--location={location}",
                f"--project={self._project}",
            ]
        )

    def delete_repo(self, name: str, *, location: str) -> None:
        """`artifacts repositories delete <n> --location=<l>` — removes ALL images. Raises."""
        proc.run(
            [
                "gcloud",
                "artifacts",
                "repositories",
                "delete",
                name,
                f"--location={location}",
                f"--project={self._project}",
                "--quiet",
            ]
        )

    def list_packages(self, repo: str, *, location: str) -> list[str]:
        """Short package names in `repo` (last path segment of each `value(name)`). Tolerant → [].

        `value(name)` returns the full resource path (…/packages/<pkg>); the package segment may be
        URL-encoded (a nested `foo%2Fbar`) — leave it encoded, since the docker image path uses the
        same encoding. Used to DISCOVER every package live so the prune sweep also collapses ones
        the static known-image list doesn't name.
        """
        result = proc.run(
            [
                "gcloud", "artifacts", "packages", "list",
                f"--repository={repo}", f"--location={location}", f"--project={self._project}",
                "--format=value(name)",
            ],
            check=False,
        )  # fmt: skip
        return [line.rsplit("/", 1)[-1] for line in result.out.splitlines() if line]

    def superseded_manifests(
        self, image_path: str, *, created_before: str
    ) -> list[tuple[str, str]]:
        """`(version, mediaType)` rows for `image_path` created before `created_before`. Tolerant.

        The `createTime < <cutoff>` filter protects recent images from a concurrent/overlapping run.
        Output is tab-separated `value(version,metadata.mediaType)`; a missing media type → "".
        """
        result = proc.run(
            [
                "gcloud", "artifacts", "docker", "images", "list", image_path,
                f"--filter=createTime < {created_before}",
                "--format=value(version,metadata.mediaType)",
                f"--project={self._project}",
            ],
            check=False,
        )  # fmt: skip
        rows: list[tuple[str, str]] = []
        for line in result.out.splitlines():
            if not line:
                continue
            version, _, media_type = line.partition("\t")
            rows.append((version, media_type))
        return rows

    def newest_tagged_index(self, image_path: str) -> str:
        """Digest of the newest TAGGED OCI index for `image_path`, or "" (tolerant).

        For an EXTRA (unknown) package with no just-deployed digest to protect, "keep only 1" means
        keep the newest. A TAGGED index (not any newest manifest) is chosen so the kept digest is a
        real image whose children can be enumerated — its untagged children are protected elsewhere.
        """
        result = proc.run(
            [
                "gcloud", "artifacts", "docker", "images", "list", image_path,
                "--include-tags", "--sort-by=~createTime",
                "--filter=metadata.mediaType~index AND tags:*",
                "--format=value(version)", "--limit=1",
                f"--project={self._project}",
            ],
            check=False,
        )  # fmt: skip
        lines = result.out.splitlines()
        return lines[0] if lines else ""

    def delete_docker_image(self, image_ref: str) -> bool:
        """`docker images delete <ref> --delete-tags --quiet` → True on success (best-effort).

        `--delete-tags` lets an old TAGGED index be removed; Artifact Registry then GCs the children
        it orphans. Never raises — a prune hiccup must not fail an already-successful deploy.
        """
        return proc.run_ok(
            [
                "gcloud", "artifacts", "docker", "images", "delete", image_ref,
                "--delete-tags", "--quiet", f"--project={self._project}",
            ]
        )  # fmt: skip


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
        result = proc.run([*self._pool(name, "describe"), "--format=value(state)"], check=False)
        return result.out if result.ok else ""

    def undelete_wif_pool(self, name: str) -> None:
        """`workload-identity-pools undelete <n>` — restore a soft-deleted pool. Raises."""
        proc.run(self._pool(name, "undelete"))

    def delete_wif_pool(self, name: str) -> None:
        """`workload-identity-pools delete <n> --quiet` — soft-delete (name reserved ~30d)."""
        proc.run([*self._pool(name, "delete"), "--quiet"])

    def wif_provider_state(self, name: str, *, pool: str) -> str:
        """The provider's `state` (ACTIVE / DELETED), or "" if absent (tolerant)."""
        result = proc.run(
            [*self._provider(name, "describe", pool=pool), "--format=value(state)"], check=False
        )
        return result.out if result.ok else ""

    def undelete_wif_provider(self, name: str, *, pool: str) -> None:
        """`providers undelete <n> --workload-identity-pool=<pool>` — restore. Raises."""
        proc.run(self._provider(name, "undelete", pool=pool))

    def delete_wif_provider(self, name: str, *, pool: str) -> None:
        """`providers delete <n> --workload-identity-pool=<pool> --quiet` — soft-delete. Raises."""
        proc.run([*self._provider(name, "delete", pool=pool), "--quiet"])


class _Storage:
    """`gcloud storage` — object + bucket operations (URIs are explicit, so no project scope)."""

    def write_marker(self, uri: str) -> None:
        """Best-effort marker write (`gcloud storage cp /dev/null <uri>`; shell `|| true`).

        The provisioning marker is advisory — a write failure must never abort the apply, so a
        transient error is swallowed here rather than raised (the tolerance the shell got from
        `>/dev/null 2>&1 || true`).
        """
        with contextlib.suppress(ProcError):
            proc.run(["gcloud", "storage", "cp", "/dev/null", uri])

    def remove_marker(self, uri: str) -> None:
        """Best-effort marker removal (`gcloud storage rm <uri>`; shell `|| true`)."""
        with contextlib.suppress(ProcError):
            proc.run(["gcloud", "storage", "rm", uri])

    def bucket_exists(self, uri: str) -> bool:
        """True iff the bucket can be described (a probe — never raises)."""
        return proc.run_ok(["gcloud", "storage", "buckets", "describe", uri])

    def remove_recursive(self, uri: str) -> None:
        """Best-effort recursive delete (`gcloud storage rm -r <uri> --quiet`; shell `|| warn`).

        Deletes the Cloud Build `${project}_cloudbuild` staging bucket on suspend — an
        already-gone / never-created bucket must not fail the suspend, so the error is swallowed
        (the tolerance the shell got from `|| warn … continuing`).
        """
        with contextlib.suppress(ProcError):
            proc.run(["gcloud", "storage", "rm", "-r", uri, "--quiet"])

    def object_exists(self, uri: str) -> bool:
        """True iff the object at `uri` exists (a probe — the DB-dump presence check [#5])."""
        return proc.run_ok(["gcloud", "storage", "objects", "describe", uri])

    def cat(self, uri: str) -> str:
        """`gcloud storage cat <uri>` stdout, or "" if the object is absent/unreadable (tolerant).

        Reads the `.tflock` blob for the interactive `unlock` recovery — an absent lock ("" here)
        means it was already released, never an error, so this never raises.
        """
        result = proc.run(["gcloud", "storage", "cat", uri], check=False)
        return result.stdout if result.ok else ""

    def object_generation(self, uri: str) -> str:
        """The GCS object GENERATION of `uri` (`objects describe --format=value(generation)`).

        The numeric value `tofu force-unlock` needs for the gcs backend [#1] — NEVER the .tflock
        JSON "ID" UUID. Tolerant → "" when the object vanished (already reaped) so the caller can
        treat a now-absent lock as released.
        """
        result = proc.run(
            ["gcloud", "storage", "objects", "describe", uri, "--format=value(generation)"],
            check=False,
        )
        return result.out if result.ok else ""

    def create_bucket(self, uri: str, *, location: str) -> None:
        """`storage buckets create <uri> --location=<loc>` (single-region); location is fixed."""
        proc.run(["gcloud", "storage", "buckets", "create", uri, f"--location={location}"])

    def harden_bucket(self, uri: str) -> None:
        """Enforce uniform access + public-access prevention + versioning (reconciled every run:
        existence alone doesn't prove the security props are set). Raises on failure.
        """
        proc.run(
            [
                "gcloud",
                "storage",
                "buckets",
                "update",
                uri,
                "--uniform-bucket-level-access",
                "--public-access-prevention",
                "--versioning",
            ]
        )

    def set_bucket_lifecycle(self, uri: str, *, lifecycle_file: str) -> None:
        """`storage buckets update <uri> --lifecycle-file=<f>` — the state retention rule."""
        proc.run(
            ["gcloud", "storage", "buckets", "update", uri, f"--lifecycle-file={lifecycle_file}"]
        )

    def empty_bucket(self, uri: str) -> None:
        """`storage rm -r --all-versions <uri>/**` — delete every object version so the
        no-force_destroy guard can't block a `tofu destroy`. Raises (an already-empty bucket
        returns non-zero, which the teardown catches as a benign continue). URI is global, so no
        `--project` is needed.
        """
        proc.run(["gcloud", "storage", "rm", "-r", "--all-versions", f"{uri}/**", "--quiet"])

    def delete_bucket_recursive(self, uri: str) -> None:
        """`storage rm --recursive <uri> --quiet` — delete the bucket + every object in it. Raises
        (the reconcile destroy path suppresses the error, mirroring the shell's unchecked run).
        """
        proc.run(["gcloud", "storage", "rm", "--recursive", uri, "--quiet"])


class _Compute:
    """`gcloud compute` — scoped to a project."""

    def __init__(self, project: str) -> None:
        self._project = project

    def global_address(self, name: str) -> str:
        """The reserved GLOBAL static IP `name`, or "" if absent (a tolerant read).

        Ports `_gcp_ingress_ip`'s `… 2>/dev/null || true`: a missing address (suspended env, IP
        released) is a normal empty result, not an error — so an absent resource returns "".
        """
        try:
            result = proc.run(
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
        except ProcError:
            return ""
        return result.out

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
                "gcloud", "certificate-manager", "certificates", "describe", name,
                f"--project={self._project}", "--format=value(managed.state)",
            ],
            check=False,
        )  # fmt: skip
        return result.out if result.ok else ""


class _Builds:
    """`gcloud builds` — the Cloud Build coordination the apply-serialisation gate needs."""

    def __init__(self, project: str) -> None:
        self._project = project

    def ongoing_autosuspend_ids(self, region: str, environment: str) -> list[str]:
        """QUEUED/WORKING auto-suspend build ids for THIS env (`_ongoing_autosuspend_build_ids`).

        Matched by the trigger's stable NAME (`substitutions.TRIGGER_NAME`), not `buildTriggerId`
        which regenerates on a trigger replace — single-sourced so the apply-serialisation wait and
        the suspend cleanup can never drift on how "our auto-suspend build" is identified. Tolerant
        → [] on a transient list error (the shell's `|| true`).
        """
        result = proc.run(
            [
                "gcloud", "builds", "list", f"--region={region}", f"--project={self._project}",
                "--ongoing",
                f"--filter=substitutions.TRIGGER_NAME=devstash-{environment}-auto-suspend",
                "--format=value(id)",
            ],
            check=False,
        )  # fmt: skip
        return result.out.split() if result.ok else []

    def cancel(self, build_id: str, *, region: str) -> bool:
        """Best-effort cancel of one build (`gcloud builds cancel <id> --region=<r>`; tolerant).

        Returns True iff the cancel exited 0. Recovery relies on this to avoid reading a FAILED
        cancel as "holder confirmed dead" — the build may still run (concurrent-writer safety).
        """
        return proc.run_ok(
            ["gcloud", "builds", "cancel", build_id, f"--region={region}",
             f"--project={self._project}", "--quiet"]
        )  # fmt: skip


class Gcloud:
    """The gcloud facade, scoped to one project: `gcloud.billing.link(acct)`, `gcloud.storage.…`."""

    def __init__(self, project: str) -> None:
        self._project = project
        self.auth = _Auth()
        self.config = _Config(project)
        self.projects = _Projects(project)
        self.billing = _Billing(project)
        self.services = _Services(project)
        self.secrets = _Secrets(project)
        self.sql = _Sql(project)
        self.quotas = _Quotas(project)
        self.container = _Container(project)
        self.memorystore = _Memorystore(project)
        self.artifacts = _Artifacts(project)
        self.iam = _Iam(project)
        self.storage = _Storage()
        self.compute = _Compute(project)
        self.certificate_manager = _CertManager(project)
        self.builds = _Builds(project)
