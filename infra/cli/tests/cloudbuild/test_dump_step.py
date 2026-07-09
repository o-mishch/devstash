"""Tests for cloudbuild/dump_step.py — dump-verify-before-destroy [fix #4] + absent-skip."""

from pathlib import Path

import pytest

from devstash_infra.cloudbuild.dump_step import dump_step
from devstash_infra.cloudbuild.env import BuildEnv
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn

_DESCRIBE = [
    "gcloud",
    "sql",
    "instances",
    "describe",
    "devstash-db",
    "--project=proj",
    "--format=value(state)",
]
_EXPORT = [
    "gcloud",
    "sql",
    "export",
    "sql",
    "devstash-db",
    "gs://dumps/dump.sql",
    "--database=devstash",
    "--project=proj",
]
_SIZE = ["gcloud", "storage", "objects", "describe", "gs://dumps/dump.sql", "--format=value(size)"]


def _idle(tmp_path: Path) -> Path:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    return sentinel


def test_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    dump_step(build_env, sentinel=tmp_path / "SUSPEND")
    assert recorded_calls() == []


def test_absent_instance_skips_dump_and_continues(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_DESCRIBE, stdout="")  # instance already destroyed by a prior suspend
    dump_step(build_env, sentinel=_idle(tmp_path))
    # No export attempted — nothing to dump, teardown continues.
    assert not any(call[:4] == ["gcloud", "sql", "export", "sql"] for call in recorded_calls())


def test_verified_dump_then_prunes(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_DESCRIBE, stdout="RUNNABLE")
    expect(_EXPORT)
    expect(_SIZE, stdout="4096")  # non-empty → verified
    expect(
        ["gcloud", "storage", "ls", "-a", "gs://dumps/dump.sql**"], stdout=""
    )  # prune: nothing stale
    dump_step(build_env, sentinel=_idle(tmp_path))
    assert _EXPORT in recorded_calls()


def test_unverified_dump_aborts_before_any_destroy(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_DESCRIBE, stdout="RUNNABLE")
    # export + size probe both attempts; object stays empty → never verified.
    expect(_EXPORT, occurrences=2)
    expect(_SIZE, stdout="0", occurrences=2)
    expect(["gcloud", "storage", "rm", "gs://dumps/dump.sql", "--quiet"], occurrences=2)
    with pytest.raises(InfraError, match="non-empty dump"):
        dump_step(build_env, sentinel=_idle(tmp_path))
