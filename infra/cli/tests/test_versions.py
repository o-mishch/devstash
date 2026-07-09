"""Tests for versions.py — parse + in-place rewrite of the versions.env data file."""

from pathlib import Path

from devstash_infra.versions import ESO_KEY, RELOADER_KEY, Versions, set_version

_SAMPLE = """\
# Pinned versions for Helm charts.
# HOW TO UPGRADE: …
ESO_VERSION=2.7.0
# Reloader chart-v2.x.y → chart version 2.x.y
RELOADER_VERSION=2.2.14
"""


def test_load_parses_both_pinned_versions(tmp_path: Path) -> None:
    path = tmp_path / "versions.env"
    path.write_text(_SAMPLE)
    versions = Versions.load(path)
    assert versions.eso == "2.7.0"
    assert versions.reloader == "2.2.14"


def test_load_ignores_comments_and_blanks(tmp_path: Path) -> None:
    path = tmp_path / "versions.env"
    path.write_text("\n  # ESO_VERSION=9.9.9 (a commented decoy)\nESO_VERSION=1.0.0\n\n")
    assert Versions.load(path).eso == "1.0.0"
    assert Versions.load(path).reloader == ""  # absent key → ""


def test_set_version_rewrites_one_key_preserving_the_rest(tmp_path: Path) -> None:
    path = tmp_path / "versions.env"
    path.write_text(_SAMPLE)
    set_version(path, ESO_KEY, "2.8.0")

    reloaded = Versions.load(path)
    assert reloaded.eso == "2.8.0"  # bumped
    assert reloaded.reloader == "2.2.14"  # untouched
    # Comments/ordering survive the in-place edit (the sed port must not clobber the file).
    body = path.read_text()
    assert "# Pinned versions for Helm charts." in body
    assert "# Reloader chart-v2.x.y → chart version 2.x.y" in body


def test_set_version_is_a_noop_for_an_absent_key(tmp_path: Path) -> None:
    path = tmp_path / "versions.env"
    path.write_text(_SAMPLE)
    set_version(path, RELOADER_KEY, "3.0.0")
    assert Versions.load(path).reloader == "3.0.0"
