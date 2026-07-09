"""ci/wait_endpoint.py — gate: the PUBLIC URL must actually serve before the deploy is called done.

CLI zone (3.14). Port of infra/ci/wait-endpoint.sh. `kubectl rollout status` returns the moment the
POD's readiness probe passes — but that is NOT when https://$APP_DOMAIN starts serving. GKE Gateway
routes external traffic through a SEPARATE path the rollout gate knows nothing about: the NEG
controller must register the pod IP, the Gateway's BackendService must attach that NEG, and the L7
load balancer's OWN health check (distinct from the K8s probe) must mark the endpoint HEALTHY. Until
then the LB has zero healthy backends and answers 502 — for minutes AFTER a green rollout on a
from-scratch resume. This step closes that gap so a green run means a servable site.

The probe is `deep_health_ok` against /api/health?deep=1 — the SAME deep-health predicate `gcp
smoke` uses — which passes only when the body reports {"status":"ok"} (DB reachable too), proving an
end-to-end request through the public LB. WARN-AND-FINISH parity with the surrounding steps: an
unset APP_DOMAIN (never expected on a real deploy) skips rather than fails — nothing to poll.
"""

from collections.abc import Callable

import typer

from devstash_infra.ci import actions
from devstash_infra.clients.health import deep_health_ok
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.common import log, ok, poll_until
from devstash_infra.shared.errors import InfraError

# 60 × 10s = 10 min ceiling — same magnitude as the rollout gate, sized for a from-scratch resume
# where the Gateway/BackendService/NEG stack and an Autopilot node all come up cold.
_ATTEMPTS = 60
_GAP_S = 10.0

_NO_DOMAIN_WARNING = (
    "APP_DOMAIN is unset — skipping the public-endpoint gate. The rollout is healthy; only the "
    "end-to-end URL check was skipped."
)


def wait_endpoint(
    kubectl: Kubectl,
    *,
    app_domain: str,
    namespace: str,
    health_ok: Callable[[str], bool] = deep_health_ok,
    attempts: int = _ATTEMPTS,
    gap_s: float = _GAP_S,
) -> None:
    """Poll the public /api/health?deep=1 URL until it serves; raise `InfraError` on timeout.

    Skips (warns, returns) when `app_domain` is empty. `health_ok` is injected so tests drive the
    poll without real HTTP; `attempts`/`gap_s` size the same 10-minute ceiling as the shell.
    """
    if not app_domain:
        actions.warning(_NO_DOMAIN_WARNING)
        return

    url = f"https://{app_domain}/api/health?deep=1"
    log(f"Waiting for the public endpoint to serve: {url}")
    if poll_until(lambda: health_ok(url), attempts=attempts, gap_seconds=gap_s):
        ok(f"public endpoint is serving — {url} reports status:ok")
        return

    _dump_gateway_diagnostics(kubectl, namespace)
    raise InfraError(
        f"Public endpoint {url} did not report healthy within 10m.",
        hint=(
            "Pods are healthy (wait-rollout passed) but the load balancer never routed to a "
            "healthy backend — check the Gateway/HTTPRoute status and namespace events above."
        ),
    )


def _dump_gateway_diagnostics(kubectl: Kubectl, namespace: str) -> None:
    """Print Gateway/HTTPRoute status and the newest namespace events to stderr on a failure."""
    typer.echo("--- Gateway / HTTPRoute status ---", err=True)
    typer.echo(kubectl.get("gateway,httproute", namespace=namespace, output="wide"), err=True)
    typer.echo("--- Recent namespace events ---", err=True)
    events = kubectl.get("events", namespace=namespace, sort_by=".lastTimestamp")
    typer.echo("\n".join(events.splitlines()[-30:]), err=True)
