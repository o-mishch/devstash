"""ci/render_manifests.py — render the GCP overlay ONCE to a shared file.

CLI zone (3.14). Port of infra/ci/render-manifests.sh. `kubectl kustomize` the overlay to a single
rendered file so the infra apply (everything except the Deployment) and the post-migration web
rollout (the Deployment) apply the EXACT same output — a real migrate→rollout gate, not a re-render
race. Cloud SQL + Memorystore are Terraform-managed (not in this overlay); the migrate Job is
applied separately by run-migrations.

Post-render fix [incident: empty-armor securityPolicy]: when ARMOR_ENABLED != true, inject-settings
leaves armorPolicyName="" and kustomize writes `securityPolicy: ""`. GKE does NOT read that as "no
policy" — it builds a malformed Cloud Armor URL `.../securityPolicies/` with an empty name, the API
rejects it, and the ENTIRE Gateway fails to program (Programmed=False), serving no backend. Deleting
the field when empty is the documented "no policy" form; a non-empty prod value is left intact. `//
""` treats an absent field as empty too, so the delete is idempotent.
"""

from pathlib import Path

from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.common import log, ok

_DROP_EMPTY_ARMOR = (
    'select(.kind == "GCPBackendPolicy" and (.spec.default.securityPolicy // "") == "") '
    "|= del(.spec.default.securityPolicy)"
)


def render_manifests(kubectl: Kubectl, yq: Yq, *, overlay_dir: Path, rendered_path: Path) -> None:
    """Render `overlay_dir` to `rendered_path`, then drop an empty armor securityPolicy field."""
    log(f"Rendering the GCP overlay to {rendered_path}…")
    rendered_path.write_text(kubectl.kustomize(str(overlay_dir)))
    yq.eval_in_place(_DROP_EMPTY_ARMOR, str(rendered_path))
    ok(f"rendered manifests written to {rendered_path}")
