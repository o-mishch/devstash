"""Tests for shared/errors.py — the InfraError hierarchy + ProcError's membership in it."""

from devstash_infra.shared.errors import (
    Aborted,
    ClusterUnreachable,
    InfraError,
    PlanRejected,
)
from devstash_infra.shared.proc import ProcError, Result


def test_base_carries_message_hint_exit_code() -> None:
    err = InfraError("boom", hint="try that", exit_code=3)
    assert err.message == "boom"
    assert err.hint == "try that"
    assert err.exit_code == 3
    assert str(err) == "boom"


def test_defaults() -> None:
    err = InfraError("boom")
    assert err.hint == ""
    assert err.exit_code == 1


def test_subtypes_are_infra_errors() -> None:
    for exc in (Aborted("no"), PlanRejected("gone"), ClusterUnreachable("timed out")):
        assert isinstance(exc, InfraError)


def test_proc_error_is_an_infra_error_carrying_the_result() -> None:
    result = Result(["gcloud", "x"], "", "denied", 7)
    err = ProcError(result)
    assert isinstance(err, InfraError)
    assert err.result is result
    assert err.exit_code == 7  # exit code flows from the process
    assert "gcloud x" in err.message
