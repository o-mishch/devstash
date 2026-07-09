"""Tests for clients/gh.py — argv parity, stdin-fed secrets, and tolerant JSON reads."""

import json
from collections.abc import Sequence

import pytest

from devstash_infra.clients.gh import Gh
from devstash_infra.shared import proc
from devstash_infra.shared.proc import Result


def _route_run(
    monkeypatch: pytest.MonkeyPatch, *, ok: bool = True, out: str = ""
) -> list[tuple[list[str], str | None]]:
    """Record every proc.run call as (argv, stdin) and return a canned Result."""
    calls: list[tuple[list[str], str | None]] = []

    def _fake_run(
        argv: Sequence[str], *, check: bool = True, input: str | None = None, **_: object
    ) -> Result:
        args = list(argv)
        calls.append((args, input))
        return Result(args, out, "", 0 if ok else 1)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def _route_run_ok(monkeypatch: pytest.MonkeyPatch, *, ok: bool = True) -> list[list[str]]:
    calls: list[list[str]] = []

    def _fake_run_ok(argv: Sequence[str]) -> bool:
        calls.append(list(argv))
        return ok

    monkeypatch.setattr(proc, "run_ok", _fake_run_ok)
    return calls


class TestWrites:
    def test_secret_set_feeds_value_on_stdin_not_argv(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _route_run(monkeypatch)
        Gh().secret_set("DEPLOYER_SA", "sa@proj.iam")
        argv, stdin = calls[0]
        assert argv == ["gh", "secret", "set", "DEPLOYER_SA"]
        assert stdin == "sa@proj.iam"  # value on stdin, never in argv
        assert "sa@proj.iam" not in argv

    def test_variable_set_uses_body_argv(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch)
        Gh().variable_set("GCP_PROJECT_ID", "my-proj")
        argv, _ = calls[0]
        assert argv == ["gh", "variable", "set", "GCP_PROJECT_ID", "--body", "my-proj"]

    def test_secret_delete_is_tolerant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run_ok(monkeypatch, ok=False)  # a not-found exit must not raise
        Gh().secret_delete("STALE")
        assert calls == [["gh", "secret", "delete", "STALE"]]

    def test_variable_delete_is_tolerant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run_ok(monkeypatch, ok=False)
        Gh().variable_delete("ARMOR_ENABLED")
        assert calls == [["gh", "variable", "delete", "ARMOR_ENABLED"]]


class TestReads:
    def test_authenticated_probe(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run_ok(monkeypatch, ok=True)
        assert Gh().authenticated() is True
        assert calls == [["gh", "auth", "status"]]

    def test_secret_names_parses_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(
            monkeypatch, out=json.dumps([{"name": "DEPLOYER_SA"}, {"name": "WIF"}, {"x": "y"}])
        )
        assert Gh().secret_names() == ["DEPLOYER_SA", "WIF"]  # the nameless row is skipped
        assert calls[0][0] == ["gh", "secret", "list", "--json", "name"]

    def test_secret_names_tolerant_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, ok=False, out="")
        assert Gh().secret_names() == []

    def test_variable_value_finds_by_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(
            monkeypatch,
            out=json.dumps([{"name": "APP_DOMAIN", "value": "app.example"}, {"name": "OTHER"}]),
        )
        assert Gh().variable_value("APP_DOMAIN") == "app.example"
        assert calls[0][0] == ["gh", "variable", "list", "--json", "name,value"]

    def test_variable_value_absent_returns_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, out=json.dumps([{"name": "OTHER", "value": "x"}]))
        assert Gh().variable_value("APP_DOMAIN") == ""

    def test_variable_value_tolerant_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, ok=False)
        assert Gh().variable_value("APP_DOMAIN") == ""

    def test_reads_tolerate_garbage_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, out="not json {")
        assert Gh().secret_names() == []
        assert Gh().variable_value("APP_DOMAIN") == ""


class TestRunDispatch:
    def test_latest_deploy_run_id_stringifies_database_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls = _route_run(monkeypatch, out=json.dumps([{"databaseId": 42}]))
        assert Gh().latest_deploy_run_id() == "42"  # int JSON → str at the boundary
        assert calls[0][0] == [
            "gh",
            "run",
            "list",
            "--workflow",
            "deploy-gke.yml",
            "--limit",
            "1",
            "--json",
            "databaseId",
        ]

    def test_latest_deploy_run_id_empty_when_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, out="[]")
        assert Gh().latest_deploy_run_id() == ""

    def test_latest_deploy_run_id_tolerant_on_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _route_run(monkeypatch, ok=False)
        assert Gh().latest_deploy_run_id() == ""

    def test_workflow_run_bare(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch)
        Gh().workflow_run()
        assert calls[0][0] == ["gh", "workflow", "run", "deploy-gke.yml"]

    def test_workflow_run_provision_adds_reason(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch)
        Gh().workflow_run(provision=True)
        assert calls[0][0] == [
            "gh",
            "workflow",
            "run",
            "deploy-gke.yml",
            "-f",
            "reason=provision",
        ]

    def test_run_watch_returns_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run_ok(monkeypatch, ok=True)
        assert Gh().run_watch("42") is True
        assert calls == [["gh", "run", "watch", "42", "--exit-status"]]

    def test_run_watch_returns_false_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run_ok(monkeypatch, ok=False)
        assert Gh().run_watch("42") is False

    def test_run_status_parses_field(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run(monkeypatch, out=json.dumps({"status": "in_progress"}))
        assert Gh().run_status("42") == "in_progress"
        assert calls[0][0] == ["gh", "run", "view", "42", "--json", "status"]

    def test_run_status_tolerant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_run(monkeypatch, ok=False)
        assert Gh().run_status("42") == ""

    def test_run_cancel_is_tolerant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route_run_ok(monkeypatch, ok=False)  # already-finished run must not raise
        Gh().run_cancel("42")
        assert calls == [["gh", "run", "cancel", "42"]]
