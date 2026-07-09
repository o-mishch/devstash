"""Tests for shared/reap_negs.py — parity port of reap-negs.bats.

The VPC-scoped reap must delete each leaked zonal NEG with its correct zone and each
stray gke-*/k8s-* firewall rule — so we assert the DYNAMIC per-delete args.
"""

from devstash_infra.shared import reap_negs
from tests.conftest import ExpectFn, RecordedCallsFn

_NEG_LIST = [
    "gcloud",
    "compute",
    "network-endpoint-groups",
    "list",
    "--project=my-project",
    "--filter=network:devstash-dev-vpc",
    "--format=value(name,zone.basename())",
]
_FW_LIST = [
    "gcloud",
    "compute",
    "firewall-rules",
    "list",
    "--project=my-project",
    "--filter=network:devstash-dev-vpc AND name:(gke-* OR k8s-*)",
    "--format=value(name)",
]


def _neg_del(name: str, zone: str) -> list[str]:
    return [
        "gcloud",
        "compute",
        "network-endpoint-groups",
        "delete",
        name,
        f"--zone={zone}",
        "--project=my-project",
        "--quiet",
    ]


def _fw_del(name: str) -> list[str]:
    return [
        "gcloud",
        "compute",
        "firewall-rules",
        "delete",
        name,
        "--project=my-project",
        "--quiet",
    ]


def test_deletes_each_neg_with_zone_and_each_firewall_rule(
    expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_NEG_LIST, stdout="neg-a\tus-central1-a\nneg-b\tus-central1-b\n")
    expect(_neg_del("neg-a", "us-central1-a"), stdout="")
    expect(_neg_del("neg-b", "us-central1-b"), stdout="")
    expect(_FW_LIST, stdout="gke-abc-node\nk8s-def-fw\n")
    expect(_fw_del("gke-abc-node"), stdout="")
    expect(_fw_del("k8s-def-fw"), stdout="")

    reap_negs.reap_leaked_negs("devstash-dev-vpc", "my-project")

    calls = recorded_calls()
    # Each NEG deleted WITH its correct zone; each firewall rule by name.
    assert _neg_del("neg-a", "us-central1-a") in calls
    assert _neg_del("neg-b", "us-central1-b") in calls
    assert _fw_del("gke-abc-node") in calls
    assert _fw_del("k8s-def-fw") in calls
    # Exactly 4 deletes + 2 lists = 6 calls (no stray deletes).
    assert len(calls) == 6


def test_nothing_leaked_clean_noop_no_deletes(
    expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    expect(_NEG_LIST, stdout="")  # every list returns empty
    expect(_FW_LIST, stdout="")

    reap_negs.reap_leaked_negs("devstash-dev-vpc", "my-project")

    calls = recorded_calls()
    assert all("delete" not in call for call in calls)
    assert len(calls) == 2  # just the two lists


def test_delete_failure_is_tolerated_and_continues(
    expect: ExpectFn, recorded_calls: RecordedCallsFn
) -> None:
    # Best-effort: a non-zero delete (already gone / in use) must not abort the reap.
    expect(_NEG_LIST, stdout="neg-a\tus-central1-a\n")
    expect(_neg_del("neg-a", "us-central1-a"), returncode=1, stderr="in use")
    expect(_FW_LIST, stdout="gke-abc-node\n")
    expect(_fw_del("gke-abc-node"), returncode=1, stderr="already gone")

    # Must not raise despite both deletes failing.
    reap_negs.reap_leaked_negs("devstash-dev-vpc", "my-project")

    calls = recorded_calls()
    assert _neg_del("neg-a", "us-central1-a") in calls
    assert _fw_del("gke-abc-node") in calls
