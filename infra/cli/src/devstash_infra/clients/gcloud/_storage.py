"""_storage.py — the `gcloud storage` sub-facade (part of the Gcloud package)."""

import contextlib

from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError

__all__ = ["_Storage"]


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
        return proc.run_out(
            ["gcloud", "storage", "objects", "describe", uri, "--format=value(generation)"]
        )

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
