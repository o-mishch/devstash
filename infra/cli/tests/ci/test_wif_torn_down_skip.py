"""Tests for ci/wif_torn_down_skip.py — the green-with-warning WIF-gone skip."""

import pytest

from devstash_infra.ci.wif_torn_down_skip import wif_torn_down_skip


def test_emits_actionable_warning_and_returns_false(capsys: pytest.CaptureFixture[str]) -> None:
    assert wif_torn_down_skip() is False  # build=false
    out = capsys.readouterr().out
    assert out.startswith("::warning::")
    assert "devstash-infra gcp up" in out  # the actionable recovery hint
