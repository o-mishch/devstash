"""ci/rollout_web.py — apply the web Deployment to trigger the rolling update.

CLI zone (3.14). Port of infra/ci/rollout-web.sh. Applies ONLY the Deployment from the shared render
(the same file apply-infra used for everything else) AFTER migrations have landed — this is what
triggers the rolling update to the new digest-pinned image. Server-side apply with the shared
`devstash-deploy` field-manager (no imperative `kubectl set image`); wait-rollout gates on the
resulting rollout completing.
"""

from pathlib import Path

from devstash_infra.ci.ssa_apply import ssa_apply
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.common import log, ok

_DEPLOYMENT_SELECTOR = 'select(.kind == "Deployment")'


def rollout_web(kubectl: Kubectl, yq: Yq, *, rendered_path: Path) -> None:
    """Server-side-apply the web Deployment from `rendered_path`, triggering the rolling update."""
    log("Applying the web Deployment to trigger the rolling update…")
    ssa_apply(kubectl, yq, selector=_DEPLOYMENT_SELECTOR, rendered_path=rendered_path)
    ok("web Deployment applied — rollout triggered")
