"""shared/proc.py — the subprocess wrapper every module runs commands through.

3.14 floor, stdlib-only (see shared/__init__.py). Replaces every shell `$(...)`,
pipe, and `2>/dev/null || true` with a typed `Result` + a `ProcError` that carries
the full captured output, so callers match on stderr SIGNATURES the way the bash
`grep` guards did (is_network_error, the -refresh=false 404, AR-permission-empty).

Ports:
- `run` / `run_ok`             <- common.sh command-capture idioms (`x=$(cmd)`, `cmd || true`)
- `long_running`               <- common.sh `_tofu_attempt` + run.sh:105-119 SIGINT trap [fix #13]
- NETWORK_ERROR_RE             <- common.sh:118 `is_network_error` (verbatim signature)
- LOCK_ERROR_RE                <- common.sh:104 `is_lock_error`
"""

import contextlib
import re
import signal
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import FrameType

from devstash_infra.shared.errors import InfraError


@dataclass(frozen=True)
class Result:
    """The outcome of one subprocess call — argv + captured streams + exit code."""

    argv: list[str]
    stdout: str
    stderr: str
    code: int

    @property
    def ok(self) -> bool:
        return self.code == 0

    @property
    def out(self) -> str:
        """Stdout with a single trailing newline stripped, matching `$(...)`."""
        return self.stdout.rstrip("\n")


class ProcError(InfraError):
    """A non-zero exit from `run(check=True)`. A member of the InfraError hierarchy.

    Carries the full `Result`, so callers inspect `.result.stderr` / `.result.stdout` to match
    failure signatures (network drop, vanished-resource 404, permission-empty) exactly as the
    shell did with `grep` on the captured output — never a blanket "any error". The CLI boundary
    catches it as an `InfraError` and reports the failed command + exit code.
    """

    def __init__(self, result: Result) -> None:
        self.result = result
        cmd = " ".join(result.argv)
        super().__init__(
            f"command failed (exit {result.code}): {cmd}\n{result.stderr}",
            exit_code=result.code or 1,
        )


# is_network_error [fix, common.sh:118] — a TRANSPORT drop between us and Google's
# APIs, NOT a provider/logic error. Retry is safe: the GCP ops are idempotent and
# state re-uploads on the next attempt. Matched by SIGNATURE only (never a bare
# "timeout") so a real slow-op failure ("Error waiting for ... timeout") does NOT
# match. Kept byte-identical to the shell `grep -qE` alternation.
NETWORK_ERROR_RE = re.compile(
    r"broken pipe"
    r"|http2: client connection lost"
    r"|connection reset by peer"
    r"|Client\.Timeout"
    r"|i/o timeout"
    r"|unexpected EOF"
    r"|TLS handshake timeout"
    r"|Failed to (save|upload) state"
)

# is_lock_error [common.sh:104] — the state-lock-acquire failure trigger string.
LOCK_ERROR_RE = re.compile(r"Error acquiring the state lock")


def is_network_error(text: str) -> bool:
    """True iff `text` carries a transient-network-drop signature (common.sh:118)."""
    return NETWORK_ERROR_RE.search(text) is not None


def is_lock_error(text: str) -> bool:
    """True iff `text` is a state-lock-acquire failure (common.sh:104)."""
    return LOCK_ERROR_RE.search(text) is not None


def run(
    argv: Sequence[str],
    *,
    check: bool = True,
    capture: bool = True,
    env: Mapping[str, str] | None = None,
    cwd: str | None = None,
    input: str | None = None,  # noqa: A002 — deliberate parity with subprocess.run(input=...)
) -> Result:
    """Run `argv` to completion and return a `Result`.

    `check=True` raises `ProcError(Result)` on a non-zero exit so callers can match
    on the captured streams (the bash `grep`-on-output guards become Python regex
    matches on `err.result.stderr`). `capture=False` streams straight to the
    terminal (for interactive/long human-facing output) and leaves stdout/stderr
    empty on the Result. `input` is passed on the child's stdin (replaces a shell
    `printf ... | cmd` pipe) — the one real inline pipe the port must preserve.
    """
    argv_list = list(argv)
    completed = subprocess.run(
        argv_list,
        capture_output=capture,
        text=True,
        env=dict(env) if env is not None else None,
        cwd=cwd,
        input=input,
        check=False,
    )
    result = Result(
        argv=argv_list,
        stdout=completed.stdout or "",
        stderr=completed.stderr or "",
        code=completed.returncode,
    )
    if check and not result.ok:
        raise ProcError(result)
    return result


def run_ok(argv: Sequence[str]) -> bool:
    """True iff `argv` exits 0. Replaces `cmd >/dev/null 2>&1 && ...` probes.

    Never raises on a non-zero exit — the tolerant-probe contract (the many
    `2>/dev/null || true` / `|| return 1` call sites). Only a failure to spawn the
    process at all (missing binary) propagates, matching `command -v`-gated callers.
    """
    return run(argv, check=False).ok


