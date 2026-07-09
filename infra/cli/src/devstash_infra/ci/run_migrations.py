"""ci/run_migrations.py — run DB migrations as a gated Job BEFORE the web Deployment rolls.

CLI zone (3.14). Port of infra/ci/run-migrations.sh. A real migrate→rollout gate (not the old
`:latest` race): the migrate Job lands and is proven Complete before wait-rollout lets the new web
pods take traffic. ALWAYS runs — never skipped on a heuristic: `prisma migrate deploy` applies only
pending migrations and no-ops when current, and a clean prisma/ file-diff does NOT prove the DB
schema is current (a `resume` restores the DB from a possibly-older dump with prisma/ unchanged), so
a diff-based skip could ship new code against an un-migrated schema.

migrate-job.yaml is applied directly (not via kustomize, which would fail on the immutable Job on
re-apply); it hard-codes `namespace: devstash`. The image is injected with yq — the Python mirror of
kustomize's `images` transformer for the web Deployment. Maps the job gate's outcome to a CI
`::error::` (raise); local `run_migrate` wraps the SAME `wait_for_job_gate`, so they can't drift.
"""

from pathlib import Path

import typer

from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.common import log, ok
from devstash_infra.job_gate import JobGate, wait_for_job_gate
from devstash_infra.shared.errors import InfraError

_MIGRATE_JOB = "devstash-migrate"
_IMAGE_EXPR = ".spec.template.spec.containers[0].image = strenv(MIGRATE_IMAGE)"
_DEADLINE_S = 600.0


def run_migrations(
    kubectl: Kubectl, yq: Yq, *, namespace: str, migrate_image: str, manifest_path: Path
) -> None:
    """Apply the digest-pinned migrate Job and block on its gate; raise on Failed/timeout.

    `manifest_path` is the tracked migrate-job.yaml; its image field is patched to `migrate_image`
    and the result is piped to `kubectl apply` (never mutating the source, never a temp file).
    """
    log("Running the migrate Job unconditionally (prisma migrate deploy is idempotent).")

    # Capture a prior failed run's logs BEFORE deleting it — the delete destroys the pod + its logs.
    prior_logs = kubectl.job_logs(_MIGRATE_JOB, namespace=namespace, tail=100)
    if prior_logs:
        typer.echo("--- Logs from previous migrate job (captured before delete) ---")
        typer.echo(prior_logs)

    kubectl.delete_job(_MIGRATE_JOB, namespace=namespace)
    patched = yq.eval(_IMAGE_EXPR, str(manifest_path), env_extra={"MIGRATE_IMAGE": migrate_image})
    kubectl.apply_stdin(patched)

    gate = wait_for_job_gate(kubectl, namespace=namespace, job=_MIGRATE_JOB, deadline_s=_DEADLINE_S)
    if gate is JobGate.FAILED:
        raise InfraError("migration job reached Failed condition")
    if gate is JobGate.TIMEOUT:
        raise InfraError("migration job did not complete within 600s")

    ok("migrate Job completed")
    final_logs = kubectl.job_logs(_MIGRATE_JOB, namespace=namespace, tail=50)
    if final_logs:
        typer.echo(final_logs)
