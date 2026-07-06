# Plan: Port the infra shell layer to a typed TypeScript CLI (keep Terraform + K8s YAML)

## Context

**Why this change.** The `infra/` shell layer is ~40 scripts / ~4,900 lines of bash + POSIX sh, plus 14 bats suites (~2,300 lines). It orchestrates OpenTofu, `gcloud`, `kubectl`, `helm`, and `gh`. It works, but it is hard to change safely: the logic is dense, the error handling is a minefield of `set -euo pipefail` footguns, and its correctness rests on hard-won incident fixes buried in comments. The user wants the ergonomics of a real language — static types, structured errors, `async`/`await`, and vitest instead of bats — for this orchestration layer.

**What this is NOT.** After research, we confirmed Pulumi's engine cannot drive `tofu`/`gcloud`/`kubectl`, and its Automation API is a Pulumi-to-Pulumi orchestrator. Since we are **keeping all Terraform and all Kubernetes YAML exactly as they are**, Pulumi's declarative engine has nothing to own. **Decision (user, this session): a plain TypeScript CLI using `execa`, no Pulumi dependency, big-bang full rewrite.** Framing is honest: this is "port bash to TypeScript," not "adopt Pulumi." The payoff is types + testability + real async, not a new IaC model.

**Sources:** Pulumi [Automation API](https://www.pulumi.com/docs/iac/concepts/automation-api/) · [best-practices](https://www.pulumi.com/blog/iac-best-practices-using-automation-api/) · [vs Terraform](https://www.pulumi.com/docs/iac/comparisons/terraform/) (CDKTF deprecated Dec 2025).

**Intended outcome.** `infra/` keeps `terraform/` and `k8s/` untouched. A new `infra/cli/` TypeScript package replaces every `.sh` under `infra/run/`, `infra/lib/`, and `infra/ci/`, driven by a single `devstash-infra <command>` entrypoint. All 14 bats suites become vitest suites. The auto-suspend Cloud Build `/bin/sh` steps (`terraform/envs/dev/scripts/*.sh`) are ported too, invoked as `node`/`tsx` steps inside Cloud Build.

---

## Ground truth this plan must respect

The scripts encode **specific incident fixes**. Porting must preserve each verbatim — these are the acceptance criteria, not nice-to-haves. The current bats suites already assert most of them; the vitest ports must assert the same.

- **force-unlock by GCS object *generation*, never the JSON `ID` UUID** (`common.sh:tflock_generation`). tofu rejects the UUID.
- **`tofu output -json`, never `-raw`** — `-raw` prints the `#26991` "No outputs found" box to *stdout* and exits 0, poisoning downstream `gcloud`/`gh` (`run.sh:tf_out`).
- **`down` uses ZERO `-exclude` flags** — OpenTofu 1.12.3 silently no-ops the whole plan with 2+ `-exclude`; instead `state rm` the two `prevent_destroy` secrets, destroy, then re-import (`suspend.sh:_shelve_protected_secrets`/`_restore_protected_secrets`).
- **dump-verify BEFORE any destroy** — export → verify non-empty → delete-empty → retry once; never destroy an un-dumped instance (`lib/posix/dump.sh`, `db.sh`).
- **restore skips when instance was already live** — never clobber newer data with an older dump (`db.sh:restore_db`, `was_already_live` snapshot in `suspend.sh`).
- **reconcile adopt-vs-destroy** — 5 branches of `import` / `state rm` / `-replace`, WIF soft-delete undelete+poll-for-ACTIVE, PSC-subnet replace; `AUTO_APPROVE` MUST always self-heal via adopt, never destroy unattended (`reconcile.sh`).
- **`-refresh=false` refresh-404 fallback** only on the vanished-resource signature, never blanket (`run.sh:_plan_with_refresh_fallback`).
- **PSC-detach retry** is operator-confirmed, never a silent auto-retry (`suspend.sh:_handle_psc_destroy_block`).
- **IAM propagation cooldown** (120s) and the **provisioning marker** span the whole apply (`run.sh`).
- **`require_kube_context` glob guard** before every kubectl-mutating step — never apply local manifests onto GKE.
- **kubeconfig-safe overlap ordering** in resume (`_apply_plan` foreground, `_apply_exec` background, `wait_for_cluster` foreground) + fail-fast join.
- **AR-writable `testIamPermissions` poll** (works under WIF where `gcloud config get-value account` is empty).
- **interrupt-safe abort** — let an in-flight `tofu apply` finish persisting state on SIGINT (in bash this relied on trap-deferral; TS must replicate via signal handling that does NOT kill the child mid-write).
- **newest ENABLED secret version**, never `access latest` (`lib/posix/secrets.sh`).

---

## Target architecture: `infra/cli/`

A single Node/TypeScript package. Runtime: Node ≥ 20 (native `--experimental-strip-types` or `tsx`), TypeScript strict. This is a standalone package (its own `package.json`), NOT wired into the Next.js app build — infra tooling stays isolated. Reuses the repo's existing vitest.

```
infra/cli/
  package.json            bin: devstash-infra -> dist/main.js (or tsx src/main.ts)
  tsconfig.json           strict; NodeNext modules
  src/
    main.ts               arg parse + command dispatch (replaces run.sh dispatch case)
    exec.ts               execa wrappers: tofu(), gcloud(), kubectl(), helm(), gh(), curl-equiv (fetch)
    log.ts                log/ok/warn/die, timed spans, stage() (ports common.sh presentation)
    preflight.ts          need()/CLI presence, require_kube_context, confirm() (prompts + AUTO_APPROVE)
    tofu/
      state.ts            tflock read/generation, force-unlock, state list/show/rm, import, tofu_locked retry
      plan.ts             plan-to-file, apply <planfile>, _plan_with_refresh_fallback, tf_out (json), require_outputs
    gcp/
      bootstrap.ts        project/billing/ADC/state-bucket/APIs (ports bootstrap.sh)
      reconcile.ts        the 5 reconcile branches + choose-gate (ports reconcile.sh — HARDEST)
      gke.ts              use_cluster, ESO/Reloader ensure, upgrade_helm, status, logs, join-fail-fast
      db.ts               dump/restore + verify gate (ports db.sh + posix/dump.sh)
      dns.ts              Spaceship REST via fetch, update_dns, ensure_cert_cname (ports dns.sh)
      suspend.ts          suspend/resume/down + teardown family (ports suspend.sh — HARDEST)
      secrets.ts          newest-enabled-version reads, rotate, verify (ports posix/secrets.sh + run.sh secret cmds)
      reap.ts             NEG/firewall reap, AR-IAM purge (ports posix/reap-negs.sh, posix/reconcile-ar-iam.sh)
    ci/                   one module per infra/ci/*.sh step (apply-infra, rollout-web, render-manifests,
                          run-migrations, build-push, ensure-eso/reloader, waits/gates, prune-registry, ...)
    local/
      up.ts               kind bring-up (ports run/local/run.sh)
  test/                   vitest suites mirroring each source module (replaces the .bats files)
```

**Cloud Build steps** (`terraform/envs/dev/scripts/*.sh`, POSIX `/bin/sh` in-container): port to small TS entrypoints run via a `node:20` build step. The 4 Python helpers (JSON/API parsing) can stay Python or fold into TS — recommend folding into TS so the whole layer is one language. Update `auto-suspend.tf`'s Cloud Build step definitions accordingly.

### Key library choices
- **`execa`** — streaming + captured output, exit codes, no shell-injection. Replaces every `$(...)` / pipe. Its `stdout`+`stderr` capture replaces the `_tofu_attempt` tee-and-capture pattern.
- **`zod`** — validate tfvars scalars and JSON payloads (`tflock`, `tofu output -json`, gcloud `--format=json`). Kills the ad-hoc `jq -r // fallback` guards; parse once, narrow types.
- **native `fetch`** — Spaceship DNS API + AR `testIamPermissions` (replaces `curl`).
- **`@inquirer/prompts`** (or minimal readline) — `confirm()` / `read_secret` (hidden input), honoring `AUTO_APPROVE`.
- **`vitest`** — already in the repo. Mock `execa` per-call to assert argv (replaces bats-mock/`spy_cmd`). Fixtures move from `__fixtures__/*.json` to imported JSON.

### Mapping patterns (bash idiom → TS)
| Bash idiom | TS replacement |
|---|---|
| `set -euo pipefail` + `\|\| true` guards | `try/catch`; explicit "tolerate this failure" is a caught error, not a `\|\| true` |
| `_tofu_attempt` tee+capture, `PIPESTATUS[0]` | `execa(..., {all:true})` → `{stdout, stderr, exitCode}` |
| `jq -r '.x // fb'` | `zod.parse(JSON.parse(...))` then property access |
| `tofu_locked` retry-once-on-lock | one async wrapper: run → if lock-error, `await recover()` → retry once |
| `poll_until N gap -- cmd` | `async function pollUntil(attempts, gapMs, pred)` |
| sourced sub-libs sharing globals | explicit `Ctx` object (TF_DIR, PROJECT_ID, REGION, ...) passed to each module — no globals |
| ERR trap file:line report | top-level `catch` in `main.ts` that prints command + code; execa errors already carry the command |
| INT/TERM trap defers to child | forward SIGINT to the execa child, `await` its exit before propagating — do NOT `process.exit` mid-apply |
| bash re-exec for `wait -n -p` | not needed — Node has `Promise.race`/`Promise.any` for fail-fast joins |

### What gets simpler (the real payoff)
- The `set -e` command-substitution footguns (documented in nearly every function) **disappear** — TS has no equivalent, so the split-declaration/`|| true` dance is gone.
- The `#26991` and jq-on-non-JSON guards collapse into `zod` parses.
- `_join_fail_fast` (bash 5.1 `wait -n -p` + the whole re-exec-under-newer-bash prologue) becomes `Promise.race`.
- Cross-file "shared global scope" becomes an explicit typed `Ctx` — no more "this function relies on state the parent established."

### What stays exactly as hard (no free lunch)
- reconcile.ts and suspend.ts are still intricate cloud-state surgery. TS makes them *readable and testable*, not *simple*. Port branch-for-branch; do not "improve" logic during the port.
- DNS stays custom API code either way (no TF provider) — a clean `fetch` port, but same logic.
- The `-exclude` workaround, force-unlock-by-generation, dump-verify gate, restore-skip-when-live: port verbatim, assert in tests.

---

## Cutover strategy (big-bang, but staged internally)

The user chose big-bang. To keep blast radius survivable given the incident-fix density, structure the single rewrite as: **build the whole TS layer + full vitest suite on a branch, prove parity, cut over in one commit that deletes the shell layer.**

1. **Scaffold** `infra/cli/` (package.json, tsconfig, exec/log/preflight core, `Ctx`).
2. **Port bottom-up**, leaf libs first (common/preflight → tofu/state+plan → secrets/dump/reap POSIX helpers → bootstrap/db/dns/gke → reconcile → suspend → run.sh dispatch → ci/* → local → Cloud Build steps). Each module lands with its vitest suite ported from the matching `.bats`.
3. **Parity gate before cutover:**
   - Every bats assertion has an equivalent vitest assertion (the incident-fix list above is the checklist).
   - Dry-run each command's `tofu`/`gcloud`/`kubectl` argv against the bash version (log the argv both produce for `plan`, `apply`, `import`, `state rm`, `force-unlock`, `destroy`) and diff — the CLIs invoked must be byte-identical.
   - Manual `status`/`logs`/`verify-secrets` (read-only) against the live dev env.
   - A real `suspend` → `resume` cycle on the dev env (the highest-risk path) — this is the true integration test; nothing else exercises dump/restore/DNS/overlap together.
4. **Cutover commit:** delete `infra/run/**`, `infra/lib/**` (except any files `terraform/` still references), `infra/ci/*.sh`, all `.bats`, and the bats tooling (`run-bats.sh`, `test_helper.bash`, bats-* devDeps). Repoint `.github/workflows/*.yml` steps and `auto-suspend.tf` Cloud Build steps to the TS entrypoints. Update `infra/ci/run-bats.sh` usage → `vitest`.
5. **Docs/rules:** rewrite `.agents/rules/infra-shell.md` → infra-TS testing (vitest, execa mocking); update `CLAUDE.md` infra references; update `infra/docs/08-gcp-bootstrap.md` command invocations.

---

## Critical files

**Read/port from (highest-risk first):**
- `infra/run/gcp/lib/reconcile.sh` (583) → `src/gcp/reconcile.ts`
- `infra/run/gcp/lib/suspend.sh` (664) → `src/gcp/suspend.ts`
- `infra/lib/common.sh` (536) → split across `src/log.ts`, `src/preflight.ts`, `src/tofu/state.ts`, `src/gcp/gke.ts`
- `infra/run/gcp/run.sh` (1561) → `src/main.ts` + `src/tofu/plan.ts` + core apply steps
- `infra/run/gcp/lib/{bootstrap,gke,db,dns}.sh` → `src/gcp/{bootstrap,gke,db,dns}.ts`
- `infra/lib/posix/{dump,lock-contention,reap-negs,reconcile-ar-iam,secrets}.sh` → `src/gcp/{db,tofu/state,reap,secrets}.ts`
- `infra/ci/*.sh` (≈30 files) → `src/ci/*.ts`
- `infra/run/local/run.sh` (336) → `src/local/up.ts`
- `infra/terraform/envs/dev/scripts/auto-suspend-*.{sh,py}` → TS Cloud Build entrypoints

**Untouched (explicitly out of scope):** everything under `infra/terraform/**` (except `auto-suspend.tf` step *definitions* and any `scripts/` re-pointing) and `infra/k8s/**`.

**Reuse, don't reinvent:** the existing `versions.env` (Helm chart pins) and `tfstate-lifecycle.json` / other standalone JSON config files stay as-is and are read by the TS CLI (honors the "no inline config in scripts" rule). The `ar-iam-member-addresses.txt` address list stays a data file, imported by `reap.ts`.

---

## Verification

- **Unit:** `vitest run` over `infra/cli/test/**` — must cover every incident-fix assertion currently in the 14 bats suites (use them as the spec). Mock `execa`; assert exact argv for `tofu import/state rm/force-unlock/destroy/plan`, `gcloud ... delete`, `kubectl apply`, `helm upgrade`.
- **Argv-parity harness:** a throwaway script that runs the old bash and new TS in a "print the command, don't execute" mode for each subcommand and diffs the emitted CLI invocations. Zero diff = behavioral parity on the tool boundary.
- **Read-only live checks:** `devstash-infra status`, `logs`, `verify-secrets` against dev.
- **Full integration (gate for cutover):** one real `suspend` then `resume` on the dev environment — exercises dump→verify→destroy, restore-skip-when-live, DNS re-point, the CI overlap, and state reconcile end to end. Then one `apply` (no-op) to confirm reconcile is a clean self-disabling no-op.
- **CI:** update `.github/workflows/infra-checks.yml` to run `vitest` instead of bats + shellcheck; confirm `deploy-gke.yml` and `auto-suspend.tf` steps invoke the TS entrypoints and pass a smoke deploy.

## Risks / call-outs
- **Biggest risk:** silently dropping an incident fix during the port. Mitigation: the incident-fix list above is a hard checklist; each item must map to a vitest assertion AND a code comment citing the original rationale (preserve the "why", it is the map of past outages).
- **Effort:** large. ~4,900 lines of dense bash + ~2,300 lines of bats → comparable TS + vitest. reconcile + suspend alone are the bulk of the risk.
- **No Pulumi:** if the user later wants Pulumi's engine to actually *own* resources, that is a *separate, larger* migration (replace Terraform) — explicitly not this plan.
- **Cloud Build language:** porting the `/bin/sh` auto-suspend steps to TS means the build image needs Node; confirm the `gcr.io/cloud-builders` / `node:20` step swap doesn't lose the git-clone + secret-fetch prelude.
