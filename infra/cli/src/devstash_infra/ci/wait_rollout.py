"""ci/wait_rollout.py — gate: new web pods must become healthy within the rollout budget.

CLI zone (3.14). Port of infra/ci/wait-rollout.sh. On failure it DOES NOT auto-rollback: the
migration Job (the gate above this step) has already advanced the DB schema, so rolling the
Deployment back to the old image would run old code against a newer schema — crashes or data
corruption. The fix is forward (a new commit); the old pods keep serving (`maxUnavailable: 0`), so
traffic is uninterrupted meanwhile. On failure this emits the crash diagnostics the operator needs,
then raises so the job goes red.
"""

import typer

from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.common import log
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError

_DEPLOYMENT = "deployment/devstash-web"
_POD_SELECTOR = "app.kubernetes.io/name=devstash"
_ROLLOUT_TIMEOUT = "300s"

_FAIL_MESSAGE = "Rollout failed — new web pods did not become healthy within 300s."
_FIX_FORWARD = (
    "DO NOT roll back the Deployment — migrations have already run against the new schema. Fix "
    "forward: push a commit that resolves the pod startup failure. Old pods keep serving "
    "(maxUnavailable: 0), so traffic is uninterrupted while you fix and re-deploy."
)


def wait_rollout(kubectl: Kubectl, *, namespace: str) -> None:
    """Block until `devstash-web` rolls out; on timeout emit diagnostics and raise `InfraError`."""
    log(f"Waiting up to {_ROLLOUT_TIMEOUT} for {_DEPLOYMENT} to roll out…")
    try:
        kubectl.rollout_status(_DEPLOYMENT, namespace=namespace, timeout=_ROLLOUT_TIMEOUT)
    except ProcError as exc:
        _dump_rollout_diagnostics(kubectl, namespace)
        raise InfraError(_FAIL_MESSAGE, hint=_FIX_FORWARD) from exc


def _dump_rollout_diagnostics(kubectl: Kubectl, namespace: str) -> None:
    """Print the deployment's recent events and each failing pod's previous-container logs."""
    describe = kubectl.describe(_DEPLOYMENT, namespace=namespace)
    _echo_block("Recent pod events", "\n".join(describe.splitlines()[-20:]))

    # `logs --previous` is rejected alongside a label selector, so collect pod names first and
    # fetch each pod's previous-container logs individually.
    logs = [
        block
        for pod in kubectl.pod_names(_POD_SELECTOR, namespace=namespace)
        if (block := kubectl.previous_logs(pod, namespace=namespace, tail=100))
    ]
    _echo_block("Logs from failing pods", "\n".join(logs))


def _echo_block(title: str, body: str) -> None:
    typer.echo(f"--- {title} ---", err=True)
    if body:
        typer.echo(body, err=True)
