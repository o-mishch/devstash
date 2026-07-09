"""Tests for clients/docker.py — the multi-arch child-digest read (parity + tolerance)."""

import json
from collections.abc import Sequence

import pytest

from devstash_infra.clients.docker import Docker
from devstash_infra.shared import proc
from devstash_infra.shared.proc import Result

_INDEX = json.dumps(
    {"manifests": [{"digest": "sha256:child-a"}, {"digest": "sha256:child-b"}, {"foo": "bar"}]}
)


def _route(monkeypatch: pytest.MonkeyPatch, *, ok: bool = True, out: str = "") -> list[list[str]]:
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        return Result(args, out, "", 0 if ok else 1)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def test_buildx_bake_argv_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []
    envs: list[object] = []

    def _fake_run(argv: Sequence[str], *, env: object = None, **_: object) -> Result:
        calls.append(list(argv))
        envs.append(env)
        return Result(list(argv), "", "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    monkeypatch.setenv("PATH", "/usr/bin")
    Docker().buildx_bake("bake.hcl", metadata_file="meta.json", env_extra={"IMAGE_URI": "reg/web"})
    assert calls == [
        ["docker", "buildx", "bake", "--file", "bake.hcl", "--metadata-file", "meta.json"]
    ]
    env = envs[0]
    assert isinstance(env, dict)
    assert env["IMAGE_URI"] == "reg/web"  # bake `variable` block reads it…
    assert env["PATH"] == "/usr/bin"  # …merged over the inherited environment


def test_child_digests_argv_and_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch, out=_INDEX)
    assert Docker().manifest_child_digests("BASE/web@sha256:idx") == [
        "sha256:child-a",
        "sha256:child-b",
    ]  # the {"foo": "bar"} entry (no digest) is skipped
    assert calls == [["docker", "manifest", "inspect", "BASE/web@sha256:idx"]]


def test_childless_single_arch_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, out=json.dumps({"schemaVersion": 2, "config": {}}))  # no `manifests` key
    assert Docker().manifest_child_digests("BASE/web@sha256:x") == []


def test_absent_ref_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, ok=False)  # `docker manifest inspect` failed → tolerant []
    assert Docker().manifest_child_digests("BASE/web@sha256:x") == []


def test_non_json_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, out="not json at all")
    assert Docker().manifest_child_digests("BASE/web@sha256:x") == []


def test_build_default_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Docker().build("devstash:local")
    assert calls == [["docker", "build", "-t", "devstash:local", "."]]


def test_build_with_target(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Docker().build("devstash-migrate:local", target="migrator")
    assert calls == [
        ["docker", "build", "-t", "devstash-migrate:local", "--target", "migrator", "."]
    ]
