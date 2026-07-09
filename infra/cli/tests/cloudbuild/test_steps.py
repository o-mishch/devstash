"""Consolidated tests for steps in devstash_infra/cloudbuild/steps.py."""

import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from devstash_infra.cloudbuild.env import BuildEnv
from devstash_infra.cloudbuild.steps import (
    cleanup_builds,
    cleanup_negs,
    dump_step,
    guard,
    prepare,
    suspend_step,
)
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn
from tests.doubles import ManualClock

# ── helper globals for guard tests ───────────────────────────────────────────
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


_CLOCK = ManualClock(wall=_NOW)  # guard reads clock.now(); it never sleeps, so _NOW is fixed


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


# ── guard tests ──────────────────────────────────────────────────────────────
def test_no_cluster_is_a_noop(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout="")  # already suspended
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_state_lock_held_is_a_noop(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=0)  # lock file present
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_older_suspend_build_running_defers_to_it(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)  # lock free
    expect(_SELF_DESCRIBE, stdout=_ago(5400))
    expect(_BUILDS_LIST, stdout=f"build-older\t{_ago(5500)}")  # older build exists
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_hard_uptime_cap_suspends_unconditionally(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    # 7300s old (max_uptime_s is 7200)
    expect(_CLUSTER, stdout=_ago(8000))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    sentinel = _sentinel(tmp_path)
    # Even if traffic is busy and deploy is running, cap wins!
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_deploy_running,
        request_count=_busy_count,
    )
    assert sentinel.exists()


def test_too_fresh_skips_to_avoid_flapping(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(100))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_young_provisioning_marker_defers_suspend(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    # 100s old marker (grace is 3600s)
    expect(_PROV, stdout=_ago(100))
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_stale_provisioning_marker_is_ignored(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    # 4000s old marker (grace is 3600s) -> stale
    expect(_PROV, stdout=_ago(4000))
    expect(_TOKEN, stdout="tok")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert sentinel.exists()


def test_deploy_in_flight_defers_suspend(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    expect(_PROV, stdout="")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_deploy_running,
        request_count=_zero_count,
    )
    assert not sentinel.exists()


def test_traffic_present_skips_suspend(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    expect(_PROV, stdout="")
    expect(_TOKEN, stdout="tok")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_busy_count,
    )
    assert not sentinel.exists()


def test_idle_reaches_suspend(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_CLUSTER, stdout=_ago(5400))
    expect(_LOCK, returncode=1)
    expect(_SELF_DESCRIBE, stdout="")
    expect(_BUILDS_LIST, stdout="")
    expect(_PROV, stdout="")
    expect(_TOKEN, stdout="tok")
    sentinel = _sentinel(tmp_path)
    guard(
        build_env,
        sentinel=sentinel,
        clock=_CLOCK,
        deploy_running=_no_deploy,
        request_count=_zero_count,
    )
    assert sentinel.exists()


# ── prepare tests ────────────────────────────────────────────────────────────
_APP_VER = "projects/proj/secrets/devstash-app-config/versions/3"
_OPS_VER = "projects/proj/secrets/devstash-ops-config/versions/1"


def _versions_list(secret: str) -> list[str]:
    return [
        "gcloud",
        "secrets",
        "versions",
        "list",
        secret,
        "--project=proj",
        "--filter=state:ENABLED",
        "--sort-by=~createTime",
        "--limit=1",
        "--format=value(name)",
    ]


def _access(version: str, secret: str) -> list[str]:
    return [
        "gcloud",
        "secrets",
        "versions",
        "access",
        version,
        f"--secret={secret}",
        "--project=proj",
    ]


def _ops_describe() -> list[str]:
    return ["gcloud", "secrets", "describe", "devstash-ops-config", "--project=proj"]


def _idle(tmp_path: Path) -> Path:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    return sentinel


def test_prepare_skips_entirely_when_not_idle(build_env: BuildEnv, tmp_path: Path) -> None:
    prepare(build_env, tf_dir=tmp_path, sentinel=tmp_path / "SUSPEND")
    assert not (tmp_path / "zz-secrets.auto.tfvars.json").exists()


def test_writes_nonsecret_and_third_party_secrets_without_ops(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout=_APP_VER)
    expect(
        _access(_APP_VER, "devstash-app-config"),
        stdout='{"openai-api-key":"sk-1","database-url":"x"}',
    )
    expect(_ops_describe(), returncode=1)
    prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))

    assert (tmp_path / "zz-nonsecret.auto.tfvars.json").read_bytes() == base64.b64decode(
        build_env.nonsecret_b64
    )
    secrets = json.loads((tmp_path / "zz-secrets.auto.tfvars.json").read_text())
    assert secrets == {"third_party_secrets": {"openai-api-key": "sk-1"}}


