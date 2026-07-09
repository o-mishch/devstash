"""Shared pytest fixtures for the argv-parity harness.

`pytest-subprocess` registers each expected command and lets tests assert the exact
argv per call (the Python equivalent of the old bats spy/stub + execa argv-diff).

pytest-subprocess' `FakeProcess.register` / `.calls` are partially untyped, which
trips pyright strict's `reportUnknownMemberType` at every call site. So ALL direct
contact with that surface is confined to the typed helpers here — tests use
`expect` / `capture_stdin` / `recorded_calls` and never touch `fp.register` /
`fp.calls` themselves. Same rationale as the repo's typed test-matcher wrappers
(src/test/matchers.ts) that exist to satisfy `no-unsafe-*`.
"""

from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Protocol, cast

import pytest
from pytest_subprocess import FakeProcess

_FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_contents() -> Callable[[str], str]:
    """Read a test fixture file's bytes as text (mirrors bats `fixture_contents`).

    Fixtures live under tests/fixtures/*.json, reused verbatim from the bats
    __fixtures__/ dirs — no inline JSON in tests (same convention as the shell suite).
    """

    def _read(name: str) -> str:
        return (_FIXTURES / name).read_text()

    return _read


class ExpectFn(Protocol):
    """Typed signature of the `expect` registration helper."""

    def __call__(
        self,
        argv: Sequence[str],
        *,
        stdout: str = ...,
        stderr: str = ...,
        returncode: int = ...,
        occurrences: int = ...,
    ) -> None: ...


class CaptureStdinFn(Protocol):
    """Typed signature of `capture_stdin` — register a command and record its stdin."""

    def __call__(
        self, argv: Sequence[str], *, stdout: str = ..., returncode: int = ...
    ) -> list[str]: ...


@pytest.fixture
def expect(fp: FakeProcess) -> ExpectFn:
    """Register an expected subprocess invocation with canned output.

    Usage:
        expect(["tofu", "output", "-json"], stdout='{"x": {"value": "1"}}')
        expect(["gcloud", ...], returncode=1, stderr="boom", occurrences=2)
    """

    def _expect(
        argv: Sequence[str],
        *,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
        occurrences: int = 1,
    ) -> None:
        fp.register(  # pyright: ignore[reportUnknownMemberType]
            list(argv),
            stdout=stdout,
            stderr=stderr,
            returncode=returncode,
            occurrences=occurrences,
        )

    return _expect


@pytest.fixture
def capture_stdin(fp: FakeProcess) -> CaptureStdinFn:
    """Register `argv` and capture every stdin payload piped to it.

    The pytest-subprocess equivalent of bats `spy_capture_stdin` + `spy_stdin`.
    Returns a list that accumulates each call's stdin text, in call order.
    """

    def _capture(argv: Sequence[str], *, stdout: str = "", returncode: int = 0) -> list[str]:
        recorded: list[str] = []

        def _sink(data: str) -> None:
            recorded.append(data)

        fp.register(  # pyright: ignore[reportUnknownMemberType]
            list(argv),
            stdout=stdout,
            returncode=returncode,
            stdin_callable=_sink,
        )
        return recorded

    return _capture


RecordedCallsFn = Callable[[], "list[list[str]]"]


@pytest.fixture
def recorded_calls(fp: FakeProcess) -> RecordedCallsFn:
    """Return every recorded subprocess call as a list of argv `list[str]`.

    Confines the untyped `fp.calls` access so tests can assert on invocations with
    a fully-typed value (mirrors the bats `*.calls` spy log).
    """

    def _calls() -> list[list[str]]:
        # fp.calls is a deque with a partially-unknown element type (pytest-subprocess
        # accepts str | PathLike | Program); cast the whole attribute in one shot.
        raw = cast("Iterable[Iterable[object]]", fp.calls)
        return [[str(arg) for arg in call] for call in raw]

    return _calls
