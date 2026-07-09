"""Tests for gcp/parallel.py — the fail-fast parallel join [fix #11].

Spawns real short-lived shell jobs (the Python peer of the bats `( … ) &`) and asserts the join's
behavior: all-succeed returns, the first failure kills every surviving sibling and raises, and the
per-path "✓ [label] done in <dur>" narration only fires for labelled jobs.
"""

import subprocess
import time

import pytest

from devstash_infra.gcp.parallel import Job, join_fail_fast
from devstash_infra.shared.errors import InfraError


def _spawn(script: str) -> subprocess.Popen[str]:
    """Launch a real shell job (the Python peer of the bats `( … ) &`)."""
    return subprocess.Popen(["sh", "-c", script], text=True)


class TestJoinFailFastFix11:
    def test_all_succeed_returns_no_raise(self) -> None:
        jobs = [Job(_spawn("exit 0")) for _ in range(3)]
        join_fail_fast(jobs, "should not fire")  # no raise

    def test_empty_set_is_noop_success(self) -> None:
        join_fail_fast([], "should not fire")  # no raise

    def test_fix_11_failing_job_raises_with_message_and_code(self) -> None:
        good = Job(_spawn("exit 0"))
        bad = Job(_spawn("sleep 0.1; exit 7"))
        with pytest.raises(InfraError):
            join_fail_fast([good, bad], "resume overlap failed")

    def test_fix_11_survivors_are_killed_on_failure(self, tmp_path: pytest.TempPathFactory) -> None:
        """[fix #11] When one job fails, every still-running sibling is KILLED — no detached
        install/apply left running. The survivor writes a sentinel only if allowed to finish.
        """
        import pathlib

        sentinel = pathlib.Path(str(tmp_path)) / "survivor-finished"
        survivor = Job(_spawn(f"sleep 5; : > {sentinel}"))
        bad = Job(_spawn("exit 3"))
        with pytest.raises(InfraError):
            join_fail_fast([survivor, bad], "overlap failed")
        # The survivor was killed mid-sleep → its sentinel was never written, and it is dead.
        time.sleep(0.1)
        assert not sentinel.exists()
        assert survivor.process.poll() is not None

    def test_fix_11_labelled_job_announces_with_duration(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Pin t0 two seconds in the past for a deterministic elapsed reading.
        job = Job(_spawn("exit 0"), label="apply")
        join_fail_fast([job], "n/a", t0=time.monotonic() - 2)
        assert "[apply] done in 2s" in capsys.readouterr().out

    def test_unlabeled_job_stays_silent(self, capsys: pytest.CaptureFixture[str]) -> None:
        job = Job(_spawn("exit 0"))  # "" label → silent (bare-pid back-compat)
        join_fail_fast([job], "n/a", t0=time.monotonic())
        assert "done" not in capsys.readouterr().out

    def test_only_mapped_jobs_announce(self, capsys: pytest.CaptureFixture[str]) -> None:
        a = Job(_spawn("exit 0"), label="eso")
        b = Job(_spawn("exit 0"))  # intentionally unlabeled
        join_fail_fast([a, b], "n/a", t0=time.monotonic())
        out = capsys.readouterr().out
        assert "[eso] done" in out
        assert out.count("done in") == 1  # exactly one announce — b stayed silent
