---
trigger: glob
globs:
  - infra/cli/**/*.py
paths:
  - "infra/cli/**/*.py"
description: Mandatory code-quality gates for the infra/cli Python CLI (devstash-infra) — formatting, lint, typing, tests. Loads when editing any Python under infra/cli. Formatting is non-negotiable; run it before finishing.
---

# infra/cli Python — Mandatory Quality Gates

The `infra/cli/` package (`devstash-infra`) enforces a strict, tool-driven standard.
Every author — human or AI agent — must leave the tree passing **all** gates below.
These are hard requirements, not suggestions.

## Formatting is mandatory

`ruff format` is the single source of truth for layout. **Never** hand-format, and
**never** finish a change with unformatted code.

- Before completing ANY edit under `infra/cli/**/*.py`, run: `uv run ruff format`
- The gate `uv run ruff format --check` must pass — it runs in pre-commit and CI.
- Config lives in `[tool.ruff.format]` (`pyproject.toml`); do not override it inline.

## The full gate suite (all must be green before commit)

Run from `infra/cli/`:

```bash
uv run ruff format --check   # formatting (MANDATORY)
uv run ruff check            # lint — max-strict rule set, see [tool.ruff.lint]
uv run mypy                  # strict @ 3.14 (whole tree, one floor) + warn_unreachable + codes
uv run basedpyright          # second strict typechecker (pyright fork)
uv run pytest                # argv-parity tests — strict runner (see below)
uv audit --preview-features audit-command  # supply-chain
python3 scripts/check_floor_drift.py  # bundled-python floor-drift guard (needs docker; pulls the pin)
```

pre-commit runs the format + lint hooks automatically once `uv run pre-commit install`
has been run (see `.pre-commit-config.yaml`).

**The test runner is strict** (`[tool.pytest.ini_options]`): `filterwarnings = ["error"]`
(every warning is a failure — this caught a real subprocess-pipe leak), `--strict-markers`,
`--strict-config`, `xfail_strict`. Don't silence a warning with a blanket filter; fix its
cause, or add a **narrow, commented** `filterwarnings` entry for a specific third-party
warning you cannot fix.

**Type checking is doubled:** mypy (`strict` + `warn_unreachable` + `enable_error_code`:
ignore-without-code, truthy-bool, redundant-expr, possibly-undefined, unused-awaitable) AND
basedpyright (`strict`). mypy owns `# type: ignore[code]` (always with a code — enforced),
pyright owns `# pyright: ignore[rule]`. Stale ignores are caught by mypy `warn_unused_ignores`.

## Rules the linter enforces (max-strict — don't fight them)

The `[tool.ruff.lint]` `select` is a broad, curated set. Write to it from the start:

- **Security — `S` (bandit), `BLE` (no blind `except`), `PLE` (pylint errors):** no hardcoded
  secrets, no `shell=True`, no unsafe deserialization, no bare/blind exception catches.
  `proc.py` is the ONLY sanctioned subprocess site (per-file-ignored).
- **Idiomatic/modern — `UP`, `FURB`, `SIM`, `C4`, `RET`, `FLY`, `PIE`, `PERF`, `RSE`, `PTH`, `FA`:**
  use `pathlib.Path` (never `os.path`), f-strings, comprehensions, early returns. The tools flag
  transliterated-from-shell patterns — take the modern form.
- **Design/typing — `ARG`, `FBT` (keyword-only bools), `SLF` (respect private members),
  `TID` (absolute imports only), `N` (naming), `A` (no shadowing builtins):** encapsulation and
  clean signatures are enforced, not optional.
- **Logging — `LOG`, `G`:** guards the structlog / stdlib-logging redaction layer.
- **Exceptions — `TRY`:** pairs with the exceptions-to-boundary design (raise plain `InfraError`
  with an inline message at the edge). `TRY003`/`EM` are intentionally OFF — inline messages are
  our standard, not message-to-variable ceremony.
