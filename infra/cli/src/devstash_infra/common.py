"""common.py — CLI-zone presentation + preflight + control-flow primitives.

Port of the generic, cloud-agnostic helpers in infra/lib/common.sh (log/ok/warn/die,
confirm, require_kube_context, poll_until). 3.14 CLI zone — idiomatic Python,
NOT a line-for-line shell mirror (per the "improve, don't transliterate" directive):
typer for coloured output + the y/N gate, fnmatch for the kube-context glob,
tenacity for the poll loop.

Structured logging (run-id, redaction, JSON) is a separate concern owned by obs.py;
these are the operator-facing console lines the shell emitted with raw ANSI.
"""

import fnmatch
import sys
import time
from collections.abc import Callable, Generator, Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from typing import NoReturn

import typer
from tenacity import Retrying, retry_if_result, stop_after_attempt, wait_fixed

from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock

# The single app Kubernetes namespace (the shell's one `DEVSTASH_NS` in lib/common.sh). Kept here
# so ci/gcp/local all read one source of truth rather than redefining the literal per module.
DEVSTASH_NS = "devstash"


# ── timed-span narration state (opt-in; used by the resume overlap driver) ────
# The shell kept _SPAN_T0/_SPAN_STAGE/_SPAN_TOTAL as process-global vars; here they live on ONE
# module-level object mutated in place — no `global` rebinding (keeps the linter's PLW0603 happy),
# and it is shared across the resume fail-fast join's worker threads exactly as the bash subshells
# inherited the origin at fork time (children timestamp against the same t0).
@dataclass
class _SpanState:
    active: bool = False
    t0: float = 0.0
    total: int = 0
    stage_no: int = 0


_SPAN = _SpanState()


def _ts_tag() -> str:
    """`HH:MM:SS +elapsed ` lead-in while a span is open, else `""` (ports _ts_tag, common.sh:33).

    Open span → every log/ok/warn/die line carries wall-clock + elapsed so the interleaved output
    of a long concurrent orchestration (resume) is readable. No span → empty string, so ordinary
    output is byte-for-byte unchanged.
    """
    if not _SPAN.active:
        return ""
    elapsed = fmt_dur(time.monotonic() - _SPAN.t0)
    return f"{time.strftime('%H:%M:%S', time.localtime())} +{elapsed} "


# ── Presentation (operator-facing console output) ────────────────────────────
# The shell's log/ok/warn/die, as typer.secho calls. die raises typer.Exit(1) so
# control returns to the CLI boundary cleanly instead of os._exit mid-stack.
def log(message: str) -> None:
    typer.secho(f"\n▶ {_ts_tag()}{message}", fg=typer.colors.CYAN, bold=True)


def ok(message: str) -> None:
    typer.secho(f"  ✓ {_ts_tag()}{message}", fg=typer.colors.GREEN)


def warn(message: str) -> None:
    typer.secho(f"  ! {_ts_tag()}{message}", fg=typer.colors.YELLOW)


def die(message: str) -> NoReturn:
    """Print an error and raise typer.Exit(1) — the fatal exit for the CLI.

    `NoReturn` so type checkers know control stops here (code after `die(...)` is
    unreachable), the Pythonic equivalent of the shell `die` that prints + `exit 1`.
    typer.Exit unwinds to the CLI boundary — no os._exit mid-stack.
    """
    typer.secho(f"✗ {_ts_tag()}{message}", fg=typer.colors.RED, err=True)
    raise typer.Exit(1)


def read_secret(prompt: str) -> str:
    """Read a credential without echoing it — hidden tty prompt, or a plain stdin line when piped.

    Ports read_secret (common.sh): `read -s` on a tty, a plain `read` when stdin is piped
    (CI / heredoc). Single-sources the never-echo input idiom shared by `set-dns-creds` and
    `rotate-secret`. typer.prompt(hide_input=True) owns the hidden tty read; a non-tty stdin
    (no terminal to hide) reads one plain line instead.
    """
    if sys.stdin.isatty():
        entered: str = typer.prompt(prompt, hide_input=True)
        return entered
    return sys.stdin.readline().rstrip("\n")


def confirm(prompt: str, *, auto_approve: bool = False) -> bool:
    """Interactive y/N gate; `auto_approve` skips the prompt (scripted/CI use).

    Ports `confirm` (common.sh:81). typer.confirm handles the y/N parsing +
    re-prompt-on-garbage that the shell hand-rolled. AUTO_APPROVE=1 → the caller
    passes auto_approve=True (the app resolves the env var once at startup).
    """
    if auto_approve:
        return True
    return typer.confirm(prompt, default=False)


# ── duration formatting (narration) ──────────────────────────────────────────
def fmt_dur(seconds: float) -> str:
    """Human duration: `12s` / `3m05s` / `1h02m` (fmt_dur, common.sh:45).

    Used by the fail-fast join's per-path narration. Takes a float (monotonic delta);
    the shell only ever had integer SECONDS, so truncate to match its output exactly.
    """
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m{s % 60:02d}s"
    return f"{s // 3600}h{(s % 3600) // 60:02d}m"


