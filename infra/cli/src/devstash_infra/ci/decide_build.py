"""ci/decide_build.py — gate the image build: build+push, or skip because the env is parked at ~$0.

CLI zone (3.14). Port of infra/ci/decide-build.sh. build-push runs BEFORE the cluster exists (it
overlaps `apply` on a resume/up), so a live-cluster check alone can't tell "resume in flight, build
wanted" from "parked env, skip". Combine two cheap signals:
  • DISPATCH_REASON == 'provision' — run.sh set it because it IS provisioning (build wanted).
  • the GKE cluster already exists  — env active, a normal push to main (build wanted).
Neither holds → parked → build=false, so build-push + preflight + deploy all skip cleanly.

`cluster_present` is passed in (a one-shot probe the caller runs, or resolves under `set -e` so a
real gcloud/auth error fails loudly rather than being misread as "no cluster → skip"). The provision
short-circuit is checked FIRST so a resume/up never needs the cluster probe at all.
"""

from devstash_infra.ci import actions
from devstash_infra.common import log

_PARKED_WARNING = (
    "No GKE cluster and this is not a run.sh provision — environment is parked at ~$0. Skipping "
    "build + deploy so no images are wastefully rebuilt/repushed. Bring it back with: "
    "devstash-infra gcp resume"
)


def decide_build(*, dispatch_reason: str, cluster_present: bool) -> bool:
    """Return True iff the deploy should build+push; emits a parked-env warning when False."""
    if dispatch_reason == "provision":
        log("dispatch reason is 'provision' — run.sh is bringing the env up; building")
        return True
    if cluster_present:
        log("GKE cluster is present — environment active; building")
        return True
    actions.warning(_PARKED_WARNING)
    return False
