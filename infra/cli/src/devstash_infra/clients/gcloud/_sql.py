"""_sql.py — the `gcloud sql` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Sql"]


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
        return proc.run_out(
            [
                "gcloud",
                "sql",
                "instances",
                "describe",
                name,
                f"--project={self._project}",
                "--format=value(state)",
            ]
        )

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
