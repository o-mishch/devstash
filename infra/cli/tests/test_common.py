"""Tests for common.py — presentation/preflight/control-flow primitives.

Focus on the behaviour-bearing helpers: the kube-context guard [fix #10], the
poll-until loop, and confirm's auto-approve gate.
"""

import io
import sys
import time

import pytest
import typer

from devstash_infra import common


class _Tty(io.StringIO):
    """A StringIO that reports as a terminal — drives read_secret's hidden-prompt branch."""

    def isatty(self) -> bool:
        return True


class TestRequireKubeContext:
    def test_fix_10_matching_glob_passes(self) -> None:
        # A GKE context matching the expected glob is accepted (no raise).
        common.require_kube_context(
            "gke_my-proj_us-central1_devstash-dev-gke", "gke_*_devstash-*-gke", "hint"
        )

    def test_fix_10_wrong_context_dies(self) -> None:
        """[fix #10] A non-matching context is refused — the guard that stops a local
        `up` from applying onto the real GKE dev cluster (common.sh:346).
        """
        with pytest.raises(typer.Exit) as exc:
            common.require_kube_context(
                "kind-devstash", "gke_*_devstash-*-gke", "run get-credentials"
            )
        assert exc.value.exit_code == 1

    def test_fix_10_no_context_dies(self) -> None:
        with pytest.raises(typer.Exit):
            common.require_kube_context(None, "gke_*", "hint")
        with pytest.raises(typer.Exit):
            common.require_kube_context("", "gke_*", "hint")

    def test_fix_10_glob_matches_without_hardcoding_project(self) -> None:
        # The glob spans any project id / region — same semantics as bash [[ == glob ]].
        for ctx in ("gke_a_devstash-dev-gke", "gke_xyz_devstash-prod-gke"):
            common.require_kube_context(ctx, "gke_*_devstash-*-gke", "hint")


class TestConfirm:
    def test_auto_approve_skips_prompt(self) -> None:
        # AUTO_APPROVE path: returns True without touching stdin.
        assert common.confirm("proceed?", auto_approve=True) is True


class TestReadSecret:
    def test_piped_stdin_reads_one_plain_line(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Non-tty (CI / heredoc): read one line, strip the newline, never prompt.
        monkeypatch.setattr(sys, "stdin", io.StringIO("s3cr3t\n"))
        assert common.read_secret("key: ") == "s3cr3t"

    def test_tty_uses_hidden_prompt(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A real tty routes through typer.prompt(hide_input=True) — the never-echo read.
        def _hidden_prompt(*_args: object, **_kwargs: object) -> str:
            return "hidden"

        monkeypatch.setattr(sys, "stdin", _Tty())
        monkeypatch.setattr(typer, "prompt", _hidden_prompt)
        assert common.read_secret("key: ") == "hidden"


class TestSpanNarration:
    def test_no_span_has_no_elapsed_leadin(self, capsys: pytest.CaptureFixture[str]) -> None:
        # Outside a span log/ok/warn are byte-for-byte plain — no wall-clock/+elapsed tag.
        common.log("hello")
        out = capsys.readouterr().out
        assert "▶ hello" in out
        assert "+" not in out

    def test_span_adds_elapsed_leadin(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Within a span every line carries "+elapsed" measured from the span origin.
        ticks = iter([0.0, 5.0])  # span() reads t0=0, then log()'s _ts_tag reads 5
        monkeypatch.setattr(time, "monotonic", lambda: next(ticks))
        with common.span(6):
            common.log("working")
        assert "+5s working" in capsys.readouterr().out

    def test_stage_numbers_within_span(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # stage() auto-increments and reads the total set by span() — caller passes only the text.
        monkeypatch.setattr(time, "monotonic", lambda: 0.0)
        with common.span(6):
            common.stage("first")
            common.stage("second")
        out = capsys.readouterr().out
        assert "[stage 1/6] first" in out
        assert "[stage 2/6] second" in out

    def test_span_closes_on_exception(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # The context manager always closes the span — a later log is plain again even if a
        # stage raised mid-span.
        monkeypatch.setattr(time, "monotonic", lambda: 0.0)
        with pytest.raises(RuntimeError), common.span(3):
            raise RuntimeError("boom")
        common.log("plain again")
        out = capsys.readouterr().out
        assert "▶ plain again" in out
        assert "+" not in out

    def test_stage_outside_span_shows_question_total(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # No-op-safe outside a span: still prints, total rendered as "?".
        common.stage("orphan")
        out = capsys.readouterr().out
        assert "/?] orphan" in out


class TestPollUntil:
    def test_succeeds_immediately(self) -> None:
        assert common.poll_until(lambda: True, attempts=3, gap_seconds=0) is True

    def test_succeeds_after_some_attempts(self) -> None:
        calls = {"n": 0}

        def predicate() -> bool:
            calls["n"] += 1
            return calls["n"] >= 2  # fail once, then succeed

        assert common.poll_until(predicate, attempts=5, gap_seconds=0) is True
        assert calls["n"] == 2

    def test_times_out_returns_false(self) -> None:
        assert common.poll_until(lambda: False, attempts=3, gap_seconds=0) is False

    def test_on_attempt_called_per_failed_attempt_except_last(self) -> None:
        # Mirrors the shell: a message per failed attempt up to attempts-1.
        seen: list[tuple[int, int]] = []
        common.poll_until(
            lambda: False,
            attempts=3,
            gap_seconds=0,
            on_attempt=lambda i, total: seen.append((i, total)),
        )
        assert seen == [(1, 3), (2, 3)]

    def test_predicate_exception_reads_as_not_ready(self) -> None:
        # A throwing predicate is treated as "keep waiting" then times out (shell
        # `until` treated a failing command the same way).
        def boom() -> bool:
            raise RuntimeError("probe blipped")

        assert common.poll_until(boom, attempts=2, gap_seconds=0) is False
