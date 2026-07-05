#!/usr/bin/env bash
# Emit a prominent, actionable ::warning:: and skip the deploy cleanly when GCP auth failed
# because the Workload Identity Federation pool is gone. Called by the `gate` job ONLY when the
# google-github-actions/auth step failed (steps.auth.outcome == 'failure').
#
# WHY this exists (and why it is a WARNING, not an error): a full `run.sh down` (tofu destroy)
# tears down the WHOLE environment, INCLUDING the ungated WIF pool/provider that back CI auth.
# With the pool soft-deleted, GitHub's OIDC token can no longer be exchanged, so every
# google-github-actions/auth step fails with a cryptic STS `invalid_target`. CI CANNOT self-heal
# this: undeleting the pool needs GCP auth, which needs the pool — a hard chicken-and-egg. The
# only recovery is out-of-band, local credentials: `run.sh up`/`resume`/`apply`, whose reconcile
# step (lib/reconcile.sh _reconcile_adopt_wif) undeletes + re-imports the pool. So the RIGHT CI
# behavior is neither a silent skip (would hide a full teardown) nor a red failure (nothing is
# broken — the env is simply gone): a green run carrying a loud, self-explaining warning.
#
# Sets build=false so build-push (guarded on gate.outputs.build == 'true') and its dependents
# preflight + deploy all skip cleanly — the SAME cascade a parked env already triggers.
#
# Required env:
#   GITHUB_OUTPUT  — set by the runner
set -euo pipefail

echo "::warning::GCP auth failed: the Workload Identity Federation pool is torn down (soft-DELETED after a full 'run.sh down'). CI cannot restore it — undeleting the pool itself needs GCP auth. Skipping build + deploy. Restore the environment locally with: bash infra/run/gcp/run.sh up (its reconcile step undeletes + re-adopts the WIF pool, which restores CI auth)."
echo "build=false" >> "$GITHUB_OUTPUT"
