"""ci/verify_control_plane.py — prove the control plane is reachable BEFORE Helm spends time.

CLI zone (3.14). Port of infra/ci/verify-control-plane.sh. `get-gke-credentials` can be green while
the DNS endpoint refuses THIS runner's request — historically an IAM Condition on the deployer role
(removed in a051ad7), or `allow_external_traffic` drifting off. Helm then fails with a cryptic
"Kubernetes cluster unreachable: <html> 403" that reads like a chart fault. This probe hits
`/readyz`; a generic Google-Front-End 403 HTML page is translated into the two concrete gates to
check instead of a misleading downstream error.

Three outcomes (mirrors the shell): reachable → return True (proceed); a generic-403 drift signature
→ raise `InfraError` (the confirmed drift, fail the job); any OTHER unreachable signal → warn and
return False (this runner simply can't reach GCP — no creds/network — a skip, not a failure).
"""

import re

from devstash_infra.ci import actions
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.common import log, ok
from devstash_infra.shared.errors import InfraError

# A generic Google HTML 403 at the DNS endpoint is a Google-Front-End rejection (not a named-
# permission IAM denial); the two independent gates below can each cause it.
_GENERIC_403 = re.compile(r"403 \(Forbidden\)|That.{0,3}s an error", re.IGNORECASE)

_DRIFT_MESSAGE = (
    "GKE DNS endpoint returned a generic HTTP 403 at the Google Front End — the control plane "
    "refused this runner."
)


def _drift_hint(cluster: str, region: str) -> str:
    return (
        "Gate 1 (IAM): a resource-name IAM Condition on the deployer role (modules/iam/main.tf "
        "deployer_gke) never matches over the DNS endpoint, which evaluates container.clusters."
        "connect on the endpoint resource — this was the confirmed cause, fixed in a051ad7. Do NOT "
        "re-add such a condition.\n"
        "Gate 2 (network): allow_external_traffic drifted off. Confirm: gcloud container clusters "
        f"describe {cluster} --region {region} "
        "--format='value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)'  "
        "# expect True\n"
        "Reconcile drift with: tofu apply  (from infra/terraform/envs/dev)."
    )


def verify_control_plane(kubectl: Kubectl, *, cluster: str, region: str) -> bool:
    """Probe `/readyz`; True=reachable, False=treated-as-unavailable. Raise on the 403 drift.

    The 403-drift branch is the only loud failure — it is the confirmed, actionable regression.
    Any other unreachable signal is a benign skip so a runner without GCP access never reds a build.
    """
    log("Verifying the control plane is reachable over the DNS endpoint before Helm…")
    probe = kubectl.get_raw("/readyz")
    if probe.ok:
        ok(f"control plane reachable via DNS endpoint: {probe.out}")
        return True

    combined = f"{probe.stdout}\n{probe.stderr}"
    if _GENERIC_403.search(combined):
        raise InfraError(_DRIFT_MESSAGE, hint=_drift_hint(cluster, region))

    # Not the generic-403 drift signature — this runner simply can't reach GCP (no credentials,
    # network unreachable, 412 precondition, …). Warn, don't fail the job.
    actions.warning(
        "Control plane not reachable over the DNS endpoint and this is not the generic-403 drift "
        "signature — treating GCP as unavailable and skipping the preflight."
    )
    return False
