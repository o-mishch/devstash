"""Smoke tests for app_gcp.py — the `devstash-infra gcp <cmd>` typer boundary.

These assert the WIRING only (each collaborator method has its own suite): that every command
resolves the context via `build_context()` and dispatches to the right collaborator method. The
fake context is a `_Recorder` whose every attribute access + call is logged, so a command like
`build_context().lifecycle.up()` records the string `ctx.lifecycle.up`. preflight/read_secret are
neutralised (no real CLI probe, no tty prompt) so the boundary runs headless.
"""

import pytest
from typer.testing import CliRunner

from devstash_infra import app_gcp
from devstash_infra.cli import app

runner = CliRunner()


class _Recorder:
    """Chainable call recorder: `rec.a.b(x)` appends "<name>.a.b" and returns a fresh recorder."""

    def __init__(self, name: str, events: list[str]) -> None:
        self._name = name
        self._events = events

    def __getattr__(self, attr: str) -> _Recorder:
        return _Recorder(f"{self._name}.{attr}", self._events)

    def __call__(self, *_args: object, **_kwargs: object) -> _Recorder:
        self._events.append(self._name)
        return _Recorder(f"{self._name}()", self._events)


@pytest.fixture
def events(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Neutralise preflight/read_secret + swap build_context for a recording context."""
    log: list[str] = []
    recorder = _Recorder("ctx", log)

    def _build_context(*, auto_approve: bool = False) -> _Recorder:
        return recorder

    def _preflight() -> None:
        pass

    def _read_secret(_prompt: str) -> str:
        return "secret-value"

    def _require_state_bucket(_gcloud: object, _bucket: str) -> None:
        pass

    monkeypatch.setattr(app_gcp, "build_context", _build_context)
    monkeypatch.setattr(app_gcp, "preflight", _preflight)
    monkeypatch.setattr(app_gcp, "read_secret", _read_secret)
    monkeypatch.setattr(app_gcp, "require_state_bucket", _require_state_bucket)
    return log


def _run(args: list[str]) -> None:
    result = runner.invoke(app, ["gcp", *args])
    assert result.exit_code == 0, result.output


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["up"], "ctx.lifecycle.up"),
        (["bootstrap"], "ctx.bootstrap.run"),
        (["apply"], "ctx.lifecycle.apply_with_overlap"),
        (["suspend"], "ctx.lifecycle.suspend"),
        (["resume"], "ctx.lifecycle.resume"),
        (["down"], "ctx.teardown.down"),
        (["eso"], "ctx.gke.eso"),
        (["reloader"], "ctx.gke.reloader"),
        (["upgrade-helm"], "ctx.gke.upgrade_helm"),
        (["secrets"], "ctx.secrets.push"),
        (["verify-secrets"], "ctx.gke.verify_secrets"),
        (["deploy"], "ctx.deploy.dispatch"),
        (["smoke"], "ctx.deploy.smoke"),
        (["status"], "ctx.gke.status"),
        (["logs"], "ctx.gke.logs"),
        (["dump-db"], "ctx.db.dump"),
        (["update-dns"], "ctx.dns.update"),
    ],
)
def test_command_dispatches_to_method(events: list[str], argv: list[str], expected: str) -> None:
    _run(argv)
    assert expected in events


def test_rotate_secret_reads_value_and_dispatches(events: list[str]) -> None:
    _run(["rotate-secret", "auth-secret"])
    assert "ctx.gke.rotate_secret" in events


def test_unlock_inits_backend_then_recovers(events: list[str]) -> None:
    _run(["unlock"])
    assert "ctx.tofu.init" in events  # backend initialised before force-unlock can address the lock
    assert "ctx.state_recovery.recover" in events


def test_restore_db_resolves_target_then_restores(events: list[str]) -> None:
    _run(["restore-db"])
    assert "ctx.db.resolve_dump_target" in events
    assert "ctx.db.restore" in events


def test_set_dns_creds_reads_both_and_dispatches(events: list[str]) -> None:
    _run(["set-dns-creds"])
    assert "ctx.dns.set_dns_creds" in events
