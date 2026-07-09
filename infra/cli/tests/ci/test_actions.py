"""Tests for ci/actions.py — GitHub Actions step-output + annotation helpers."""

from pathlib import Path

import pytest

from devstash_infra.ci import actions


def test_set_output_appends_name_value(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out = tmp_path / "gh_output"
    out.write_text("")
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    actions.set_output("synced", "false")
    actions.set_output("synced", "true")  # a second output appends, never truncates
    assert out.read_text() == "synced=false\nsynced=true\n"


def test_set_output_is_a_noop_outside_actions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    actions.set_output("synced", "true")  # no env, no file — must not raise


def test_warning_emits_annotation_on_stdout(capsys: pytest.CaptureFixture[str]) -> None:
    actions.warning("parked state")
    assert capsys.readouterr().out == "::warning::parked state\n"