def run_out(argv: Sequence[str], *, default: str = "") -> str:
    """The stdout of `argv` (`$(...)` semantics), or `default` on a non-zero exit.

    The tolerant-string peer of `run_ok` — the `x=$(cmd 2>/dev/null || echo "")`
    idiom the read-only gcloud probes repeat (describe → value, absent → ""). Never
    raises on a non-zero exit; only a failure to spawn the process propagates.
    """
    result = run(argv, check=False)
    return result.out if result.ok else default


class _ForwardInterrupt:
    """Context manager: forward SIGINT/SIGTERM to a child, never exit mid-write.

    Ports the run.sh:105-119 interrupt-safe-abort trap [fix #13] to Python. When
    tofu is mid-apply, a terminal Ctrl-C reaches the whole foreground group, so the
    child tofu already gets SIGINT and does its OWN graceful shutdown (finish the
    in-flight op, persist state, exit). The danger is THIS process tearing down
    first and stranding a just-created resource with no state entry (an orphan only
    `import` can adopt). So on INT/TERM we FORWARD the signal to the child and keep
    waiting — we never raise KeyboardInterrupt out, never os._exit, never kill. The
    first Ctrl-C prints the verbatim run.sh guidance; a SECOND Ctrl-C is the
    operator's explicit escalation (tofu itself treats it as "cancel now"), which
    the OS delivers to the child directly — not ours to synthesize.
    """

    # The one-Ctrl-C guidance, kept verbatim from run.sh:119 (ANSI stripped; the
    # CLI-side obs/log layer owns coloring — shared/ stays presentation-free).
    _GUIDANCE = (
        "\n  ! Interrupt received — letting the in-flight OpenTofu op finish its "
        "graceful shutdown and persist state.\n"
        "    Press Ctrl-C AGAIN only if you must force-exit (this can strand a "
        "half-created resource — recover by re-running the same command).\n"
    )

    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self._proc = proc
        self._prev_int: signal.Handlers | None = None
        self._prev_term: signal.Handlers | None = None

    def _handle(self, signum: int, _frame: FrameType | None) -> None:
        sys.stderr.write(self._GUIDANCE)
        sys.stderr.flush()
        # Forward the SAME signal to the child so it runs its graceful shutdown;
        # then fall through and keep waiting (proc.wait resumes in __exit__/caller).
        with contextlib.suppress(ProcessLookupError):  # child already gone — nothing to forward
            self._proc.send_signal(signum)

    def __enter__(self) -> _ForwardInterrupt:
        # signal.signal returns the previous handler; restore it on exit so the
        # forwarding spans ONLY the tofu op (matches the bash trap install/scope).
        self._prev_int = signal.signal(signal.SIGINT, self._handle)  # type: ignore[assignment]
        self._prev_term = signal.signal(signal.SIGTERM, self._handle)  # type: ignore[assignment]
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._prev_int is not None:
            signal.signal(signal.SIGINT, self._prev_int)
        if self._prev_term is not None:
            signal.signal(signal.SIGTERM, self._prev_term)


def long_running(
    argv: Sequence[str],
    *,
    env: Mapping[str, str] | None = None,
    cwd: str | None = None,
) -> Result:
    """Run a long tofu op (apply/destroy) streaming live, interrupt-safe [fix #13].

    Ports `_tofu_attempt` (common.sh:198): the child's output streams straight to
    the terminal AND is captured so the caller can inspect it (lock/network
    signatures). Wrapped in `_ForwardInterrupt` so a Ctrl-C forwards to the child
    and we wait for it to persist state, never tearing down first. Returns a
    `Result` (never raises on non-zero — the caller drives lock/network recovery on
    the captured output, mirroring `tofu_locked`'s `|| rc=$?` then inspect).

    NOTE: unlike `run`, this does not `check` — the retry/recover loop
    (state_lock.py) owns the exit-code handling, exactly as `tofu_locked` does.
    """
    argv_list = list(argv)
    captured: list[str] = []
    # start_new_session=False: the child must stay in our foreground process group
    # so a terminal Ctrl-C reaches it directly (the bash trap relies on this — the
    # child gets its own SIGINT and shuts down gracefully). We ADDITIONALLY forward
    # via the handler to cover the non-tty / programmatic-signal case.
    # `with Popen(...)` so __exit__ closes the stdout pipe — otherwise the
    # TextIOWrapper leaks until GC (surfaces as a ResourceWarning under -W error).
    with (
        subprocess.Popen(
            argv_list,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge 2>&1 like `_tofu_attempt`'s `2>&1 | tee`
            text=True,
            env=dict(env) if env is not None else None,
            cwd=cwd,
        ) as proc,
        _ForwardInterrupt(proc),
    ):
        assert proc.stdout is not None  # noqa: S101 — type-narrowing only; PIPE (set above) guarantees it
        for line in proc.stdout:
            sys.stdout.write(line)  # live stream (the `tee` half)
            sys.stdout.flush()
            captured.append(line)  # capture half (for signature inspection)
        code = proc.wait()
    text = "".join(captured)
    return Result(argv=argv_list, stdout=text, stderr="", code=code)
