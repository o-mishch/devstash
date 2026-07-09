# devstash-infra

Typed Python CLI porting the DevStash `infra/` shell layer (OpenTofu + gcloud +
kubectl lifecycle). Replaces every `.sh` under `infra/run/`, `infra/lib/`, and
`infra/ci/`, plus the 6-step Cloud Build auto-suspend pipeline.

Source of truth: `context/features/infra-shell-to-python-cli-spec.md`.

## Python Floor

- **3.14** — the entire codebase (both the operator CLI and the Cloud Build auto-suspend path) targets a single floor of **3.14**. The auto-suspend path runs on `google/cloud-sdk:slim`'s bundled Cloud SDK Python interpreter (3.14.5) with **zero install** (stdlib-only: no typer, no pydantic, no structlog).
- **Toolchain**: Enforced by strict mypy, ruff, basedpyright checks, an import-grep guard, and `scripts/check_floor_drift.py` which verifies that the pinned image's bundled python matches the 3.14 floor.

Dev + CI run a single uv-managed **3.14.6**.

## Setup

**Prerequisites**

- **uv** installed as a **standalone system utility**:
  - **macOS/Linux**: `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `brew install uv`)
  - **Windows**: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`

`uv` reads `.python-version` and automatically downloads and manages the required Python interpreter (e.g. **3.14.6**), so `pyenv` is not required.

**Initialize the venv**

```bash
cd infra/cli
uv venv                          # create the .venv using .python-version
uv sync --frozen                 # download Python and sync dependencies
uv run pre-commit install        # wire format/lint hooks
uv run devstash-infra --help     # verify
```

- **Use `--frozen`** — installs exactly `uv.lock`, fails if `pyproject.toml` drifted
  from it (reproducible; the CI contract). Omit it only when *intentionally* changing
  deps, then commit the regenerated `uv.lock`.
- **No manual activation needed** — `uv run <cmd>` executes inside `.venv`
  automatically. (`source .venv/bin/activate` still works if you prefer a shell.)
- The **Cloud Build path installs nothing** — `shared/` + `cloudbuild/` run on
  the image's bundled `python3`, stdlib-only. uv/venv is for the operator CLI side.

## Commands

```bash
uv sync                 # create venv + install (dev group included)
uv run pre-commit install  # once per clone — wire the mandatory format/lint hooks
uv run pytest           # tests (argv-parity via pytest-subprocess)
uv run mypy             # strict typecheck (3.14)
python3 scripts/check_floor_drift.py  # floor-drift guard: pinned image python3 == declared 3.14
uv run basedpyright     # strict typecheck (pyright fork, stricter inference)
uv run ruff format --check  # MANDATORY — formatting gate (fix with `uv run ruff format`)
uv run ruff check       # lint (core + bandit-security + pathlib + pytest-style + idiomatic)
uv audit --preview-features audit-command  # supply-chain: fail on known-vuln deps
uv run devstash-infra --help
```

**Formatting is mandatory.** `ruff format --check` is a hard gate (pre-commit + CI),
so every author — human or AI agent — must run `uv run ruff format` before committing.
See `.pre-commit-config.yaml`; the rule is codified in `.agents/rules/infra-python.md`.

## Usage

The package installs one console script, **`devstash-infra`**, with three sub-apps.
Run it either through uv (no activation needed) or directly once the venv is on `PATH`:

```bash
uv run devstash-infra <group> <command> [OPTIONS]   # from infra/cli/, recommended
devstash-infra <group> <command> [OPTIONS]          # if .venv/bin is on PATH
```

Every command self-documents — append `--help` at any level:

```bash
uv run devstash-infra --help              # the three groups
uv run devstash-infra gcp --help          # all gcp verbs
uv run devstash-infra gcp suspend --help  # one verb's options
```

Commands run from the **repo root's** perspective (they read `infra/terraform/…`,
`infra/k8s/…`, `infra/versions.env` by repo-relative path), exactly as the shell
scripts assumed. Invoke from anywhere under the repo; paths resolve against the repo root.

