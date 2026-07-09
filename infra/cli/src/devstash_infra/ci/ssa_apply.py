"""ci/ssa_apply.py — server-side apply a yq-selected slice of the rendered manifests.

CLI zone (3.14). Port of common.sh:ssa_apply — the SINGLE server-side-apply helper the deploy uses:
`yq '<selector>' <rendered> | kubectl apply --server-side --force-conflicts --field-manager=…`.
apply-infra applies everything EXCEPT the Deployment; rollout-web applies the Deployment — both from
the same rendered file so the split-apply gate is real. The stable field-manager + force-conflicts
posture (safe because base/deployment.yaml omits `replicas` — the HPA owns it) lives in the Kubectl
facade; this composes the yq filter with it.
"""

from pathlib import Path

from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq

FIELD_MANAGER = "devstash-deploy"


def ssa_apply(
    kubectl: Kubectl,
    yq: Yq,
    *,
    selector: str,
    rendered_path: Path,
    field_manager: str = FIELD_MANAGER,
) -> None:
    """Select docs from `rendered_path` with `selector` and server-side-apply them. Raises."""
    manifest = yq.eval(selector, str(rendered_path))
    kubectl.apply_server_side(manifest, field_manager=field_manager)
