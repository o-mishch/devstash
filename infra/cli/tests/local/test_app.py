"""Smoke tests for local/app.py — the `devstash-infra local <cmd>` typer boundary.

Assert the WIRING only (the LocalStack has its own suite): every command builds the stack via
`build_stack()` and dispatches to the matching method. The fake stack records each call; preflight
is neutralised so no real CLI probe runs.
"""

import pytest
from typer.testing import CliRunner

from devstash_infra.cli import app
from devstash_infra.local import app as app_local

runner = CliRunner()


class _FakeStack:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    def up(self) -> None:
        self._events.append("up")

    def deploy(self) -> None:
        self._events.append("deploy")

    def status(self) -> None:
        self._events.append("status")

    def info(self) -> None:
        self._events.append("info")

    def down(self) -> None:
        self._events.append("down")


@pytest.fixture
def events(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    log: list[str] = []
    stack = _FakeStack(log)

    def _build_stack() -> _FakeStack:
        return stack

    def _preflight() -> None:
        pass

    monkeypatch.setattr(app_local, "build_stack", _build_stack)
    monkeypatch.setattr(app_local, "preflight", _preflight)
    return log


@pytest.mark.parametrize("verb", ["up", "deploy", "status", "info", "down"])
def test_command_dispatches(events: list[str], verb: str) -> None:
    result = runner.invoke(app, ["local", verb])
    assert result.exit_code == 0, result.output
    assert events == [verb]
