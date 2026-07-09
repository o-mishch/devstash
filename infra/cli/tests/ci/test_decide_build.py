"""Tests for ci/decide_build.py — the build/skip gate."""

import pytest

from devstash_infra.ci.decide_build import decide_build


def test_provision_always_builds_without_probing_cluster() -> None:
    # cluster_present=False is deliberately ignored — provision short-circuits FIRST.
    assert decide_build(dispatch_reason="provision", cluster_present=False) is True


def test_present_cluster_builds() -> None:
    assert decide_build(dispatch_reason="", cluster_present=True) is True


def test_parked_env_skips_with_warning(capsys: pytest.CaptureFixture[str]) -> None:
    assert decide_build(dispatch_reason="", cluster_present=False) is False
    assert "parked at ~$0" in capsys.readouterr().out
