"""Reusable test doubles shared across suites.

`ManualClock` is a virtual `Clock` (shared/clock.Clock): `sleep` advances internal time instead of
blocking, and `monotonic`/`now` read it. A poll loop that sleeps between attempts therefore advances
its own deadline deterministically — no scripted monotonic sequences, no real waits, no
monkeypatching. Satisfies the `Clock` protocol structurally, so it is passed wherever a `Clock` is.
"""

from datetime import UTC, datetime, timedelta

_EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


class ManualClock:
    """A virtual Clock: `sleep(s)` advances time (never blocks); `monotonic`/`now` read it."""

    def __init__(self, *, start: float = 0.0, wall: datetime = _EPOCH) -> None:
        self._t = start
        self._wall = wall
        self.slept: list[float] = []  # every sleep duration, in call order (for assertions)

    def monotonic(self) -> float:
        return self._t

    def now(self) -> datetime:
        return self._wall

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self._t += seconds
        self._wall += timedelta(seconds=seconds)