- **Hygiene — `T20` (no stray `print` — route console output through `common.log/ok/warn/die`),
  `ERA` (no commented-out code — write prose, not stub code), `DTZ`, `PGH` (no blanket
  `# noqa` / `# type: ignore`), Pylint `PLR`/`PLW`/`PLC`.**

**Suppression discipline (enforced by `PGH`):** suppress a finding ONLY with a **scoped,
commented** `# noqa: <CODE> — <reason>` or `# type: ignore[<code>] — <reason>`. Never a bare
`# noqa`/`# type: ignore`, never by deleting a rule from `select`. Prefer fixing over suppressing;
prefer per-file-ignores in `pyproject.toml` (with a comment) for whole-category test exemptions.

Also enforced: `[tool.mypy] warn_unreachable = true` — dead/unreachable code is an error.

## One floor (3.14); `shared/` stdlib-only, `cloudbuild/` stdlib + vendored set

The whole package targets **Python 3.14** — one floor, one mypy pass. The Cloud Build
auto-suspend path runs on `google/cloud-sdk:slim` but invokes its **bundled Cloud SDK
Python** (a complete, relocatable CPython — 3.14.5 at the current pin), located at
runtime via `gcloud info --format='value(basic.python_location)'`, NOT the image's
system `python3` (Debian trixie, 3.13). So there is no lower floor to target and no
separate floor-mypy pass; `scripts/check_floor_drift.py` still guards the *version*
side — it discovers the bundled python the same way the shims do and fails CI if the
pinned `cloud_sdk_image` (auto-suspend.tf) ever ships a bundled python other than 3.14.

**`shared/` stays strictly stdlib-only** (no typer, pydantic, structlog, tenacity, httpx).
It is imported by BOTH the operator CLI (dev/CI interpreter = plain CPython + this package's
declared deps) AND the Cloud Build path (image bundled interpreter + gcloud's libs). The
**intersection of those two environments is exactly the stdlib** — the CLI deps aren't on
the image, and the image's bundled packages aren't on the dev interpreter where pytest/mypy
exercise this code — so importing anything else in `shared/` breaks somewhere it runs or is
tested. `shared/third_party.py` is the ONE exception's enabler and is itself stdlib-only.

**`cloudbuild/` may ALSO import the vendored set** gcloud ships under `lib/third_party`:
`requests`, `python-hcl2`, `jsonschema`, `kubernetes` (pinned in pyproject's `vendored`
group). On the image `shared/third_party.ensure_on_path()` (called from `cloudbuild/__init__`)
appends that dir so they import with zero install; on dev/CI they come from the `vendored`
group at the SAME versions (no skew), so pytest/mypy see identical code. `scripts/check_floor_drift.py`
verifies each is importable at its pinned version in the image, so a re-pin that drops one
fails CI loudly. Do NOT add a lib to this set unless it (a) installs on dev 3.14 at gcloud's
exact vendored version (e.g. `ruamel.yaml` 0.15.93 does NOT — it won't build on 3.14) and (b)
has a real consumer. 3.14 syntax is fully permitted — the floor IS 3.14.

**HTTP client is one lib PER ZONE, deliberately two libs overall — do not "align" them.**
The `cloudbuild/` floor uses **`requests`** (`deploy_check.py`, `idle_count.py`) because it is
part of gcloud's vendored set, so the auto-suspend path installs nothing at runtime. The
operator-CLI `clients/` zone uses **`httpx`** (`ar.py`, `health.py`, `spaceship.py`) — the
modern peer of the CLI's pydantic/typer/structlog stack, tested at the transport layer via
`pytest-httpx`'s `MockTransport`. This split is forced by the zero-install image floor, not
drift: `httpx` is NOT in gcloud's vendored set (can't go on the floor), and `requests` is the
worse choice for the CLI (maintenance-only vs httpx/HTTPX2). Collapsing onto `requests`
everywhere was considered and rejected (2026-07-09) — it would rewrite three test suites and
regress the modern zone to a legacy lib to unify a surface that is only two lookalike `.get()`
probes. Keep `requests` confined to `cloudbuild/`, `httpx` confined to `clients/`.
