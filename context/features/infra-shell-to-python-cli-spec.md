# Port `infra/` shell layer → typed Python CLI

## Context

DevStash's operational infra layer is **6,832 lines of shell across 45 `.sh` files** (plus 4 stdlib `.py` helpers) driving OpenTofu, gcloud, and kubectl through the full GCP lifecycle (bootstrap → apply → deploy → suspend/resume → down), a kind-based local stack, 18 GitHub Actions CI steps, and a 6-step Cloud Build auto-suspend pipeline. Correctness lives in **14 hard-won incident fixes** encoded as subtle shell branches, guarded today by **14 bats suites (3,271 lines)**.

The shell layer is untyped, hard to test in isolation, and splits logic across bash + POSIX-sh + inline Python. This ports it to a **single typed Python CLI** (`infra/cli/`) — types + testability + real structured error handling — **without touching Terraform or K8s YAML**. Big-bang rewrite; the bats suites are the parity spec; every incident fix is ported verbatim with a rationale comment and a dedicated test.

**Why Python (not TypeScript):** Python is the DevOps-default automation language, and `cloud-sdk:slim` (the pinned Cloud Build builder) ships `python3` preinstalled — so the auto-suspend steps run ported Python with **zero runtime install**, preserving the image's "install NOTHING at runtime" + digest-pin invariant. The 4 existing Cloud Build `.py` helpers are already pure-stdlib Python on that image, so this makes the Cloud Build layer *monolingual*, not polyglot. Type safety comes from **mypy + pyright strict + pydantic v2**.

### Locked decisions
- **Stack:** typer (CLI) + pydantic v2 (JSON parse/validate) + mypy & pyright strict + pytest. **uv** for deps/venv (`pyproject.toml` + `uv.lock`, pinned + hashed). **structlog** for structured JSON logging (§Observability).
- **One Python floor, one codebase (Option A):** **3.14** everywhere — operator CLI (GH runners + laptops) and Cloud Build path alike, `requires-python = ">=3.14"`. The Cloud Build steps run on `cloud-sdk:slim` but invoke its **bundled Cloud SDK Python** (a complete, relocatable CPython — 3.14.5 at the current pin), located at runtime via `gcloud info --format='value(basic.python_location)'`, **not** the image's *system* `python3` (which is 3.13). One floor means one `mypy --strict` pass at 3.14 over the whole tree — no separate lower-floor mypy pass. Enforced structurally (§1) **and asserted at runtime** (§Runtime floor assertion). **Dev/CI runs a single pyenv-managed 3.14.6.** uv 0.11.28 was pip-installed into that pyenv 3.14.6 (PEP-668-clean; pyenv builds carry no `EXTERNALLY-MANAGED` marker).
- **Parity:** port all 14 bats suites to pytest; argv-parity harness; each of the 14 incident fixes → a `test_fix_NN_*` + rationale comment.
- **Doc override:** `context/current-feature.md` currently mandates TS/execa/zod/Vitest — **rewrite it to this Python stack**.

### DevOps compliance stance (full-compliance additions)
This plan is audited against modern DevOps best practice on every layer. Three areas the base port did not cover — **rollback/cutover reversibility**, **CI supply-chain posture**, and **observability** — are made first-class below (§Rollback, §Supply chain, §Observability), alongside explicit **idempotency** and **runtime floor-assertion** invariants. No layer is left implicit.

## The load-bearing decision: how Cloud Build gets Python without a runtime install

**Stdlib-only `shared/` + `cloudbuild/` subpackages — NO typer, NO pydantic, NO third-party anything in the Cloud Build code path.**