**Non-interactive / CI:** set `AUTO_APPROVE=1` to skip every confirm prompt (the shell's
escape hatch). Destructive gates that can't be safely auto-answered — notably the `unlock`
"release a possibly-live lock" gate — **refuse** under `AUTO_APPROVE=1` rather than proceed.

### `gcp` — GCP environment lifecycle (`run/gcp/run.sh`)

```bash
uv run devstash-infra gcp bootstrap        # provision project / billing / state bucket / APIs
uv run devstash-infra gcp up               # first-ever / post-down bring-up (provision + deploy)
uv run devstash-infra gcp apply            # apply the reviewed plan (overlaps the CI image build)
uv run devstash-infra gcp suspend          # deep-suspend to ~$0 (dump+verify DB, then destroy)
uv run devstash-infra gcp resume           # bring back from suspend (recreate, restore, redeploy)
uv run devstash-infra gcp down             # force-destroy everything (buckets + last dump too)

uv run devstash-infra gcp deploy           # dispatch the deploy-gke CI workflow
uv run devstash-infra gcp smoke            # wait for the latest run, health-check the public URL
uv run devstash-infra gcp status           # read-only cluster / secrets / ingress / cert / health
uv run devstash-infra gcp logs             # tail every devstash-web pod (pod-prefixed)

uv run devstash-infra gcp eso              # install/upgrade External Secrets Operator
uv run devstash-infra gcp reloader         # install/upgrade Stakater Reloader
uv run devstash-infra gcp upgrade-helm     # bump ESO + Reloader to latest, reinstall
uv run devstash-infra gcp secrets          # push tofu outputs to GitHub Actions, then verify
uv run devstash-infra gcp verify-secrets   # report app-config keys present + ESO sync state
uv run devstash-infra gcp rotate-secret <name>   # rotate ONE app-config property (value read hidden)

uv run devstash-infra gcp dump-db          # export + verify the Cloud SQL DB to its GCS dump
uv run devstash-infra gcp restore-db       # import the latest dump (never over live data)
uv run devstash-infra gcp update-dns [--ingress-ip <IP>]   # re-point the A-record via Spaceship
uv run devstash-infra gcp set-dns-creds    # store the Spaceship API key + secret (read hidden)
uv run devstash-infra gcp unlock           # inspect + release a stuck tofu state lock (safely)
```

### `local` — kind stack (`run/local/run.sh`)

```bash
uv run devstash-infra local up             # build the full stack on kind + verify (default flow)
uv run devstash-infra local deploy         # fast iterate: rebuild images, re-migrate, roll out
uv run devstash-infra local status         # cluster / app / deep-health summary
uv run devstash-infra local info           # print all service URLs (app, Postgres, MinIO, …)
uv run devstash-infra local down           # tear down the kind cluster
```

### `ci` — one command per `deploy-gke.yml` step (`infra/ci/*.sh`)

Each is a thin boundary that reads its step's own `env:`, runs the ported logic, and writes
any gate decision to `$GITHUB_OUTPUT`/`$GITHUB_ENV`. Normally invoked by the workflow, but
runnable locally with the matching env set:

```bash
uv run devstash-infra ci --help            # all 18 steps
uv run devstash-infra ci decide-build      # e.g. the build/skip gate
```

Steps: `validate-inputs`, `wif-torn-down-skip`, `decide-build`, `check-env-active`,
`build-push`, `sign-images`, `check-migrations`, `inject-settings`, `render-manifests`,
`verify-control-plane`, `ensure-operators`, `apply-infra`, `wait-secrets-sync`,
`run-migrations`, `rollout-web`, `wait-rollout`, `wait-endpoint`, `prune-registry`.

### Cloud Build auto-suspend path (stdlib-only, no console script)

The 6 auto-suspend steps run on `google/cloud-sdk:slim`'s bundled `python3` with **zero
install** — invoked as a module, not through `devstash-infra`:

```bash
python3 -m devstash_infra.cloudbuild <step>   # guard | prepare | dump | suspend | cleanup-builds | cleanup-negs
```

Their inputs come from the Cloud Build `$_VAR` substitution env (parsed by `cloudbuild/env.py`),
not argv.
