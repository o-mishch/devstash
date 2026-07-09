"""Tests for cloudbuild/__main__.py — step dispatch, the InfraError boundary, tofu-on-PATH."""

import pytest

from devstash_infra.cloudbuild.__main__ import main

_ENV = {
    "_PROJECT_ID": "proj",
    "_REGION": "us-central1",
    "_STATE_BUCKET": "tfstate",
    "_REPO_SLUG": "owner/repo",
    "_REPO_BRANCH": "main",
    "_SECRET_KEYS": "openai-api-key",
    "_NONSECRET_B64": "e30=",
    "_IDLE_WINDOW": "3600",
    "_MAX_UPTIME": "7200",
    "_DB_INSTANCE": "devstash-db",
    "_DB_DUMPS_BUCKET": "dumps",
    "_DB_DUMP_OBJECT": "dump.sql",
    "_DB_DUMP_KEEP": "2",
    "_VPC": "devstash-vpc",
    "_BUILD_ID": "build-1",
    "_TRIGGER_NAME": "auto-suspend",
}


def _set_full_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in _ENV.items():
        monkeypatch.setenv(key, value)


def test_no_args_returns_usage_code(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    assert main([]) == 2


def test_unknown_step_returns_usage_code(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    assert main(["frobnicate"]) == 2


def test_env_parse_error_maps_to_exit_code(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.delenv("_STATE_BUCKET")  # a missing substitution → InfraError at the boundary
    assert main(["guard"]) == 1


def test_valid_dispatch_of_a_non_idle_step_returns_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    # No /workspace/SUSPEND sentinel exists in the test env → cleanup-negs is a clean no-op.
    assert main(["cleanup-negs"]) == 0


def test_suspend_prepends_pinned_tofu_to_path(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.setenv("PATH", "/usr/bin")
    # suspend is a no-op without the sentinel, but the entrypoint still wires tofu onto PATH first.
    assert main(["suspend"]) == 0
    import os

    assert os.environ["PATH"].split(os.pathsep)[0] == "/workspace/bin"
