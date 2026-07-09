"""Tests for paths.py — the repo-root anchor that makes the operator CLI cwd-independent."""

from devstash_infra.paths import REPO_ROOT, repo_path


def test_repo_root_is_the_checkout_root() -> None:
    # The marker the walk looks for must exist at the resolved root.
    assert (REPO_ROOT / "infra" / "terraform").is_dir()
    # …and the package really lives under it (sanity that we didn't overshoot).
    assert (REPO_ROOT / "infra" / "cli" / "src" / "devstash_infra" / "paths.py").is_file()


def test_repo_path_joins_against_root_not_cwd() -> None:
    p = repo_path("infra/versions.env")
    assert p.is_absolute()
    assert p == REPO_ROOT / "infra/versions.env"
