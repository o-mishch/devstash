# Current Feature

## Status
Completed

## Goals
- Fix the linter warning "Context access might be invalid" on `${{ vars.ENABLE_GITHUB_ATTESTATIONS }}` (and other variables) in GKE workflows by correcting the config key in `.github/actionlint.yaml` from `variables` to `config-variables`.
- Fix the GHA build/deploy job crash caused by Helm version incompatibility (`Error: unknown flag: --rollback-on-failure`).

## Notes
- `actionlint` uses `config-variables:` to declare allowed custom variables, but the existing config incorrectly used `variables:`, which was ignored and caused the linter to flag legitimate `${{ vars.* }}` access.
- Helm v3 (on the GHA runner) does not support `--rollback-on-failure` (introduced in Helm 4). We resolved this by changing it to `--atomic` in the GHA workflow file (`deploy-gke.yml`). We kept `--rollback-on-failure` in `run.sh` and the local bootstrap documentation since they are executed on the developer's laptop where the latest Helm (v4) is installed.
