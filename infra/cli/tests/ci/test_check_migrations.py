"""Tests for ci/check_migrations.py — pgfence over recursively-discovered migration files."""

from pathlib import Path

import pytest

from devstash_infra.ci.check_migrations import check_migrations
from devstash_infra.shared.proc import ProcError
from tests.conftest import ExpectFn, RecordedCallsFn


def _make_migration(root: Path, name: str) -> str:
    path = root / name / "migration.sql"
    path.parent.mkdir(parents=True)
    path.write_text("ALTER TABLE x ADD COLUMN y int;")
    return str(path)


def test_analyzes_all_migrations_sorted(
    tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    # Created out of order to prove the argv is sorted; nested dirs prove the ** recursion.
    b = _make_migration(tmp_path, "20240102_b")
    a = _make_migration(tmp_path, "20240101_a")
    files = sorted([a, b])
    expect(["npx", "--no-install", "pgfence", "analyze", "--ci", *files])

    check_migrations(tmp_path)

    assert recorded_calls() == [["npx", "--no-install", "pgfence", "analyze", "--ci", *files]]


def test_risky_migration_raises(tmp_path: Path, expect: ExpectFn) -> None:
    file = _make_migration(tmp_path, "20240101_drop")
    expect(
        ["npx", "--no-install", "pgfence", "analyze", "--ci", file],
        returncode=1,
        stderr="high-risk: DROP COLUMN",
    )
    with pytest.raises(ProcError):
        check_migrations(tmp_path)
