"""Tests for shared/reconcile_ar_iam.py — the stranded-AR-IAM state purge.

No standalone bats suite exists (it's exercised via reconcile.sh branch 4); these
assert its self-disabling safety + the exact-address purge directly. The safety
contract: act ONLY when the repo is genuinely absent, purge ONLY tracked addresses,
and surface a failed `state rm` (never swallow it).
"""

from pathlib import Path

import pytest

from devstash_infra.shared import reconcile_ar_iam as rec
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn

_DESCRIBE = [
    "gcloud",
    "artifacts",
    "repositories",
    "describe",
    "devstash-dev",
    "--location=us-central1",
    "--project=proj",
]
_ADDR_A = "module.iam.google_artifact_registry_repository_iam_member.a"
_ADDR_B = "module.iam.google_artifact_registry_repository_iam_member.b"


def _purge(tmp_path: Path) -> bool:
    f = tmp_path / "ar-iam-member-addresses.txt"
    f.write_text(f"# repo-scoped AR IAM members\n{_ADDR_A}\n\n{_ADDR_B}\n")
    return rec.purge_stranded_ar_iam("devstash-dev", "us-central1", "proj", str(f))


def test_repo_present_is_noop_never_touches_state(
    expect: ExpectFn, recorded_calls: RecordedCallsFn, tmp_path: Path
) -> None:
    # Present repo → members legitimately managed; no state list/rm at all.
    expect(_DESCRIBE, stdout="repo exists")
    assert _purge(tmp_path) is True
    calls = recorded_calls()
    assert all("state" not in call for call in calls)


def test_repo_absent_purges_only_tracked_addresses(
    expect: ExpectFn, recorded_calls: RecordedCallsFn, tmp_path: Path
) -> None:
    expect(_DESCRIBE, returncode=1, stderr="NOT_FOUND")  # repo gone → stranded signature
    # addr A is tracked → state rm; addr B is NOT tracked → skipped (no rm).
    expect(["tofu", "state", "list", _ADDR_A], stdout=f"{_ADDR_A}\n")
    expect(["tofu", "state", "rm", "-lock-timeout=120s", _ADDR_A], stdout="Removed")
    expect(["tofu", "state", "list", _ADDR_B], stdout="")  # not in state

    assert _purge(tmp_path) is True

    calls = recorded_calls()
    assert ["tofu", "state", "rm", "-lock-timeout=120s", _ADDR_A] in calls
    # addr B was never state-rm'd (it wasn't tracked).
    assert ["tofu", "state", "rm", "-lock-timeout=120s", _ADDR_B] not in calls


def test_failed_state_rm_returns_false_not_swallowed(expect: ExpectFn, tmp_path: Path) -> None:
    # A stranded member that cannot be purged must surface (unlike the best-effort helpers).
    expect(_DESCRIBE, returncode=1, stderr="NOT_FOUND")
    expect(["tofu", "state", "list", _ADDR_A], stdout=f"{_ADDR_A}\n")
    expect(["tofu", "state", "rm", "-lock-timeout=120s", _ADDR_A], returncode=1, stderr="lock")

    assert _purge(tmp_path) is False


def test_missing_addr_file_raises_infra_error(expect: ExpectFn, tmp_path: Path) -> None:
    # [FL-3] repo gone but the address list is unreadable → clear InfraError, not a bare
    # FileNotFoundError past the InfraError-only boundary.
    expect(_DESCRIBE, returncode=1, stderr="NOT_FOUND")
    absent = tmp_path / "nope.txt"
    with pytest.raises(InfraError, match="address file not found"):
        rec.purge_stranded_ar_iam("devstash-dev", "us-central1", "proj", str(absent))
