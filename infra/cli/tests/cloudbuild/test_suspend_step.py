"""Tests for cloudbuild/suspend_step.py — reconcile + apply + guarded lock recovery [fix #1]."""

from pathlib import Path

import pytest

from devstash_infra.cloudbuild.env import BuildEnv
from devstash_infra.cloudbuild.suspend_step import suspend_step
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn

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


def _idle(tmp_path: Path) -> Path:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    return sentinel


def _unused_addr_file(tmp_path: Path) -> Path:
    return tmp_path / "addrs.txt"  # never read when the AR repo is present


def test_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    suspend_step(build_env, sentinel=tmp_path / "SUSPEND", tf_dir=tmp_path)
    assert recorded_calls() == []


def test_clean_apply_succeeds(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=0)  # repo present → reconcile is a no-op
    expect(_APPLY)
    suspend_step(
        build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=_unused_addr_file(tmp_path)
    )
    assert _APPLY in recorded_calls()


def test_non_lock_failure_raises(build_env: BuildEnv, tmp_path: Path, expect: ExpectFn) -> None:
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=0)
    expect(
        _APPLY, stdout="Error: quota exceeded\n", returncode=1
    )  # a real error, not a lock stalemate
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
    expect(_APPLY, stdout=_LOCK_MSG, returncode=1)  # first apply: lock stalemate
    expect(_LOCK_CAT, stdout='{"ID":"abc-uuid"}')  # lock still present
    expect(_OTHERS, stdout="")  # no sibling build → orphaned
    expect(_GEN, stdout="12345")
    expect(_FORCE)  # force-unlock BY GENERATION [fix #1], never the UUID
    expect(_APPLY)  # retry succeeds
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
    expect(_OTHERS, stdout="b9")  # a live sibling holds the lock → do NOT break it
    suspend_step(
        build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=_unused_addr_file(tmp_path)
    )
    calls = recorded_calls()
    assert _FORCE not in calls  # never force-unlocked a live lock
    assert calls.count(_APPLY) == 1  # no retry


def test_failed_reconcile_state_rm_aborts(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    addr_file = tmp_path / "addrs.txt"
    addr_file.write_text("module.iam.stranded\n")
    expect(_INIT)
    expect(_AR_DESCRIBE, returncode=1)  # repo GONE → stranded signature, reconcile proceeds
    expect(["tofu", "state", "list", "module.iam.stranded"], stdout="module.iam.stranded")
    expect(
        ["tofu", "state", "rm", "-lock-timeout=120s", "module.iam.stranded"], returncode=1
    )  # rm fails
    with pytest.raises(InfraError, match="stranded AR-IAM"):
        suspend_step(build_env, sentinel=_idle(tmp_path), tf_dir=tmp_path, addr_file=addr_file)
