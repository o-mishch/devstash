"""Tests for gcp/apply_gate.py — the apply-serialisation preflight helpers (CLI zone).

require_state_bucket/wait_for_no_autosuspend_build/cleanup_builds emit gcloud argv, so they keep the
`expect`/`recorded_calls` fake_process fixtures and assert the exact argv (parity with the shell).
"""

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.gcp import apply_gate
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn
from tests.doubles import ManualClock

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)

_BUCKET_DESCRIBE = ["gcloud", "storage", "buckets", "describe", "gs://proj-tfstate-dev"]
_ONGOING = [
    "gcloud",
    "builds",
    "list",
    "--region=us-central1",
    "--project=proj",
    "--ongoing",
    "--filter=substitutions.TRIGGER_NAME=devstash-dev-auto-suspend",
    "--format=value(id)",
]


class TestRequireStateBucket:
    def test_present_passes(self, expect: ExpectFn) -> None:
        expect(_BUCKET_DESCRIBE, stdout="gs://proj-tfstate-dev")
        apply_gate.require_state_bucket(Gcloud("proj"), "proj-tfstate-dev")

    def test_absent_raises_bootstrap_hint(self, expect: ExpectFn) -> None:
        expect(_BUCKET_DESCRIBE, returncode=1, stderr="NOT_FOUND")
        with pytest.raises(InfraError, match="run 'bootstrap' first"):
            apply_gate.require_state_bucket(Gcloud("proj"), "proj-tfstate-dev")


class TestWaitForNoAutosuspendBuild:
    def test_returns_immediately_when_none(self, expect: ExpectFn) -> None:
        expect(_ONGOING, stdout="")  # no ongoing build
        apply_gate.wait_for_no_autosuspend_build(Gcloud("proj"), _CONFIG, clock=ManualClock())

    def test_waits_then_returns_when_build_clears(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_ONGOING, stdout="build-123")  # still running
        expect(_ONGOING, stdout="")  # cleared on the next poll
        clock = ManualClock()
        apply_gate.wait_for_no_autosuspend_build(Gcloud("proj"), _CONFIG, clock=clock)
        assert clock.slept == [20.0]  # one poll interval waited
        assert "holds the state lock" in capsys.readouterr().out

    def test_deadline_raises(self, expect: ExpectFn) -> None:
        expect(_ONGOING, stdout="build-123", occurrences=2)  # never clears
        with pytest.raises(InfraError, match="still running after"):
            apply_gate.wait_for_no_autosuspend_build(
                Gcloud("proj"), _CONFIG, clock=ManualClock(), deadline_s=20, poll_s=20
            )


class TestCleanupBuilds:
    def test_cancels_and_removes_staging(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn
    ) -> None:
        expect(_ONGOING, stdout="b1 b2")
        expect(
            [
                "gcloud",
                "builds",
                "cancel",
                "b1",
                "--region=us-central1",
                "--project=proj",
                "--quiet",
            ],
            stdout="",
        )
        expect(
            [
                "gcloud",
                "builds",
                "cancel",
                "b2",
                "--region=us-central1",
                "--project=proj",
                "--quiet",
            ],
            stdout="",
        )
        expect(["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet"], stdout="")
        apply_gate.cleanup_builds(Gcloud("proj"), _CONFIG)
        calls = recorded_calls()
        assert [
            "gcloud",
            "builds",
            "cancel",
            "b1",
            "--region=us-central1",
            "--project=proj",
            "--quiet",
        ] in calls
        assert ["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet"] in calls

    def test_no_builds_still_removes_staging(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn
    ) -> None:
        expect(_ONGOING, stdout="")  # nothing to cancel
        expect(["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet"], stdout="")
        apply_gate.cleanup_builds(Gcloud("proj"), _CONFIG)
        assert [
            "gcloud",
            "storage",
            "rm",
            "-r",
            "gs://proj_cloudbuild",
            "--quiet",
        ] in recorded_calls()
