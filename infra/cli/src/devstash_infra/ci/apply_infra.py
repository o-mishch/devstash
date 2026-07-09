"""ci/apply_infra.py — server-side apply everything EXCEPT the web Deployment. CLI zone (3.14).

Port of apply-infra.sh. Two parts: (1) a one-time, self-disabling cleanup of the legacy GCE-Ingress
stack the Gateway-API overlay replaced (a plain SSA apply never deletes objects that fell out of the
manifest set, so the old classic-ALB Ingress would linger and bill), then (2) `ssa_apply` of the
rendered manifest MINUS the Deployment — existing web pods keep serving the previous image until the
post-migration rollout (rollout-web), so new code never reaches users ahead of its schema migration.
"""

from pathlib import Path

from devstash_infra.ci.ssa_apply import ssa_apply
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.common import log

# The legacy GCE-Ingress objects to delete on the first Gateway deploy (kind, name). Idempotent via
# --ignore-not-found — a no-op on every deploy after the first and on a fresh install.
_LEGACY_OBJECTS = (
    ("ingress", "devstash-web"),
    ("backendconfig", "devstash-backendconfig"),
    ("frontendconfig", "devstash-frontendconfig"),
    ("managedcertificate", "devstash-cert"),
)

# Everything except the web Deployment; the Deployment is applied separately by rollout-web so
# existing pods keep the previous image until the post-migration rollout gate.
_SELECTOR = 'select(.kind != "Deployment")'


def apply_infra(kubectl: Kubectl, yq: Yq, *, namespace: str, rendered_path: Path) -> None:
    """Delete the legacy Ingress stack, then SSA-apply the render minus the web Deployment."""
    for kind, name in _LEGACY_OBJECTS:
        kubectl.delete(kind, name, namespace=namespace)

    log("Applying infra (everything except the web Deployment)…")
    ssa_apply(kubectl, yq, selector=_SELECTOR, rendered_path=rendered_path)
