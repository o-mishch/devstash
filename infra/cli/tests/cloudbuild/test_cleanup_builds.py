"""Tests for cloudbuild/cleanup_builds.py — cancel-others + staging-bucket reclaim."""

from pathlib import Path

from devstash_infra.cloudbuild.cleanup_builds import cleanup_builds
from devstash_infra.cloudbuild.env import BuildEnv
from tests.conftest import ExpectFn, RecordedCallsFn

_LIST = [
    "gcloud",
    "builds",
    "list",
    "--region=us-central1",
    "--project=proj",
    "--ongoing",
    "--filter=id!=build-1",
    "--format=value(id)",
]
_STAGING_RM = ["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet", "--project=proj"]


def _idle(tmp_path: Path) -> Path:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    return sentinel


def test_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    cleanup_builds(build_env, sentinel=tmp_path / "SUSPEND")
    assert recorded_calls() == []


def test_cancels_other_in_flight_builds_then_deletes_staging(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_LIST, stdout="b2\nb3\n")
    cancel = [
        "gcloud",
        "builds",
        "cancel",
        "b2",
        "b3",
        "--region=us-central1",
        "--project=proj",
        "--quiet",
    ]
    expect(cancel)
    expect(_STAGING_RM)
    cleanup_builds(build_env, sentinel=_idle(tmp_path))
    calls = recorded_calls()
    assert cancel in calls  # both other builds cancelled in ONE batch call (never this build)
    assert _STAGING_RM in calls


def test_no_other_builds_skips_cancel_still_deletes_staging(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_LIST, stdout="")  # nothing ongoing
    expect(_STAGING_RM)
    cleanup_builds(build_env, sentinel=_idle(tmp_path))
    calls = recorded_calls()
    assert not any(call[:3] == ["gcloud", "builds", "cancel"] for call in calls)
    assert _STAGING_RM in calls
