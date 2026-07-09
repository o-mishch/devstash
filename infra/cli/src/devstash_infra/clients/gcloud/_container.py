"""_container.py — the `gcloud container` sub-facade (part of the Gcloud package)."""

from devstash_infra.common import warn
from devstash_infra.shared import proc

__all__ = ["_Container"]


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
                "gcloud",
                "container",
                "clusters",
                "list",
                f"--project={self._project}",
                f"--region={region}",
                f"--filter=name={name}",
                "--format=value(name)",
            ]
        )
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
                "gcloud",
                "container",
                "clusters",
                "describe",
                name,
                f"--project={self._project}",
                f"--region={region}",
                "--format=value(status)",
            ],
            check=False,
        )
        if not status.ok:
            warn(f"teardown probe: 'clusters describe {name}' failed — status signal unavailable")
        elif status.out in ("STOPPING", "ERROR"):
            return True

        # A DELETE issued by another actor can land before the status flips to STOPPING, so also
        # look for an unfinished DELETE_CLUSTER op targeting this cluster (`$` end-anchors it).
        ops = proc.run(
            [
                "gcloud",
                "container",
                "operations",
                "list",
                f"--project={self._project}",
                f"--location={region}",
                f"--filter=operationType=DELETE_CLUSTER AND status!=DONE "
                f"AND targetLink~/clusters/{name}$",
                "--format=value(name)",
            ],
            check=False,
        )
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
                "gcloud",
                "container",
                "binauthz",
                "attestations",
                "sign-and-create",
                f"--artifact-url={artifact}",
                f"--attestor={attestor}",
                f"--attestor-project={self._project}",
                f"--keyversion-project={self._project}",
                "--keyversion-location=global",
                f"--keyversion-keyring={keyring}",
                f"--keyversion-key={key}",
                "--keyversion=1",
            ]
        )