def test_folds_spaceship_creds_when_ops_present(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout=_APP_VER)
    expect(_access(_APP_VER, "devstash-app-config"), stdout='{"openai-api-key":"sk-1"}')
    expect(_ops_describe(), returncode=0)
    expect(_versions_list("devstash-ops-config"), stdout=_OPS_VER)
    expect(
        _access(_OPS_VER, "devstash-ops-config"),
        stdout='{"spaceship-api-key":"k","spaceship-api-secret":"s"}',
    )
    prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))

    secrets = json.loads((tmp_path / "zz-secrets.auto.tfvars.json").read_text())
    assert secrets["spaceship_api_key"] == "k"
    assert secrets["spaceship_api_secret"] == "s"


def test_no_enabled_app_config_version_aborts(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout="")
    with pytest.raises(InfraError, match="no ENABLED version"):
        prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))


def test_non_object_app_config_payload_aborts_loudly(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout=_APP_VER)
    expect(_access(_APP_VER, "devstash-app-config"), stdout='"just-a-string"')
    with pytest.raises(InfraError, match="not a JSON object"):
        prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))


# ── dump_step tests ──────────────────────────────────────────────────────────
_DESCRIBE_DB = [
    "gcloud",
    "sql",
    "instances",
    "describe",
    "devstash-db",
    "--project=proj",
    "--format=value(state)",
]
_EXPORT_DB = [
    "gcloud",
    "sql",
    "export",
    "sql",
    "devstash-db",
    "gs://dumps/dump.sql",
    "--database=devstash",
    "--project=proj",
]
_SIZE_DB = [
    "gcloud",
    "storage",
    "objects",
    "describe",
    "gs://dumps/dump.sql",
    "--format=value(size)",
]


def test_dump_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    dump_step(build_env, sentinel=tmp_path / "SUSPEND")
    assert recorded_calls() == []


def test_absent_instance_skips_dump_and_continues(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_DESCRIBE_DB, stdout="")
    dump_step(build_env, sentinel=_idle(tmp_path))
    assert not any(call[:4] == ["gcloud", "sql", "export", "sql"] for call in recorded_calls())


def test_verified_dump_then_prunes(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_DESCRIBE_DB, stdout="RUNNABLE")
    expect(_EXPORT_DB)
    expect(_SIZE_DB, stdout="4096")
    expect(["gcloud", "storage", "ls", "-a", "gs://dumps/dump.sql**"], stdout="")
    dump_step(build_env, sentinel=_idle(tmp_path))
    assert _EXPORT_DB in recorded_calls()


def test_unverified_dump_aborts_before_any_destroy(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_DESCRIBE_DB, stdout="RUNNABLE")
    expect(_EXPORT_DB, occurrences=2)
    expect(_SIZE_DB, stdout="0", occurrences=2)
    expect(["gcloud", "storage", "rm", "gs://dumps/dump.sql", "--quiet"], occurrences=2)
    with pytest.raises(InfraError, match="non-empty dump"):
        dump_step(build_env, sentinel=_idle(tmp_path))


# ── suspend_step tests ────────────────────────────────────────────────────────
_INIT = ["tofu", "init", "-input=false", "-backend-config=bucket=tfstate"]
_AR_DESCRIBE = [
    "gcloud",
    "artifacts",
    "repositories",
    "describe",
    "devstash",
    "--location=us-central1",
    "--project=proj",
]
_APPLY = [
    "tofu",
    "apply",
    "-input=false",
    "-auto-approve",
    "-refresh=false",
    "-lock-timeout=900s",
    "-var",
    "environment_active=false",
    "-var",
    "db_active=false",
]
_LOCK_CAT = ["gcloud", "storage", "cat", "gs://tfstate/gke/dev/default.tflock", "--project=proj"]
_OTHERS = [
    "gcloud",
    "builds",
    "list",
    "--region=us-central1",
    "--project=proj",
    "--ongoing",
    "--filter=substitutions.TRIGGER_NAME=auto-suspend AND id!=build-1",
    "--format=value(id)",
]
_GEN = [
    "gcloud",
    "storage",
    "objects",
    "describe",
    "gs://tfstate/gke/dev/default.tflock",
    "--project=proj",
    "--format=value(generation)",
]
_FORCE = ["tofu", "force-unlock", "-force", "12345"]
_LOCK_MSG = "Error: Error acquiring the state lock\n"


