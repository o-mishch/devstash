"""Tests for ci/check_env_active.py — the bounded cluster-presence poll."""

import pytest

from devstash_infra.ci.check_env_active import check_env_active


class _PresentAfter:
    """A cluster_present stub that returns False until the `appear_on`-th call, then True."""

    def __init__(self, appear_on: int) -> None:
        self.appear_on = appear_on
        self.calls = 0

    def __call__(self) -> bool:
        self.calls += 1
        return self.calls >= self.appear_on


class _SleepSpy:
    def __init__(self) -> None:
        self.count = 0

    def __call__(self, _seconds: float) -> None:
        self.count += 1


def test_active_on_first_probe_no_sleep() -> None:
    sleep = _SleepSpy()
    assert check_env_active(_PresentAfter(1), attempts=5, sleep=sleep) is False
    assert sleep.count == 0  # never waited


def test_resume_in_flight_becomes_active() -> None:
    present = _PresentAfter(3)  # appears on the 3rd poll
    sleep = _SleepSpy()
    assert check_env_active(present, attempts=5, sleep=sleep) is False
    assert present.calls == 3
    assert sleep.count == 2  # slept between the first three probes


def test_parked_env_exhausts_window_and_reports_suspended(
    capsys: pytest.CaptureFixture[str],
) -> None:
    present = _PresentAfter(999)  # never appears
    sleep = _SleepSpy()
    assert check_env_active(present, attempts=4, sleep=sleep) is True
    assert present.calls == 4
    assert sleep.count == 3  # attempts - 1 gaps, no trailing sleep
    assert "Environment is suspended" in capsys.readouterr().out
