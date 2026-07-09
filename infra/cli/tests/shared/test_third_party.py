"""Tests for shared/third_party.py — locating gcloud's vendored lib/third_party dir."""

import sys
from pathlib import Path

import pytest

from devstash_infra.shared import third_party


def _fake_sdk(tmp_path: Path, *, with_third_party: bool = True) -> Path:
    """Build a fake google-cloud-sdk tree and return its bundled interpreter path."""
    sdk = tmp_path / "google-cloud-sdk"
    interp = sdk / "platform" / "bundledpythonunix" / "bin" / "python3"
    interp.parent.mkdir(parents=True)
    interp.write_text("")
    if with_third_party:
        (sdk / "lib" / "third_party").mkdir(parents=True)
    return interp


def test_locate_returns_none_off_image(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # A dev/CI venv interpreter is not under a google-cloud-sdk dir.
    venv_python = tmp_path / ".venv" / "bin" / "python3"
    venv_python.parent.mkdir(parents=True)
    monkeypatch.setattr(sys, "executable", str(venv_python))
    assert third_party.locate_third_party() is None


def test_locate_finds_third_party_on_image(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    interp = _fake_sdk(tmp_path)
    monkeypatch.setattr(sys, "executable", str(interp))
    found = third_party.locate_third_party()
    assert found == tmp_path / "google-cloud-sdk" / "lib" / "third_party"


def test_locate_none_when_third_party_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Under google-cloud-sdk but the vendored dir is missing (a stripped/odd image).
    interp = _fake_sdk(tmp_path, with_third_party=False)
    monkeypatch.setattr(sys, "executable", str(interp))
    assert third_party.locate_third_party() is None


def test_ensure_on_path_appends_once(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    interp = _fake_sdk(tmp_path)
    monkeypatch.setattr(sys, "executable", str(interp))
    entry = str(tmp_path / "google-cloud-sdk" / "lib" / "third_party")

    saved = list(sys.path)
    try:
        third_party.ensure_on_path()
        third_party.ensure_on_path()  # idempotent
        assert sys.path.count(entry) == 1
        assert sys.path[-1] == entry  # appended (loses to stdlib + installed packages)
    finally:
        sys.path[:] = saved


def test_ensure_on_path_noop_off_image(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    venv_python = tmp_path / ".venv" / "bin" / "python3"
    venv_python.parent.mkdir(parents=True)
    monkeypatch.setattr(sys, "executable", str(venv_python))

    saved = list(sys.path)
    try:
        third_party.ensure_on_path()
        assert sys.path == saved  # nothing added
    finally:
        sys.path[:] = saved
