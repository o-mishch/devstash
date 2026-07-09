"""Tests for cloudbuild/guard.py — the suspend DECISION ORDERING (the guard's safety content).

Covers each branch and its precedence: no-cluster / lock-held / older-build-defer / hard-uptime-cap
(unconditional) / too-fresh / provisioning-marker-defer / deploy-in-flight-defer / idle→suspend /
traffic→skip, plus the stale-marker-does-not-block case. The gcloud probes are argv-parity mocked;
the clock and the two urllib probes are injected typed stubs.
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from devstash_infra.cloudbuild.env import BuildEnv
from devstash_infra.cloudbuild.guard import guard
from tests.conftest import ExpectFn

_NOW = datetime(2026, 7, 8, 2, 0, 0, tzinfo=UTC)

_CLUSTER = [
    "gcloud",
    "container",
    "clusters",
    "list",
    "--region=us-central1",
    "--project=proj",
    "--format=value(createTime)",
    "--limit=1",
]
_LOCK = ["gcloud", "storage", "objects", "describe", "gs://tfstate/gke/dev/default.tflock"]
_SELF_DESCRIBE = [
    "gcloud",
    "builds",
    "describe",
    "build-1",
    "--region=us-central1",
    "--project=proj",
    "--format=value(createTime)",
]
_BUILDS_LIST = [
    "gcloud",
    "builds",
    "list",
    "--region=us-central1",
    "--project=proj",
    "--ongoing",
    "--filter=substitutions.TRIGGER_NAME=auto-suspend AND id!=build-1",
    "--format=value(id,createTime)",
]
_PROV = [
    "gcloud",
    "storage",
    "objects",
    "describe",
    "gs://tfstate/gke/dev/.provisioning",
    "--format=value(timeCreated)",
]
_TOKEN = ["gcloud", "auth", "print-access-token"]


def _ago(seconds: int) -> str:
    return (_NOW - timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clock() -> datetime:
    return _NOW


def _no_deploy(_slug: str) -> bool:
    return False


def _deploy_running(_slug: str) -> bool:
    return True


def _zero_count(*, project: str, start: str, end: str, window_s: str, token: str) -> int:
    return 0


def _busy_count(*, project: str, start: str, end: str, window_s: str, token: str) -> int:
    return 5


def _sentinel(tmp_path: Path) -> Path:
    return tmp_path / "SUSPEND"


def test_no_cluster_is_a_noop(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout="")  # already suspended
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_state_lock_held_is_a_noop(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=0)  # a human run.sh holds the lock
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_older_sibling_build_defers(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout=_ago(5400))  # this build's createTime
    expect(_BUILDS_LIST, stdout=f"b0\t{_ago(5500)}")  # an earlier sibling → defer
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_hard_uptime_cap_suspends_ignoring_traffic(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(8000))  # older than max_uptime 7200
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")  # older-build check fail-open (no defer)
    sentinel = _sentinel(tmp_path)
    # request_count is a would-be-busy stub — the cap must NOT consult it.
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_deploy_running,
        request_count=_busy_count,
    )
    assert sentinel.exists()


def test_too_fresh_is_a_noop(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(100))  # younger than idle_window 3600
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_fresh_provisioning_marker_defers(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_PROV, stdout=_ago(100))  # a bring-up started 100s ago
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_deploy_in_flight_defers(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_PROV, returncode=1)  # no marker
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_deploy_running,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_idle_suspends(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_PROV, returncode=1)
    expect(_TOKEN, stdout="tok")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert sentinel.exists()


def test_traffic_present_skips(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_PROV, returncode=1)
    expect(_TOKEN, stdout="tok")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_busy_count,
    )
    assert not sentinel.exists()


def test_stale_provisioning_marker_does_not_block_suspend(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_PROV, stdout=_ago(4000))  # older than idle_window → stale, not honored
    expect(_TOKEN, stdout="tok")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_clock,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert sentinel.exists()
