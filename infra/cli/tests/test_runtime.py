"""Tests for runtime.py — the CLI boundary that maps InfraError → typer.Exit.

The single place deep failures become an exit code + message. Asserts each hierarchy member is
caught, the exit code flows through, and a real bug (non-InfraError) propagates untouched.
"""

import pytest
import typer

from devstash_infra.runtime import guard
from devstash_infra.shared.errors import Aborted, InfraError
from devstash_infra.shared.proc import ProcError, Result


def test_infra_error_becomes_exit_with_its_code(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(typer.Exit) as caught:  # noqa: SIM117 — assert on the raised Exit
        with guard():
            raise InfraError("state bucket missing", hint="run bootstrap", exit_code=2)
    assert caught.value.exit_code == 2
    err = capsys.readouterr().err
    assert "state bucket missing" in err
    assert "run bootstrap" in err  # hint shown


def test_aborted_exits_quietly(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(typer.Exit) as caught:  # noqa: SIM117
        with guard():
            raise Aborted("aborted before apply")
    assert caught.value.exit_code == 1
    assert "aborted before apply" in capsys.readouterr().err


def test_proc_error_flows_through_as_infra_error() -> None:
    with pytest.raises(typer.Exit) as caught:  # noqa: SIM117
        with guard():
            raise ProcError(Result(["tofu", "apply"], "", "denied", 5))
    assert caught.value.exit_code == 5


def test_non_infra_error_propagates_as_a_bug() -> None:
    with pytest.raises(KeyError):  # noqa: SIM117 — a genuine bug must NOT be swallowed
        with guard():
            raise KeyError("missing")
