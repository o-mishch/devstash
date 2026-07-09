"""cloudbuild/cleanup_negs.py — step 6: reap leaked zonal NEGs after the suspend. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-cleanup-negs.sh. GKE races its own teardown and
orphans the zonal Network Endpoint Groups (+ stray firewall rules) the ingress created; left
unreaped they accumulate across suspend generations until they pin the VPC delete at the eventual
`down`. This runs AFTER the tofu suspend (off the critical dump→destroy path), so every NEG still
on OUR VPC is by definition a leaked orphan — the reap loop itself is the SHARED
`shared/reap_negs.reap_leaked_negs`, the one source of truth this step and the laptop `down` path
both use. Best-effort: the env is already at ~$0, so a cleanup miss must never fail the build.
"""

import logging
from pathlib import Path

from devstash_infra.cloudbuild.env import SUSPEND_SENTINEL, BuildEnv
from devstash_infra.shared.reap_negs import reap_leaked_negs

log = logging.getLogger(__name__)


def cleanup_negs(env: BuildEnv, *, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Reap leaked NEGs/firewalls on our VPC — no-op unless the guard marked this build idle."""
    if not sentinel.exists():
        log.info("not idle — skipping NEG cleanup")
        return
    reap_leaked_negs(env.vpc, env.project_id)
    log.info(
        "NEG/firewall cleanup complete — leaked GKE networking reaped so a future down stays clean"
    )
