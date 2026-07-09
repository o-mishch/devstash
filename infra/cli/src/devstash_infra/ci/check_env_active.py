"""ci/check_env_active.py — detect a deep-suspended env so the DEPLOY job can skip cleanly.

CLI zone (3.14). Port of infra/ci/check-env-active.sh. A suspended env (its GKE cluster destroyed)
is an EXPECTED state — someone merged to main while the showcase is parked — so the deploy job
self-skips as a warning, not a build failure.

WHY POLL (not one-shot): resume/up pre-dispatch this workflow so the cluster-independent build-push
overlaps `apply`; this preflight runs after build-push but the cluster may still be mid-creation. So
poll for a bounded window — a resume in flight resolves to active once the control plane registers;
a genuinely parked env exhausts the window and resolves to suspended. `cluster_present` is injected
(the caller resolves the gcloud probe); `sleep`/`gap_s` gate the retry cadence.
"""

import time
from collections.abc import Callable

from devstash_infra.ci import actions
from devstash_infra.common import log

_SUSPENDED_WARNING = (
    "Environment is suspended — the GKE cluster did not appear within the poll window. Skipping "
    "deploy: nothing is deployed and nothing fails. Bring it back with: "
    "devstash-infra gcp resume"
)


def check_env_active(
    cluster_present: Callable[[], bool],
    *,
    attempts: int = 40,
    gap_s: float = 15,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Poll for the cluster; return True iff SUSPENDED (absent after `attempts × gap_s`).

    A transient probe failure is the caller's concern (it resolves `cluster_present`); a persistent
    absence simply exhausts the window and reports suspended — the same safe skip either way.
    """
    for attempt in range(1, attempts + 1):
        if cluster_present():
            log("environment active — GKE cluster present; proceeding with deploy")
            return False
        if attempt < attempts:
            log(f"GKE cluster not listable yet (attempt {attempt}/{attempts}) — waiting {gap_s}s")
            sleep(gap_s)
    actions.warning(_SUSPENDED_WARNING)
    return True
