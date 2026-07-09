"""Tests for clients/kind.py — argv-parity + the tolerant cluster-presence read."""

from collections.abc import Sequence

import pytest

from devstash_infra.clients.kind import Kind
from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result


def _route(monkeypatch: pytest.MonkeyPatch, *, ok: bool = True, out: str = "") -> list[list[str]]:
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        result = Result(args, out, "", 0 if ok else 1)
        if check and not result.ok:
            raise ProcError(result)
        return result

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def test_cluster_names_argv_and_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out="devstash\nkind\n")
    assert Kind().cluster_names() == ["devstash", "kind"]
    assert calls == [["kind", "get", "clusters"]]


def test_cluster_names_tolerant_when_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # kind/Docker down → [] (never raises)
    assert Kind().cluster_names() == []


def test_load_image_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Kind().load_image("devstash:local", cluster="devstash")
    assert calls == [["kind", "load", "docker-image", "devstash:local", "--name", "devstash"]]


def test_load_image_raises_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # a failed load must abort the deploy
    with pytest.raises(ProcError):
        Kind().load_image("devstash:local", cluster="devstash")
