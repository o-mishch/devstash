"""Tests for ci/env.py — the deploy-gke.yml per-step env contract helpers.

[TEST-1] These helpers are the CI boundary's input validation (the shell's `${VAR:?}` /
`${VAR:-…}`); the raise-on-missing and raise-on-bad-int edges are the kind a rename could
silently break, so they get direct coverage rather than only transitive exercise via dispatch.
"""

import pytest

from devstash_infra.ci import env
from devstash_infra.shared.errors import InfraError


def test_require_returns_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REGION", "us-central1")
    assert env.require("REGION") == "us-central1"


def test_require_raises_naming_the_var_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REGION", raising=False)
    with pytest.raises(InfraError, match="REGION"):
        env.require("REGION")


def test_require_treats_empty_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REGION", "")  # GH Actions sets an undefined repo var to empty
    with pytest.raises(InfraError, match="REGION"):
        env.require("REGION")


def test_optional_returns_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARMOR_ENABLED", raising=False)
    assert env.optional("ARMOR_ENABLED", "off") == "off"
    assert env.optional("ARMOR_ENABLED") == ""  # default default is empty


def test_optional_returns_value_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARMOR_ENABLED", "on")
    assert env.optional("ARMOR_ENABLED", "off") == "on"


def test_optional_int_returns_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TIMEOUT_S", raising=False)
    assert env.optional_int("TIMEOUT_S", 300) == 300


def test_optional_int_parses_a_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIMEOUT_S", "120")
    assert env.optional_int("TIMEOUT_S", 300) == 120


def test_optional_int_raises_naming_it_on_a_bad_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIMEOUT_S", "soon")
    with pytest.raises(InfraError, match=r"TIMEOUT_S.*integer"):
        env.optional_int("TIMEOUT_S", 300)
