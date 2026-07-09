"""Tests for cloudbuild/cleanup_negs.py — the sentinel gate + reap delegation."""

from pathlib import Path

from devstash_infra.cloudbuild.cleanup_negs import cleanup_negs
from devstash_infra.cloudbuild.env import BuildEnv
from tests.conftest import ExpectFn, RecordedCallsFn

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


def test_skips_entirely_when_not_idle(
    build_env: BuildEnv, tmp_path: Path, recorded_calls: RecordedCallsFn
) -> None:
    cleanup_negs(build_env, sentinel=tmp_path / "SUSPEND")  # sentinel absent
    assert recorded_calls() == []  # no subprocess touched


def test_reaps_when_idle(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    expect(_NEG_LIST, stdout="")  # no leaked NEGs
    expect(_FW_LIST, stdout="")  # no stray firewall rules
    cleanup_negs(build_env, sentinel=sentinel)
    assert _NEG_LIST in recorded_calls()  # delegated to reap_leaked_negs
