"""runtime.py — the CLI boundary: map the InfraError hierarchy to a clean exit. CLI zone (3.14).

The SINGLE place deep failures become an operator message + exit code (exceptions-to-boundary).
Every typer command body runs inside `guard()`, so domain code raises `InfraError` subtypes /
`ProcError` freely and never calls `sys.exit`/`os._exit` mid-stack. `Aborted` (a declined gate)
exits quietly; any other `InfraError` prints the message (+ hint) in red. Non-InfraError
exceptions are genuine bugs and propagate to typer's default traceback — we don't swallow them.
"""

import contextlib
from collections.abc import Generator

import typer

from devstash_infra.shared.errors import Aborted, InfraError


@contextlib.contextmanager
def guard() -> Generator[None]:
    """Run a command body; convert an `InfraError` into a clean `typer.Exit(exit_code)`."""
    try:
        yield
    except Aborted as exc:
        # A declined confirmation is expected — a quiet yellow note, not a red error.
        typer.secho(f"  ! {exc.message}", fg=typer.colors.YELLOW, err=True)
        raise typer.Exit(exc.exit_code) from exc
    except InfraError as exc:
        typer.secho(f"✗ {exc.message}", fg=typer.colors.RED, err=True)
        if exc.hint:
            typer.secho(f"  {exc.hint}", fg=typer.colors.YELLOW, err=True)
        raise typer.Exit(exc.exit_code) from exc
