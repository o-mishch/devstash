"""shared/clock.py — the single time seam. 3.14 floor, stdlib-only.

ONE injected dependency replaces the per-method `sleep=`/`clock=`/`now=` test knobs that used to
thread through production signatures (test-induced design damage). Domain code holds a `Clock` and
calls `clock.sleep`/`clock.monotonic`/`clock.now`; production wires `SYSTEM_CLOCK`, tests wire a
virtual clock whose `sleep` advances time instead of blocking — so deterministic timing needs no
real waits and no monkeypatching. Floor-resident (stdlib-only) so the Cloud Build path shares it.

`attempts`/`gap_seconds` stay as ordinary policy config on the methods that poll — they are not
test hooks; a virtual clock makes their real defaults instant, so tests never override them.
"""

import time
from datetime import UTC, datetime
from typing import Protocol


class Clock(Protocol):
    """The time surface domain code depends on: monotonic elapsed, wall clock, and sleep."""

    def monotonic(self) -> float: ...
    def now(self) -> datetime: ...
    # Positional-only: callers pass `clock.sleep(gap)` positionally, and a test fake that ignores
    # the value may name its parameter `_seconds` without breaking structural conformance.
    def sleep(self, seconds: float, /) -> None: ...


class SystemClock:
    """The real clock — `time.monotonic`, tz-aware `datetime.now(UTC)`, blocking `time.sleep`."""

    def monotonic(self) -> float:
        return time.monotonic()

    def now(self) -> datetime:
        return datetime.now(UTC)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


# The process-wide real clock. A shared stateless singleton, safe as a default field/param value.
SYSTEM_CLOCK: Clock = SystemClock()
