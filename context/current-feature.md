# Current Feature

## Status
In Progress

## Goals
Speed up the `deploy-gke` workflow by parallelizing independent work inside the
`deploy` job — without touching the truly-serial migrate→rollout spine or the
suspended-env gate.

- **A — ESO ‖ Reloader**: run the two independent `helm upgrade --install ... --wait`
  operator installs concurrently (up to ~5 min saved on cold installs). They install
  into different namespaces/releases and share no state; both must finish before
  `apply-infra` (which needs their CRDs).
- **D — inject+render earlier (done)**: `inject-settings` → `render-manifests` is a pair
  that needs only the image env vars + checkout, not the cluster (`render-manifests.sh`
  runs `kubectl kustomize`, a client-side render). Moved to run BEFORE the operator
  install so it's off the `get-creds → apply-infra` critical path. GitHub Actions steps
  run serially, so this is "render first, then operators" — not true concurrency (that
  would need a `&`/`wait` wrapper as in A); the win is simply that render no longer sits
  wedged between two cluster operations.
- **C — dual Trivy (not yet implemented)**: the two end-of-job image scans are
  independent; run them concurrently.

## Non-goals (explicitly dropped)
- **B — preflight restructure**: the `preflight` bounded poll is what lets a
  mid-resume run *skip* (not fail) at `get-creds`; the double auth is inherent to
  fresh runners (no credential carryover). Marginal payoff, real regression risk →
  NOT changed.
- The serial spine `get-creds → apply-infra → wait-secrets → migrate → rollout-web →
  wait-rollout` is a hard floor by design (migrate must land before rollout). Untouched.

## Notes
- Mechanism: **bash `&` + `wait` in a checked-in wrapper script** for the operator
  installs (per-case decision) — no dependency on GitHub's 2-week-old native
  parallel-steps feature, and fully shellcheck-able per `.agents/rules/infra.md`
  (no inline multi-line YAML shell).
- Ordering constraint preserved: ESO+Reloader CRDs must exist before `apply-infra`;
  render depends on inject; nothing cluster-side may precede `get-creds`.
- Trivy uses the `aquasecurity/trivy-action` marketplace action, so C is done via the
  workflow's native background/wait steps (can't `&` a `uses:` step), or by leaving
  them serial if the feature proves unreliable.

## Bundled: Artifact Registry gated on `environment_active` (separate change)
Also present in this changeset — logically independent of the deploy-gke work above and
**separately committable**. The AR repo (`modules/artifact-registry`) and its four
repo-scoped IAM bindings (`modules/iam`) now gate on `environment_active`, so a
deep-suspend destroys the repo + every image THROUGH Terraform (the same `-refresh=false`
suspend apply) instead of an out-of-band `gcloud artifacts repositories delete` step.
Consequently removed: the `delete-registry` Cloud Build step (`auto-suspend-delete-repo.sh`),
`run.sh`'s `delete_registry`, and `reconcile.sh`'s AR-repo `state rm` branch (no orphaned
repo can remain in state to 403 on refresh). The lifecycle deleter grant moved to PROJECT
scope (`google_project_iam_member`) so it outlives the repo the same apply destroys, gaining
`repositories.get/set IamPolicy`. Module outputs are static (repo NAME, not the resource
attribute) so consumers resolve while the repo is absent.
