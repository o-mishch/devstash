"""Tests for clients/yq.py — argv-parity + the strenv env merge."""

from collections.abc import Mapping, Sequence

import pytest

from devstash_infra.clients.yq import Yq
from devstash_infra.shared import proc
from devstash_infra.shared.proc import Result


def _route(
    monkeypatch: pytest.MonkeyPatch, *, out: str = ""
) -> tuple[list[list[str]], list[object]]:
    calls: list[list[str]] = []
    envs: list[object] = []

    def _fake_run(
        argv: Sequence[str], *, env: Mapping[str, str] | None = None, **_: object
    ) -> Result:
        calls.append(list(argv))
        envs.append(env)
        return Result(list(argv), out, "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls, envs


def test_eval_argv_and_returns_stdout(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, envs = _route(monkeypatch, out="kind: Job\n")
    assert Yq().eval(".a = 1", "job.yaml") == "kind: Job\n"
    assert calls == [["yq", ".a = 1", "job.yaml"]]
    assert envs == [None]  # no env_extra → inherit the process environment unchanged


def test_eval_merges_env_extra_over_os_environ(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/usr/bin")  # a real var yq needs to run
    calls, envs = _route(monkeypatch)
    Yq().eval(
        ".image = strenv(MIGRATE_IMAGE)", "job.yaml", env_extra={"MIGRATE_IMAGE": "reg/migrate@sha"}
    )
    assert calls == [["yq", ".image = strenv(MIGRATE_IMAGE)", "job.yaml"]]
    env = envs[0]
    assert isinstance(env, dict)
    assert env["MIGRATE_IMAGE"] == "reg/migrate@sha"  # the strenv value is injected…
    assert env["PATH"] == "/usr/bin"  # …over the inherited environment, not replacing it


def test_eval_in_place_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls, envs = _route(monkeypatch)
    Yq().eval_in_place(".a = 1", "settings.yaml", env_extra={"X": "y"})
    assert calls == [["yq", "-i", ".a = 1", "settings.yaml"]]  # -i for in-place mutation
    env = envs[0]
    assert isinstance(env, dict)
    assert env["X"] == "y"


def test_eval_stdin_argv_and_input(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []
    inputs: list[object] = []

    def _fake_run(
        argv: Sequence[str],
        *,
        input: object = None,
        **_: object,
    ) -> Result:
        calls.append(list(argv))
        inputs.append(input)
        return Result(list(argv), "kind: Service\n", "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    out = Yq().eval_stdin('select(.kind == "Service")', "kind: Service\nkind: Deployment\n")
    assert out == "kind: Service\n"
    assert calls == [["yq", 'select(.kind == "Service")', "-"]]
    assert inputs == ["kind: Service\nkind: Deployment\n"]  # rendered manifest piped on stdin
