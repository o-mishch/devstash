"""_builds.py — the `gcloud builds` sub-facade (part of the Gcloud package)."""

from devstash_infra.shared import proc

__all__ = ["_Builds"]


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
                "gcloud",
                "builds",
                "list",
                f"--region={region}",
                f"--project={self._project}",
                "--ongoing",
                f"--filter=substitutions.TRIGGER_NAME=devstash-{environment}-auto-suspend",
                "--format=value(id)",
            ],
            check=False,
        )
        return result.out.split() if result.ok else []

    def cancel(self, build_id: str, *, region: str) -> bool:
        """Best-effort cancel of one build (`gcloud builds cancel <id> --region=<r>`; tolerant).

        Returns True iff the cancel exited 0. Recovery relies on this to avoid reading a FAILED
        cancel as "holder confirmed dead" — the build may still run (concurrent-writer safety).
        """
        return proc.run_ok(
            [
                "gcloud",
                "builds",
                "cancel",
                build_id,
                f"--region={region}",
                f"--project={self._project}",
                "--quiet",
            ]
        )