# ── timed-span + stage narration (opt-in; the resume overlap driver's) ────────
@contextmanager
def span(total: int) -> Generator[None]:
    """Open a timed narration span for `total` stages (ports begin_span/end_span, common.sh:60).

    Within the `with`, every log/ok/warn/die line gains the `HH:MM:SS +elapsed` lead-in and `stage`
    prints numbered `[stage N/total]` banners. A context manager (not the shell's begin/end pair) so
    the span always closes — even if a stage raises — and log/ok/warn go back to plain output. State
    is process-local: the resume fail-fast join's worker threads inherit the open span (they
    timestamp against the same origin), matching the bash subshell-inherits-at-fork behaviour.
    """
    _SPAN.active = True
    _SPAN.t0 = time.monotonic()
    _SPAN.total = total
    _SPAN.stage_no = 0
    try:
        yield
    finally:
        _SPAN.active = False


def stage(text: str) -> None:
    """Print a numbered `[stage N/total]` banner within an open span (ports stage, common.sh:68).

    Auto-increments the per-span counter and reads the total set by `span()`, so callers pass ONLY
    the text — never a hand-maintained index (drifts when a stage is inserted) nor a repeated total
    (drifts across call sites). Routed through log() so it inherits the _ts_tag lead-in. Outside a
    span it still prints, total shown as `?`.
    """
    _SPAN.stage_no += 1
    total: int | str = _SPAN.total if _SPAN.active else "?"
    log(f"[stage {_SPAN.stage_no}/{total}] {text}")


# ── presence check (secrets / GitHub Actions verification) ───────────────────
def count_missing(have: Iterable[str], *expected: str) -> int:
    """`ok` each expected name present in `have`, `warn "MISSING"` each absent; return miss count.

    Ports count_missing (common.sh:331). The shell returned the count via exit status so callers
    could gate with `count_missing … || missing=$?`; here it is a plain `int` return (no `set -e`
    dance). `have` is any iterable of names (secret list / app-config keys); membership is exact
    (whole-name), matching the shell's `grep -qxF`.
    """
    present = set(have)
    missing = 0
    for name in expected:
        if name in present:
            ok(name)
        else:
            warn(f"MISSING: {name}")
            missing += 1
    return missing


# ── kube-context guard [fix #10] ─────────────────────────────────────────────
def require_kube_context(current_context: str | None, expected_glob: str, hint: str) -> None:
    """Die unless `current_context` matches `expected_glob` [fix #10].

    Ports require_kube_context (common.sh:355). Guards the exact failure mode that
    motivated it: `gcloud container clusters get-credentials` switches kubectl's
    context to GKE and LEAVES IT THERE, so a later local `up` would silently apply
    the local-only base onto the real GKE dev cluster (kubectl has no cluster-type
    awareness and `apply` never asks). Call as the first line of every
    kubectl-mutating entry point — never rely on preflight alone.

    The context is passed in (the caller reads `kubectl config current-context`) so
    this stays a pure, testable predicate. Glob match via fnmatch, so a caller can
    match "gke_*_devstash-*-gke" without hardcoding the project id — same semantics
    as bash's `[[ $current == $expected ]]`.
    """
    if not current_context:
        die(f"no active kubectl context — {hint}")
    if not fnmatch.fnmatch(current_context, expected_glob):
        die(f"kubectl context is '{current_context}', expected to match '{expected_glob}' — {hint}")
    ok(f"kubectl context: {current_context}")


# ── poll-until (tenacity) ────────────────────────────────────────────────────
def poll_until(
    predicate: Callable[[], bool],
    *,
    attempts: int,
    gap_seconds: float,
    on_attempt: Callable[[int, int], None] | None = None,
    clock: Clock = SYSTEM_CLOCK,
) -> bool:
    """Run `predicate` until it returns True or `attempts` is reached.

    Ports poll_until (common.sh:300) — but the bash `-m msg_fn :: args ::` group
    machinery (a workaround for `set -u` array expansion) does NOT survive the port:
    in Python a caller closes over its own context, so `on_attempt(i, attempts)` is
    called after each failed attempt (the improved equivalent of the `-m` message
    hook). Returns True on success, False on timeout. Built on tenacity so the
    retry/stop/wait policy is declarative, not a hand-rolled `while`. The between-attempt
    wait goes through `clock.sleep` (the single time seam), so a virtual clock drives the
    poll with no real waits and `gap_seconds` stays a real policy value even in tests.
    """
    # retry while the predicate is still False; stop after `attempts` tries.
    retrying = Retrying(
        retry=retry_if_result(lambda succeeded: succeeded is False),
        stop=stop_after_attempt(attempts),
        wait=wait_fixed(gap_seconds),
        sleep=clock.sleep,
        reraise=False,
    )

    attempt_number = 0

    def _run() -> bool:
        nonlocal attempt_number
        attempt_number += 1
        # A RAISING predicate reads as "not ready" and keeps polling the full window — the shell
        # `until <cmd>` loop likewise treated a failing command as "keep waiting", not "give up".
        # Coercing here (rather than only catching around `retrying`) is what makes tenacity retry
        # a transient exception instead of aborting after the first attempt.
        try:
            result = predicate()
        except Exception:  # noqa: BLE001 — intentional: any predicate failure reads as "not ready"
            result = False
        if not result and on_attempt is not None and attempt_number < attempts:
            on_attempt(attempt_number, attempts)
        return result

    try:
        return retrying(_run)
    except Exception:  # noqa: BLE001 — RetryError (stop reached while still False) → timeout
        # Matches the shell's `return 1`; reraise=False keeps tenacity from surfacing flakiness.
        return False