- **Option A — one floor, the bundled Cloud SDK interpreter.** The 6 `#!/bin/sh` steps already `git clone` the repo into `/workspace/repo`. After the port they locate the image's **bundled Cloud SDK Python** at runtime — `PYBIN="$(gcloud info --format='value(basic.python_location)')"` (3.14.5 at the current pin) — and run `PYTHONPATH=/workspace/repo/infra/cli/src "$PYBIN" -m devstash_infra.cloudbuild <step>`. This is the *bundled* interpreter, NOT the image's system `python3` (which is 3.13), so the whole codebase is one 3.14 floor. Because `shared/`+`cloudbuild/` import only stdlib, zero install is needed — the bundled interpreter is already in the image, so the digest-pin + no-install invariant (`auto-suspend.tf:229-243`) is untouched.
- **Why stdlib-only (sharper reason under one floor):** `shared/`+`cloudbuild/` are imported by BOTH the operator CLI (dev/CI interpreter = plain CPython + the package's declared deps) AND the Cloud Build path (the image's bundled interpreter + gcloud's own site-packages). The intersection of those two environments is exactly the stdlib, so stdlib-only is the only import surface guaranteed present in both. (The bundled interpreter *does* ship some real site-packages — cryptography/grpcio/typing_extensions — and gcloud vendors more under `lib/third_party` — requests/hcl2/kubernetes — but none of these are guaranteed on the dev interpreter, so the floor imports none of them.)
- **Rejected:** vendoring pydantic (compiled `pydantic_core` wheel is ABI/platform-specific to the image's bundled 3.14, bloats every shallow clone, adds an unpinned dep surface inside the "installs nothing" boundary); `uv pip install` at step time (violates no-install); custom builder image (dies on AR self-deletion — the suspend build deletes its own Artifact Registry repo).
- **Hard rule this imposes:** Cloud Build JSON parsing uses stdlib `json` + `dataclasses`/`TypedDict` in `shared/models_core.py`, never pydantic. Where a shape is needed in both paths, the **canonical parse lives in `shared/` as a dataclass**; the CLI's pydantic model is a thin wrapper constructed from the same dict — never the reverse. This preserves the single-source-of-truth property `posix/secrets.sh` and `posix/dump.sh` have today.

## Target layout (`infra/cli/`)

Standalone uv package, src layout, NOT wired into the Next.js build. `pyproject.toml`: `name="devstash-infra"`, `requires-python=">=3.14"`, console script `devstash-infra = "devstash_infra.cli:app"`.

```
src/devstash_infra/
  shared/            # 3.14 floor · stdlib-only · NO typer/pydantic/structlog
    log.py           # stdlib `logging` + JSON formatter + secret-redaction filter (§Observability)
    proc.py          # subprocess wrapper (§below) + SIGINT-forward primitive [fix #13]
    gcloud.py        # gcloud/gsutil argv builders + json.loads
    secrets.py       # <- posix/secrets.sh [fix #14]
    dump.py          # <- posix/dump.sh [fix #4]
    lock_contention.py  # <- posix/lock-contention.sh + auto-suspend-lock-id.py [fix #1]
    reap_negs.py     # <- posix/reap-negs.sh
    reconcile_ar_iam.py # <- posix/reconcile-ar-iam.sh
    models_core.py   # dataclasses/TypedDict (pydantic-free shared shapes)
  cloudbuild/        # 3.14 floor · imports shared/ only
    env.py           # parse _PROJECT_ID.._TRIGGER_NAME env vars -> frozen dataclass
    guard.py prepare.py dump_step.py suspend_step.py cleanup_builds.py cleanup_negs.py
    __main__.py      # `<bundled-python> -m devstash_infra.cloudbuild <step>` dispatch
  models/            # 3.14 · pydantic v2 · CLI-only (never imported by shared/ or cloudbuild/)
    tofu.py gcloud.py secrets_blob.py api.py
  common.py          # <- common.sh log/ok/warn/die/confirm, poll_until, require_kube_context [fix #10]
  tofu.py            # <- common.sh tofu_/tf_out/require_outputs + run.sh _plan_with_refresh_fallback [fix #2,#7]
  state_lock.py      # <- common.sh tflock_generation/force-unlock [fix #1] + IAM cooldown [fix #9]
  ar.py              # <- common.sh ds_ar_writable/ds_ar_wait (testIamPermissions) [fix #12]
  gcp/{bootstrap,db,dns,gke,reconcile,suspend}.py  # <- run/gcp/lib/*.sh [fix #3,#5,#6,#8,#11]
  ci/                # one module per ci/*.sh step
  app_gcp.py         # typer sub-app: 21 subcommands (<- run/gcp/run.sh dispatch)
  app_local.py       # typer sub-app: 5 subcommands (<- run/local/run.sh)
  signals.py         # SIGINT-forwarding install [fix #13], CLI-only
  obs.py             # structlog config: JSON renderer, contextvars correlation (run-id), redaction (§Observability), CLI-only
  cli.py             # top-level typer.Typer(); console_script entrypoint; installs obs + a runtime floor assert
tests/               # mirrors src/ one-to-one
```

**Command surface** (mounts three sub-apps):
- `devstash-infra gcp <cmd>` — 21: `up, bootstrap, apply, eso, reloader, secrets, verify-secrets, rotate-secret, upgrade-helm, deploy, smoke, status, logs, suspend, resume, dump-db, restore-db, update-dns, set-dns-creds, down, unlock`.
- `devstash-infra local <cmd>` — 5: `up, deploy, status, info, down`.
- `devstash-infra ci <step>` — the 18 deploy-gke steps + lifecycle-dispatch (one argv-parity surface, one `--help`).

**Floor enforced structurally, not by convention:** `shared/`+`cloudbuild/` import only stdlib + each other. There is ONE `mypy --strict` pass at 3.14 over the whole tree (no separate lower-floor pass); CI additionally greps `shared/`+`cloudbuild/` for `import typer|pydantic` (the stdlib-only guard), and the image-probe runs `"$(gcloud info --format='value(basic.python_location)')" -c "import devstash_infra.cloudbuild.guard"` under `cloud-sdk:slim` (the *bundled* interpreter, the same one the shims use). A version-drift guard (`scripts/check_floor_drift.py`) discovers that bundled python via `gcloud info` and asserts it is 3.14, pinned to the actual `cloud_sdk_image` digest. `models/`, `gcp/`, `ci/`, `app_*`, `signals.py` may use pydantic/typer freely.

`brew-bootstrap.sh` (macOS convenience, standalone, sourced by nothing) is **out of scope** — kept as shell.

## Library decision — reduce custom code with out-of-the-box libs where they fit (evaluated 2026-07-08)

User goal: fully replace all `.sh`, and use widely-adopted external libraries to cut custom wrapper code — but stay DevOps-compliant. Evaluated per concern against the two hard constraints (Windows-portable per CLAUDE.md; the **stdlib-only floor** — `shared/`+`cloudbuild/` install NOTHING at runtime, `auto-suspend.tf:240`):

- **Already out-of-the-box (CLI zone):** typer (dispatch), pydantic v2 (JSON parse/validate), structlog (logging), httpx (DNS/AR/monitoring HTTP). Kept.
- **tenacity — ADOPTED (CLI zone only).** Replaces the hand-rolled retry `while` loops (`state_lock` network-retry, AR `testIamPermissions` poll). A real custom-code reduction. Floor-banned (a third-party import): the Cloud Build `shared/dump.py` retry stays a tiny stdlib loop. Added to the import-grep floor guard alongside typer/pydantic/structlog.
- **All four runner libraries evaluated + spiked — REJECTED. `sh` BANNED (user).** `sh`/plumbum/invoke/command_runner: (1) none can cross the **stdlib-only floor** (all third-party; command_runner also pulls optional `psutil`) → each would force a SECOND exec path; (2) **none implements fix #13's forward-SIGINT-then-wait** — `sh` terminates the child, `command_runner` catches CTRL+C then `SIGTERM`/`SIGKILL`s it (no graceful window), `invoke` writes `\x03` to child stdin instead of sending SIGINT (spike crashed with `ValueError: I/O operation on closed file` on the interrupt path; a SIGINT-catching process like tofu never runs its shutdown). They implement the exact kill-the-child hazard fix #13 exists to prevent. `sh` also Unix-only (drops Windows). **invoke spike** did confirm its `Result`/`UnexpectedExit` map ~1:1 to proc's `Result`/`ProcError` (~30 lines saved) — but it takes a string command line not `list[str]` (loses argv-parity) and needs `_ForwardInterrupt` re-implemented on top anyway. Net across all four: reduce nothing that matters, worsen the most safety-critical function.
- **Conclusion:** `proc.py` stays the single stdlib exec path (floor-safe, Windows-portable, one mechanism). External libs are used for everything they genuinely improve (typer/pydantic/structlog/httpx/tenacity), never for subprocess execution.

### Orchestration stays in Python — no framework, no task-runner, no Terragrunt hooks (user, 2026-07-08)
Reviewed the whole design for reducibility (spiked go-task Taskfile dispatch + Terragrunt before/after hooks). Findings: the reusable pieces are ALREADY off-the-shelf (typer dispatch, tenacity retry/poll, httpx HTTP, pydantic JSON, structlog logs, data-file config) — this is NOT a custom orchestration framework. The ~80% that is genuinely custom is the **14 incident fixes + bespoke suspend/resume logic**, which is irreducible in ANY tool (it exists precisely because off-the-shelf tools don't handle these edge cases). **go-task** would replace only the ~3 dispatch files, at the cost of losing end-to-end type safety (YAML→shell-string→Python) + a per-task argparse shim → REJECTED, keep the typer CLI. **Terragrunt hooks** fit ~2 simple gates (dump-before-destroy #4) but CANNOT cross the zero-install floor (cloud-sdk:slim has no terragrunt → the auto-suspend path can't use it → laptop-vs-CloudBuild mechanism split), and don't fit the interleaved (#3) / conditional (#6) fixes → REJECTED, orchestration stays in Python. Decision (user): keep orchestration in Python.

### Improve, don't transliterate (user, 2026-07-08)
The port is NOT a line-for-line mirror of the shell. Where Python offers a cleaner, safer, or more idiomatic expression, use it — `fnmatch` for globs, `typer.confirm` for the y/N gate, `tenacity` for retry/poll, `pathlib`, dataclasses/pydantic, structlog, comprehensions, context managers, real exceptions at the CLI boundary (per coding-standards: plain `Error`, handle at the edge). **The one hard invariant:** the **14 incident fixes preserve their BEHAVIOR exactly** — the argv emitted, the branch taken, the safety gate — because those are the acceptance criteria and the map of past outages. So: idiomatic Python everywhere, but each `test_fix_NN_*` still asserts the same observable behavior the bats suite did. "No improvements" applies to the *incident-fix behavior*, never to the *code style*.

### Governing principle (user, 2026-07-08): use well-known libs wherever they fit (CLI zone)
Do NOT hand-roll what a widely-used library does well. In the 3.14 CLI zone:
- **All retry/poll → tenacity.** This includes `common.py:poll_until` (the bash poll-with-timeout used by many callers — wait-for-cluster, wait-secrets-sync, AR-writable): port it to a tenacity `Retrying(stop=stop_after_delay|stop_after_attempt, wait=wait_fixed, retry=retry_if_...)` helper, not a custom `while`. The `state_lock` network-retry and AR poll likewise.
- **All HTTP → httpx.** Spaceship DNS, AR `testIamPermissions`, Monitoring, GitHub — no hand-rolled `urllib` request/retry/JSON in the CLI zone.
- **All JSON-shape parsing → pydantic** `model_validate` — no manual dict-walking for `tofu output -json` / `gcloud --format=json`.
- **Floor exception:** `shared/`+`cloudbuild/` stay stdlib (json/urllib/logging + a tiny retry loop) — these libs are import-grep-banned there. Where a shape/poll is needed on both sides, the floor gets the stdlib version and the CLI gets the library version.
The only deliberately-custom code is `proc.py` (subprocess) — forced by the floor + the `sh` rejection, not chosen.

## Subprocess wrapper (`shared/proc.py`) — stdlib `subprocess` only

Replaces every `$(...)`, pipe, and `2>/dev/null || true`. No third-party runner — `sh` is banned (user), and any runner is disallowed in `shared/` anyway; `subprocess.Popen` + `signal` express exactly what fix #13 needs (the `sh` spike showed a runner would *add* code here, not remove it).

```python
@dataclass(frozen=True)
class Result: argv: list[str]; stdout: str; stderr: str; code: int
def run(argv, *, check=True, capture=True, env=None, cwd=None, input=None) -> Result
def run_json(argv, model=None) -> dict | <model>   # CLI passes a pydantic model; core passes None
def run_ok(argv) -> bool
```
- `check=True` raises `ProcError(Result)` carrying the full `Result`, so callers match on `stderr` signatures: network-error retry set, the `-refresh=false` vanished-resource 404 [fix #7], the AR-permission-empty case [fix #12] — the bash `grep` signatures become Python regex constants.
- **Interrupt-safe abort [fix #13]** — `long_running(argv)` for `tofu apply`/`destroy` only: launches via `Popen(start_new_session=True)`, installs a SIGINT/SIGTERM handler that **forwards** the signal to the child then `proc.wait()`s — NEVER kills, NEVER `os._exit`s mid-wait. First Ctrl-C prints the verbatim `run.sh:119` guidance + forwards one SIGINT (tofu does its graceful state-persist shutdown); a second Ctrl-C is the operator's explicit escalation. Installed/restored via context manager so it spans only the tofu op. The backgrounded overlap apply uses the same runner in its own group so its join surfaces status normally (mirrors the bash "trap does not fire for the backgrounded overlap apply" note). Primitive in `shared/proc.py`; signal install in CLI `signals.py`.
- **Tofu-lock-aware runner** (`state_lock.py`, wrapping `proc.long_running`): on the "Error acquiring the state lock" box, parses the printed `ID:` (the GCS object **generation**, not the JSON UUID [fix #1]) and drives read-tflock → generation → force-unlock.

## pydantic v2 models (`models/`, CLI-only)

All `ConfigDict(extra="ignore", frozen=True)`, parsed via `model_validate` from `run_json`. Each has a matching `shared/models_core.py` dataclass when the Cloud Build path needs the shape.
- **tofu.py** — `TofuOutputs` (`{name:{value,type,sensitive}}`; `require_outputs` asserts required keys present+non-empty; `-json`-not-`-raw`/terraform#26991 is the docstring [fix #2]); `TfLock` (read-only for display; a validator flags any attempt to use `ID` as the unlock arg [fix #1]).
- **gcloud.py** — `sql instances describe` (`activationPolicy` → `was_already_live` [fix #5]); secret `versions list` (`{name,state,createTime}` → newest-ENABLED [fix #14]); `builds list` (lock-contention self-exclusion); NEG list; PSC/forwarding-rule shapes [fix #8]; `container clusters` (kube-context glob [fix #10]).
- **secrets_blob.py** — `AppConfig` (`third_party_secrets` subset keyed by `_SECRET_KEYS`), `OpsConfig` (spaceship creds). Canonical splitter stays in `shared/` (Cloud Build `prepare.py` needs it); pydantic wraps it for CLI.
- **api.py** — `MonitoringTimeSeries` (idle-count; canonical parse is a `shared/` dataclass since it's shared), `GitHubWorkflowRun`/dispatch (lifecycle-dispatch, prune-registry), Spaceship DNS shapes.

## Testing (`infra/cli/tests/`, mirrors src/)

- **argv-parity harness** — `pytest-subprocess` `fake_process`: register each expected command, assert exact argv per call, return canned stdout/stderr/returncode (Python equivalent of the execa argv-diff). `conftest.py` helper `expect(argv, stdout=..., returncode=...)`. Dynamic (retry-then-succeed) cases use callbacks or `monkeypatch` on `proc.run`.
- **Fixtures** — reuse the 5 existing `__fixtures__/*.json` verbatim (copied/symlinked into `tests/fixtures/`, not reinvented); same for versions.env, tfstate-lifecycle.json, ar-iam-member-addresses.txt, .pgfence.json.
- **bats → pytest** (file-for-file): common/state-lock/reconcile/suspend-down/secrets-guard/wait-for-cluster/db/bringup-gate/dns/gke → their `tests/**` peers; posix/{reap-negs,dump,lock-contention} → `tests/shared/*`; ci/wait-secrets-sync → `tests/ci/*`. bats `stub`/`spy_cmd`/`fake_cmd` → `pytest-subprocess` registrations; `run <fn>`+`assert_*` → direct call + `capsys`/`pytest.raises(ProcError)`.
- **14 incident fixes = hard acceptance criteria** — each a `test_fix_NN_<slug>` with a docstring citing the original source path+rationale (grep-provable coverage): `01` force-unlock by generation not JSON ID · `02` output -json not -raw · `03` down zero -exclude (state-rm/destroy/re-import) · `04` dump-verify before destroy · `05` restore skips when live · `06` reconcile adopt-never-destroys (5 branches, AUTO_APPROVE) · `07` -refresh=false only on 404 · `08` PSC retry confirmed · `09` IAM cooldown 120s + marker · `10` require_kube_context glob · `11` overlap ordering + fail-fast join · `12` AR testIamPermissions under empty account · `13` SIGINT forward-then-wait · `14` newest ENABLED secret version.
- **Static gates** (CI, first-class): `uv run mypy --strict` (single 3.14 pass over the whole tree), `uv run pyright` (strict), the no-third-party-import grep guard over `shared/`+`cloudbuild/`, `ruff`.

## Port order (bottom-up)

1. Scaffold (`pyproject.toml`, `uv.lock`, `py.typed`, CI skeleton) + **`shared/proc.py`** + its tests (proc + interrupt-abort first — everything depends on it).
2. **`shared/` core** (3.14, stdlib-only): gcloud, secrets [#14], dump [#4], lock_contention [#1, folds lock-id.py], reap_negs, reconcile_ar_iam, models_core — port the posix bats suites here first.
3. **`common.py`/`tofu.py`/`state_lock.py`/`ar.py`** [#2,#7,#9,#10,#12] + `models/{tofu,gcloud}`.
4. **`gcp/{bootstrap,db[#5],dns,gke}`** + `models/{secrets_blob,api}`.
5. **`gcp/reconcile.py`** [#6] — 592-line 5-branch heart, with reconcile.bats in lockstep.
6. **`gcp/suspend.py`** [#3,#8,#11] — 670 lines, with suspend-down.bats in lockstep.
7. **`app_gcp.py`** — 21-subcommand dispatch.
8. **`ci/`** — 18 steps + lifecycle-dispatch, each with tests.
9. **`app_local.py`** — 5 kind subcommands [#10 local glob].
10. **`cloudbuild/`** last — 6 steps + `env.py` + `__main__.py` (imports `shared/` only) + image-probe smoke.

## Cutover (single commit, after the parity gate passes)

**Delete:** `infra/run/**`, `infra/lib/common.sh`, `infra/lib/posix/**`, `infra/run/gcp/lib/**`, `infra/ci/*.sh` (except `auto-suspend-image-check.sh` — validates Terraform, stays shell; and a reduced `shellcheck-infra.sh`), the 6 `infra/terraform/envs/dev/scripts/auto-suspend-*.sh` + 4 `.py` helpers, all `*.bats`, `run-bats.sh`, `test_helper.bash`, and the `bats-*` devDeps in the JS `package.json`.

**Keep** (Terraform references / data): versions.env, tfstate-lifecycle.json, ar-iam-member-addresses.txt, docker-bake.hcl, .pgfence.json, `brew-bootstrap.sh`. **Verify first:** `grep -rn 'file(\|templatefile(\|filebase64(' infra/terraform` to catch any Terraform ref to a to-be-deleted script beyond the 6 known.

**Repoint:**
- `auto-suspend.tf` step bodies (L578,587,599,611,623,636) → tiny `/bin/sh` shims: `set -eu; cd /workspace; [ -d repo ] || git clone …; PYBIN="$(gcloud info --format='value(basic.python_location)')"; PYTHONPATH=/workspace/repo/infra/cli/src "$PYBIN" -m devstash_infra.cloudbuild <step>` — the *bundled* Cloud SDK Python (3.14), not the image's system `python3` (3.13). Clone + env-var contract (L189-219) unchanged; guard/prepare still gate on `/workspace/SUSPEND`. **No PyPI dependency** — the Cloud Build path is stdlib-only, so this shim never touches an index (preserves the "installs nothing" invariant even for logging).
- `deploy-gke.yml` 18 steps → `devstash-infra ci <step>`, preceded by a pinned `astral-sh/setup-uv@<sha>` + `uv sync --frozen --require-hashes` setup step (3.14). See §Supply chain for the PyPI-reachability posture.
- `infra-lifecycle.yml` L94 → `devstash-infra ci lifecycle-dispatch`.
- `infra-checks.yml` — bats job → `uv run pytest`; add mypy+pyright strict + ruff + `uv audit`/`UV_MALWARE_CHECK=1` jobs; retain a reduced shellcheck for remaining shell.
- `migration-safety.yml` L46 → `devstash-infra ci check-migrations`.

## Observability (structured logging — DevOps compliance)

The shell layer logs via `echo`/`>&2` — unstructured, uncorrelatable. Best practice for an infra CLI (whose logs are the primary debugging surface during an outage): **structured JSON to stdout, one correlation id per invocation, secrets redacted before serialization** ([structured-logging best practice 2026](https://www.grepr.ai/blog/structured-logging-best-practices)).

- **Operator CLI (3.14):** `obs.py` configures **structlog** — JSON renderer, a `contextvars`-bound `run_id` (uuid minted per invocation, or Cloud Build `$BUILD_ID`/GH `$GITHUB_RUN_ID` when present) auto-injected into every event, and a **redaction processor** that strips known-sensitive keys/patterns (secret payloads, tokens, `--secret=` values) before output. structlog is pure-Python/zero-dep, but stays CLI-only to honor the Cloud Build import boundary.
- **Cloud Build path (3.14, stdlib-only):** `shared/log.py` uses stdlib `logging` + a small JSON formatter + the same redaction filter — **no structlog import** (would breach the no-third-party-import guard). Same JSON shape and `run_id` field so both layers emit one uniform, shippable log stream.
- **Log to stdout** (K8s/Cloud Build/Actions capture it); levels `info`/`warn`/`error`; every external call (gcloud/tofu/kubectl) and state change logs a structured event (`{event, argv_hash, resource, run_id}`) — argv is logged **hashed/redacted**, never raw (a `--secret=` could leak). A pytest test asserts the redaction filter scrubs a planted token.

## Supply chain (CI dependency posture — DevOps compliance)

The old shell CI fetched zero packages; the new operator-CLI CI pulls from PyPI, a new surface. Made compliant via uv's built-in defenses ([protect against Python supply-chain attacks with uv](https://pydevtools.com/handbook/how-to/how-to-protect-against-python-supply-chain-attacks-with-uv/)):

- **`uv.lock` committed with hashes**; CI installs with `uv sync --frozen` (lockfile is authoritative, no resolution drift) and hash verification on — a tampered/republished wheel fails the install.
- **`UV_MALWARE_CHECK=1`** on sync/audit (queries the OSV malicious-packages feed, aborts on a known-bad locked package) + a scheduled `uv audit` job.
- **`exclude-newer`** (cooldown) in `pyproject.toml` so CI is never the first to install a just-published version.
- **`astral-sh/setup-uv` pinned by commit SHA** (matches the repo's existing SHA-pinned-actions posture — verified: `actions/checkout`, `google-github-actions/auth` etc. are already SHA-pinned).
- **Deploy path does not depend on PyPI being reachable at deploy time:** the auto-suspend Cloud Build path is stdlib-only (no fetch, ever). For `deploy-gke.yml`, the `uv sync` runs on the GH runner *before* any gcloud/kubectl action, and a **cached/hash-locked** install means a PyPI outage fails fast at setup, never mid-deploy. Dependencies are minimal (typer, pydantic, structlog, pytest-subprocess[dev]) to keep the surface small.

## Rollback & cutover reversibility (DevOps compliance)

Big-bang is acceptable for a breaking migration behind a maintenance-style gate, but modern practice requires a **one-click rollback playbook + a dual-run fallback window** ([de-risking migrations with progressive delivery](https://www.harness.io/blog/beyond-the-big-bang-de-risking-cloud-migrations-with-progressive-delivery)). Added:

- **Tag the pre-cutover commit** (`infra-shell-final`) so the entire shell layer is restorable with one `git revert`/checkout — the rollback is a single, tested operation, not a scramble.
- **Dual-run window (one release):** the cutover commit deletes the shell **callers/wiring** but the revert restores them atomically; before landing it, the parity gate (§Verification) has already run the ported Python *and* the shell against dev. The Cloud Build shim is the highest-risk surface (unattended, fires only on idle) — so for the **first release the auto-suspend shims keep the old `.sh` step bodies available behind an env flag** (`_USE_LEGACY_SUSPEND=1` re-points the `script` to the shell path), removed in a follow-up once one real idle-suspend has fired green in production. This is the "flip a flag, no massive rollback" posture, scoped to the one surface that can't be observed synchronously.
- **Rollback triggers are explicit:** any parity-gate regression, a failed real suspend→resume, or a Cloud Build step erroring in the first live idle-suspend → revert to `infra-shell-final` (or flip `_USE_LEGACY_SUSPEND=1`), file the divergence, fix forward.
- **Data guardrail:** rollback of the *tooling* never touches state/data — Terraform state, the GCS DB dumps, and Secret Manager are untouched by this migration (tooling-only change), so a tooling rollback carries no data-divergence risk. Stated explicitly so a reviewer knows the blast radius is code, not infra.

## Idempotency & runtime floor assertion (DevOps invariants)

- **Idempotency is a tested invariant, not an assumption:** the shell commands are idempotent (reconcile adopt, `[ -d repo ] ||` clone, SSA applies). The port preserves this, and pytest asserts re-running a command emits no destructive argv on the second pass (e.g. reconcile adopt is a no-op when already tracked).
- **Runtime floor assertion (defense-in-depth):** `cli.py` and `cloudbuild/__main__.py` assert `sys.version_info` meets their floor at startup, and the Cloud Build entrypoint refuses to run if a non-stdlib module is importable in its namespace — so if CI's import-grep guard is ever bypassed, the failure is loud and immediate at the entrypoint, not a silent mid-suspend break.

## Docs / rules

- `.agents/rules/infra-shell.md` → rewrite as `infra-python.md` (pytest not bats, uv, the single 3.14 floor + the bundled-Cloud-SDK-Python mechanism, the stdlib-only Cloud Build invariant, argv-parity + 14-fix mapping, `proc.py`-only subprocess rule, structlog/redaction logging rule, uv supply-chain rule).
- `CLAUDE.md` — update infra refs (`run.sh`/bats → `devstash-infra`/pytest).
- `infra/docs/08-gcp-bootstrap.md` — rewrite command invocations.
- `context/current-feature.md` — rewrite to the Python stack.

## Verification (parity gate — all must pass before the cutover commit)

Port lives in `infra/cli/` alongside the shell while proving parity:
1. **argv-parity byte-clean** across all 14 ported suites (spot-check old bats spy output vs new fixtures for a sample of commands).
2. **Static green:** `uv run mypy --strict` (single 3.14 pass), `uv run pyright`, the no-third-party-import grep, and the image import-smoke under the bundled interpreter — `docker run cloud-sdk:slim sh -c '"$(gcloud info --format="value(basic.python_location)")" -c "import devstash_infra.cloudbuild.guard"'`.
3. **Read-only live on dev:** `devstash-infra gcp status | logs | verify-secrets` match the shell output.
4. **One real `suspend`→`resume` cycle on dev** — exercises #3,#4,#5,#8,#11,#13,#14 and the whole Cloud Build path end-to-end (guard/prepare/dump/suspend run ported Python from the clone).
5. **A no-op `apply`** confirming reconcile self-disables (AUTO_APPROVE adopt never destroys — #6) **and is idempotent** (second run emits no destructive argv).
6. `infra-checks.yml` runs pytest + mypy + pyright + ruff + reduced shellcheck + `uv audit`/`UV_MALWARE_CHECK` on every PR touching `infra/`.
7. **Observability check:** a structured `run_id` appears on every event; the redaction test proves a planted token/secret is scrubbed from logs and from logged argv.
8. **Rollback rehearsal:** confirm `git revert` of the cutover commit restores a working shell layer, and that `_USE_LEGACY_SUSPEND=1` re-points the auto-suspend shims to the shell path — both exercised once before landing.

## Critical files
- `infra/terraform/envs/dev/auto-suspend.tf` — step wiring (L578-636), env-var contract (L189-219), digest pin (L229-243): the Cloud Build repoint surface.
- `infra/lib/common.sh` — tofu_/tf_out/tflock_generation/ds_ar_writable/require_kube_context → common.py/tofu.py/state_lock.py/ar.py.
- `infra/run/gcp/lib/suspend.sh` — down/PSC/overlap/restore [#3,#8,#11] → gcp/suspend.py.
- `infra/run/gcp/lib/reconcile.sh` — 5-branch adopt-vs-destroy, AUTO_APPROVE [#6] → gcp/reconcile.py.
- `infra/lib/posix/secrets.sh` — the shared-dialect single-source pattern that dictates the stdlib-only `shared/` design → shared/secrets.py.

## Risks (ranked)
1. **Silently dropping an incident fix** (highest) — mitigated by the 14→`test_fix_NN_*` grep-provable mapping (each with a source-citing comment) + the real suspend→resume + no-op-apply live gates before cutover.
2. **reconcile + suspend are the bulk** (592+670 lines, 5 branches, PSC/overlap/down state-rm+reimport) — port each with its bats suite in lockstep (steps 5-6), never batched.
3. **Stdlib-only floor discipline** — a typer/pydantic (or any third-party) import leaking into `shared/`/`cloudbuild/` breaks Cloud Build silently until a suspend fires (the bundled interpreter can't resolve it); guarded by the import grep + image-probe import smoke (under the bundled interpreter) + the floor-drift guard (all CI-blocking) + the canonical-parse-in-`shared/` rule. One 3.14 floor removes the earlier two-floor version-skew hazard entirely.
4. **Cloud-Build-dependency regression** — resolved stdlib-only; residual risk is a later pydantic "improvement" to a Cloud Build step, guarded by the risk-3 gates + the runtime floor assertion.
5. **Unattended-surface blind spot** — the auto-suspend path fires only on idle, so a defect hides until a real suspend. Mitigated by the `_USE_LEGACY_SUSPEND=1` fallback for the first release (§Rollback) + the real suspend→resume gate before cutover.
6. **New PyPI supply-chain surface** — mitigated by `uv sync --frozen` + hashes + `UV_MALWARE_CHECK` + `exclude-newer` + SHA-pinned `setup-uv`; deploy path fails fast at setup, never mid-deploy; auto-suspend path fetches nothing (§Supply chain).
7. **Secret leakage via logs** — structured logging can widen the leak surface; mitigated by the redaction processor/filter in both log paths + the scrub test (§Observability).

## DevOps compliance matrix (attestation)

| Layer | Best-practice bar | Status |
|---|---|---|
| Language / tooling | Consolidate on stack; pinned reproducible deps | ✅ Python + uv `--frozen` + hashes |
| Type safety | Static typing enforced in CI | ✅ mypy **and** pyright strict, blocking |
| Testing | Characterization/parity, CI-gated | ✅ argv-parity, 14 bats→pytest, 14 fixes grep-provable |
| Image / supply chain | Digest-pinned, no runtime install, minimal surface | ✅ digest-pin + stdlib-only Cloud Build; rejects vendored wheel |
| CI supply chain | Hashes, malware scan, SHA-pinned actions, no deploy-time index dep | ✅ §Supply chain |
| Secrets | Out of argv/logs, least-privilege, newest-enabled | ✅ env-not-argv + redaction + fix #14 |
| Interrupt / state safety | No corruption on abort | ✅ fix #13 SIGINT-forward-then-wait |
| Idempotency | Re-runnable without harm | ✅ tested invariant |
| Observability | Structured, correlated, redacted | ✅ §Observability |
| Rollback / cutover | Reversible, gated, one-click | ✅ tag + revert + `_USE_LEGACY_SUSPEND` fallback |
| Docs / runbooks | Updated with the change | ✅ §Docs |

Every layer is addressed; the three previously-implicit areas (rollback, supply chain, observability) plus idempotency and runtime-floor assertion are now first-class.
