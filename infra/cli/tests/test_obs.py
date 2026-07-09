"""Tests for obs.py — the CLI structlog config (run_id correlation + redaction).

End-to-end via capsys: configure(run_id), emit an event carrying a secret, then assert the
rendered JSON line carries the run_id AND that the secret is scrubbed (the §Observability
redaction requirement, exercised through the real structlog pipeline, not the floor helper).
"""

import json

import pytest

from devstash_infra import obs
from devstash_infra.shared import log

_SECRET = "sk-live-DEADBEEF-super-secret-token"


def test_run_id_correlates_every_event(capsys: pytest.CaptureFixture[str]) -> None:
    obs.configure("run-abc")
    obs.get_logger().info("apply started", resource="cloudsql")
    event = json.loads(capsys.readouterr().out.strip())
    assert event["run_id"] == "run-abc"
    assert event["event"] == "apply started"
    assert event["resource"] == "cloudsql"


def test_secret_is_redacted_from_the_structured_event(
    capsys: pytest.CaptureFixture[str],
) -> None:
    obs.configure("run-xyz")
    obs.get_logger().info("pushing creds", api_secret=_SECRET, argv=f"gcloud --secret={_SECRET}")
    line = capsys.readouterr().out.strip()
    assert _SECRET not in line  # scrubbed from both the key-value AND the inline argv
    event = json.loads(line)
    assert event["api_secret"] == log.REDACTED
    assert log.REDACTED in event["argv"]
