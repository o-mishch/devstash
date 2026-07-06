---
trigger: glob
globs:
  - infra/**/*.sh
  - infra/**/*.bash
  - infra/**/*.bats
paths:
  - "infra/**/*.sh"
  - "infra/**/*.bash"
  - "infra/**/*.bats"
description: Infra shell-script testing conventions for DevStash — bats-core + bats-mock, the shared test_helper (spy_cmd/fixtures), and how to stub external commands. Loads when editing infra shell scripts or their bats tests.
---

# Infra Shell Testing

> How infra shell scripts (`infra/run/**`, `infra/ci/**`, `infra/lib/**`) are tested. App/TypeScript testing lives in `testing.md` (Vitest); this doc is shell-only. YAML rules live in `infra.md`.

We use **bats-core** with **bats-mock** + **bats-support** + **bats-assert** (npm devDependencies, loaded from `node_modules`). This replaced the earlier hand-rolled `*.test.sh` scripts — do not add new `*.test.sh` files.

- Test files: `infra/**/*.bats` (co-located next to the script under test, same basename — `dump.sh` → `dump.bats`).
- Run: `npm run test:infra` → `infra/ci/run-bats.sh`, which parallelises across files with `bats --jobs` when GNU `parallel` is on PATH (~3× faster) and falls back to a serial run otherwise. Override with `BATS_JOBS=<n>`; `BATS_JOBS=1` forces serial. `parallel` is not a bats dependency — `brew install parallel` locally for the speedup; `ubuntu-latest` ships it, so CI runs parallel. Runs in CI via `.github/workflows/infra-checks.yml`.
- **Parallel-safety is a hard requirement:** because the suite runs `--jobs`, tests must not depend on execution order or share mutable state across files. All per-test stubs live in `$BATS_TEST_TMPDIR` (unique per test, even across jobs — see `test_helper.bash`'s per-test bindir isolation); the only shared file, `node_modules/bats-mock/binstub`, is read-only (symlinked to, never written). A new test that writes outside `$BATS_TEST_TMPDIR` breaks this — keep all scratch state per-test.
- Shared setup: `infra/lib/test_helper.bash` (shared by the whole infra suite) — every `.bats` file starts with `setup() { load "${BATS_TEST_DIRNAME}/<rel>/test_helper"; … }`, the relative path reaching `infra/lib/` from that test's directory.

## What to test

Test the **logic-bearing shell functions** — the branches that are easy to break and costly to get wrong: retry/verify gates, safety guards (never force-unlock a live lock, never delete the live object, never destroy an un-dumped instance), tiebreaks, and list→delete loops. Source the script and drive its functions directly; assert outcomes (return code, captured output) and the collaborator calls (which resource, which args).

## Structure

- `setup()` loads `test_helper`, then `source`s the script under test (POSIX-`sh` libs source cleanly into bats' bash).
- One behaviour per `@test`; the title states the expected outcome (`"prune: keep=0 is refused → deletes nothing"`).
- Use `run <cmd>` + **bats-assert** (`assert_success`/`assert_failure`/`assert_output`/`assert_line`/`refute_line`) — never raw `[ "$status" -eq 0 ]`.
- Per-test scratch space is `$BATS_TEST_TMPDIR` (auto-cleaned). Never write to `/tmp` directly.

## Stubbing external commands — pick the right tool

Three mechanisms, chosen by what the test needs (all provided by `test_helper.bash`):

1. **`spy_cmd <name> [router]`** — the DEFAULT when the test asserts **dynamic args/values** of a call (which NEG+zone was deleted, which `#generation` was pruned, that `force-unlock` got the lock's own ID). It records every invocation's argv (and, opt-in via `spy_capture_stdin`, its stdin) so you assert with `assert_spy_called_with` / `refute_spy_called_with` / `spy_call_count` / `spy_stdin`. The optional `router` body serves per-subcommand output (a `case "$1 $2" in …`, mirroring how real `gcloud` dispatches). **Why not bats-mock here:** bats-mock's plan `: command` body cannot see a call's real argv, so it can't spy dynamic per-call args — `spy_cmd` exists for exactly that gap.
2. **bats-mock `stub`/`unstub`** — when a **static arg pattern + ordered call sequence** is the assertion. `stub name "pattern : command"` matches args as globs and `unstub` verifies the full ordered plan was consumed (exact count + order). Good for `"* force-unlock -force <ID> : true"`.
3. **`fake_cmd <name> [body]`** — a NON-verified no-op stub for a **conditional collaborator** the test does not assert (a command a branch may skip). Avoids bats-mock's `unstub` failing on an unconsumed plan line.

Prefer using the **real** helper when it is pure and committed (e.g. `auto-suspend-lock-id.py` is stdlib-only — invoke it, don't stub it) so the test exercises the real code path.

## Fixtures — no inline JSON in shell

Test data (lock JSON, tofu-output payloads) lives as **separate `.json` files under `__fixtures__/`** next to the `.bats` file, read via `fixture <name>` (path) / `fixture_contents <name>` (bytes). Never embed a JSON blob as an inline shell heredoc/string — same "no inline config in scripts" convention applied to tests: a real `.json` file is diffable, `jq`-validatable, and lintable in its own language. (An intentionally-malformed non-JSON probe like `"garbage-not-json"` may stay inline — it is not JSON to segregate.)

## Lint

`infra/ci/shellcheck-infra.sh` shellchecks `*.sh` + `*.bash` at error severity (the `test_helper.bash` included). `*.bats` files are **not** shellcheckable (the `@test "…" {` syntax is not valid shell) — bats' own parser plus a passing `npm run test:infra` validate them. The stub-generating `printf '…'` templates in `test_helper.bash` legitimately hold unexpanded `$…` (they emit shell source), so `# shellcheck disable=SC2016` at the top is expected.