def _unused_addr_file(tmp_path: Path) -> Path:
    return tmp_path / "addrs.txt"


def test_suspend_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    suspend_step(build_env, sentinel=tmp_path / "SUSPEND", tf_dir=tmp_path)
    assert recorded_calls() == []


def test_clean_apply_succeeds(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=0)
    expect(_APPLY)
    suspend_step(
        build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=_unused_addr_file(tmp_path)
    )
    assert _APPLY in recorded_calls()


def test_non_lock_failure_raises(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=0)
    expect(_APPLY, stdout="Error: quota exceeded\n", returncode=1)
    with pytest.raises(InfraError, match="non-lock reason"):
        suspend_step(
            build_env,
            sentinel=_idle(tmp_path),
            tf_dir=tmp_path,
            addr_file=_unused_addr_file(tmp_path),
        )


def test_orphaned_lock_force_unlocks_by_generation_then_retries(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=0)
    expect(_APPLY, stdout=_LOCK_MSG, returncode=1)
    expect(_LOCK_CAT, stdout='{"ID":"abc-uuid"}')
    expect(_OTHERS, stdout="")
    expect(_GEN, stdout="12345")
    expect(_FORCE)
    expect(_APPLY)
    suspend_step(
        build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=_unused_addr_file(tmp_path)
    )
    calls = recorded_calls()
    assert _FORCE in calls
    assert calls.count(_APPLY) == 2


def test_live_sibling_lock_is_a_benign_noop(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=0)
    expect(_APPLY, stdout=_LOCK_MSG, returncode=1)
    expect(_LOCK_CAT, stdout='{"ID":"abc-uuid"}')
    expect(_OTHERS, stdout="b9")
    suspend_step(
        build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=_unused_addr_file(tmp_path)
    )
    calls = recorded_calls()
    assert _FORCE not in calls
    assert calls.count(_APPLY) == 1


def test_failed_reconcile_state_rm_aborts(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    addr_file = tmp_path / "addrs.txt"
    addr_file.write_text("module.iam.stranded\n")
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=1)
    expect(["tofu", "state", "list", "module.iam.stranded"], stdout="module.iam.stranded")
    expect(["tofu", "state", "rm", "-lock-timeout=120s", "module.iam.stranded"], returncode=1)
    with pytest.raises(InfraError, match="stranded AR-IAM"):
        suspend_step(build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=addr_file)


# ── cleanup_builds tests ──────────────────────────────────────────────────────
_BUILD_LIST = [
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


def test_cleanup_builds_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    cleanup_builds(build_env, sentinel=tmp_path / "SUSPEND")
    assert recorded_calls() == []


def test_cancels_other_in_flight_builds_then_deletes_staging(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_BUILD_LIST, stdout="b2\nb3\n")
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
    assert cancel in calls
    assert _STAGING_RM in calls


def test_no_other_builds_skips_cancel_still_deletes_staging(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_BUILD_LIST, stdout="")
    expect(_STAGING_RM)
    cleanup_builds(build_env, sentinel=_idle(tmp_path))
    calls = recorded_calls()
    assert not any(call[:3] == ["gcloud", "builds", "cancel"] for call in calls)
    assert _STAGING_RM in calls


# ── cleanup_negs tests ────────────────────────────────────────────────────────
_NEG_LIST = [
    "gcloud",
    "compute",
    "network-endpoint-groups",
    "list",
    "--project=proj",
    "--filter=network:devstash-vpc",
    "--format=value(name,zone.basename())",
]
_FW_LIST = [
    "gcloud",
    "compute",
    "firewall-rules",
    "list",
    "--project=proj",
    "--filter=network:devstash-vpc AND name:(gke-* OR k8s-*)",
    "--format=value(name)",
]


def test_cleanup_negs_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    cleanup_negs(build_env, sentinel=tmp_path / "SUSPEND")
    assert recorded_calls() == []


def test_reaps_when_idle(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    expect(_NEG_LIST, stdout="")
    expect(_FW_LIST, stdout="")
    cleanup_negs(build_env, sentinel=sentinel)
    assert _NEG_LIST in recorded_calls()
