"""ci/wif_torn_down_skip.py — skip the deploy cleanly (green + warning) when the WIF pool is gone.

CLI zone (3.14). Port of infra/ci/wif-torn-down-skip.sh. Called by the gate job ONLY when the
google-github-actions/auth step failed because a full `run.sh down` soft-deleted the ungated WIF
pool/provider that back CI auth. CI CANNOT self-heal this (undeleting the pool needs GCP auth,
which needs the pool), so the right behavior is neither a silent skip nor a red failure: a green run
carrying a loud, self-explaining warning + `build=false` so build-push and its dependents self-skip.
"""

from devstash_infra.ci import actions

_WARNING = (
    "GCP auth failed: the Workload Identity Federation pool is torn down (soft-DELETED after a "
    "full 'devstash-infra gcp down'). CI cannot restore it — undeleting the pool itself needs GCP "
    "auth. Skipping build + deploy. Restore the environment locally with: devstash-infra gcp up "
    "(its reconcile step undeletes + re-adopts the WIF pool, which restores CI auth)."
)


def wif_torn_down_skip() -> bool:
    """Emit the actionable warning and return False (build=false) so the deploy cascade skips."""
    actions.warning(_WARNING)
    return False
