"""Tests for clients/tofu_local.py — local-file-backend argv-parity + state-exists probe."""

from collections.abc import Sequence
from pathlib import Path

import pytest

from devstash_infra.clients.tofu_local import LocalTofu
from devstash_infra.shared import proc
from devstash_infra.shared.proc import ProcError, Result

_TF_DIR = "infra/terraform/envs/local"


def _route_run(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Route proc.run (the READ path: init)."""
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], **_: object) -> Result:
        calls.append(list(argv))
        return Result(list(argv), "", "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def _route_long(monkeypatch: pytest.MonkeyPatch, *, ok: bool = True) -> list[list[str]]:
    """Route proc.long_running (the MUTATION path: apply/destroy)."""
    calls: list[list[str]] = []

    def _fake_long_running(argv: Sequence[str], **_: object) -> Result:
        calls.append(list(argv))
        return Result(list(argv), "", "", 0 if ok else 1)

    monkeypatch.setattr(proc, "long_running", _fake_long_running)
    return calls


def test_init_passes_absolute_state_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    state = tmp_path / ".tofu-state" / "local.tfstate"
    calls = _route_run(monkeypatch)
    LocalTofu(_TF_DIR, state).init()
    assert calls == [
        [
            "tofu",
            f"-chdir={_TF_DIR}",
            "init",
            "-input=false",
            f"-backend-config=path={state.resolve()}",
        ]
    ]


def test_apply_emits_var_and_interrupt_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route_long(monkeypatch)
    LocalTofu(_TF_DIR, Path("/s.tfstate")).apply(cluster_active=True)
    assert calls == [
        [
            "tofu",
            f"-chdir={_TF_DIR}",
            "apply",
            "-input=false",
            "-auto-approve",
            "-var",
            "cluster_active=true",
        ]
    ]


def test_apply_false_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route_long(monkeypatch)
    LocalTofu(_TF_DIR, Path("/s.tfstate")).apply(cluster_active=False)
    assert calls[0][-1] == "cluster_active=false"


def test_apply_raises_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _route_long(monkeypatch, ok=False)
    with pytest.raises(ProcError):
        LocalTofu(_TF_DIR, Path("/s.tfstate")).apply(cluster_active=True)


def test_destroy_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route_long(monkeypatch)
    LocalTofu(_TF_DIR, Path("/s.tfstate")).destroy()
    assert calls == [["tofu", f"-chdir={_TF_DIR}", "destroy", "-input=false", "-auto-approve"]]


def test_state_exists_reflects_file(tmp_path: Path) -> None:
    state = tmp_path / "local.tfstate"
    assert LocalTofu(_TF_DIR, state).state_exists is False
    state.write_text("{}", encoding="utf-8")
    assert LocalTofu(_TF_DIR, state).state_exists is True
