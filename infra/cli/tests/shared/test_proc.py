"""Tests for shared/proc.py — the subprocess wrapper.

Mirrors the common.sh behaviours: command capture, tolerant probes, the
network/lock signature guards, and the interrupt-safe long_running abort [fix #13].
"""

import signal
import sys
import textwrap

import pytest

from devstash_infra.shared import proc


class TestRun:
    def test_captures_stdout_and_code(self) -> None:
        r = proc.run([sys.executable, "-c", "print('hi')"])
        assert r.ok
        assert r.out == "hi"
        assert r.code == 0
        assert r.argv[0] == sys.executable

    def test_check_true_raises_proc_error_carrying_result(self) -> None:
        with pytest.raises(proc.ProcError) as exc:
            proc.run([sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"])
        assert exc.value.result.code == 3
        assert "boom" in exc.value.result.stderr

    def test_check_false_returns_nonzero_result(self) -> None:
        r = proc.run([sys.executable, "-c", "import sys; sys.exit(7)"], check=False)
        assert not r.ok
        assert r.code == 7

    def test_input_is_piped_to_stdin(self) -> None:
        # Replaces a shell `printf '%s' x | cmd` pipe (the one real inline pipe).
        r = proc.run(
            [sys.executable, "-c", "import sys; print(sys.stdin.read().strip())"],
            input="piped-value",
        )
        assert r.out == "piped-value"

    def test_out_strips_single_trailing_newline_like_dollar_paren(self) -> None:
        r = proc.run([sys.executable, "-c", "print('x')"])  # print adds one \n
        assert r.out == "x"


class TestRunOk:
    def test_true_on_zero_exit(self) -> None:
        assert proc.run_ok([sys.executable, "-c", "pass"]) is True

    def test_false_on_nonzero_exit_without_raising(self) -> None:
        assert proc.run_ok([sys.executable, "-c", "import sys; sys.exit(1)"]) is False


class TestSignatures:
    @pytest.mark.parametrize(
        "text",
        [
            "write: broken pipe",
            "http2: client connection lost",
            "connection reset by peer",
            "Client.Timeout exceeded",
            "read tcp: i/o timeout",
            "unexpected EOF",
            "net/http: TLS handshake timeout",
            "Failed to save state",
            "Failed to upload state",
        ],
    )
    def test_network_signatures_match(self, text: str) -> None:
        assert proc.is_network_error(text)

    def test_real_slow_op_timeout_does_not_match(self) -> None:
        # Anchored to transport strings, never a bare "timeout" — a resource-level
        # slow-op failure must still fail loudly on the first attempt (common.sh:117).
        assert not proc.is_network_error("Error waiting for Instance to create: timeout")

    def test_lock_signature_matches(self) -> None:
        assert proc.is_lock_error("Error acquiring the state lock: ...")

    def test_lock_signature_negative(self) -> None:
        assert not proc.is_lock_error("some other tofu error")


class TestLongRunning:
    def test_streams_and_captures_output(self, capsys: pytest.CaptureFixture[str]) -> None:
        r = proc.long_running([sys.executable, "-c", "print('streamed-line')"])
        assert r.code == 0
        assert "streamed-line" in r.stdout  # captured (for signature inspection)
        assert "streamed-line" in capsys.readouterr().out  # streamed live (the tee half)

    def test_merges_stderr_into_capture(self) -> None:
        r = proc.long_running([sys.executable, "-c", "import sys; sys.stderr.write('err-line\\n')"])
        assert "err-line" in r.stdout  # 2>&1 merge like _tofu_attempt

    def test_returns_nonzero_without_raising(self) -> None:
        # Unlike run(), long_running never raises — the retry/recover loop owns rc.
        r = proc.long_running([sys.executable, "-c", "import sys; sys.exit(5)"])
        assert r.code == 5

    def test_fix_13_sigint_forwarded_child_persists_state_no_teardown(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """[fix #13] A Ctrl-C during a long op is FORWARDED to the child, which runs
        its graceful shutdown and persists state; the parent never tears down first.

        Source: run.sh:105-119 interrupt-safe abort. The child here installs its own
        SIGINT handler that writes a 'persisted state' marker and exits 0 — modelling
        tofu's graceful shutdown. We deliver SIGINT to our own process while waiting;
        long_running must forward it (not raise KeyboardInterrupt out, not kill) and
        return the child's clean result with the marker present.
        """
        child = textwrap.dedent(
            """
            import signal, sys, time
            def _graceful(signum, frame):
                # Model tofu finishing its in-flight op + persisting state on SIGINT.
                print("PERSISTED-STATE", flush=True)
                sys.exit(0)
            signal.signal(signal.SIGINT, _graceful)
            print("READY", flush=True)
            # Raise SIGINT on our OWN process (parent) to exercise the forward path;
            # the parent's handler forwards it back to us, triggering _graceful.
            import os
            os.kill(os.getppid(), signal.SIGINT)
            time.sleep(5)  # wait to be interrupted; should not reach the end
            print("REACHED-END-SHOULD-NOT", flush=True)
            """
        )
        r = proc.long_running([sys.executable, "-c", child])
        # Child shut down gracefully (marker present) and did NOT run to the end.
        assert "PERSISTED-STATE" in r.stdout
        assert "REACHED-END-SHOULD-NOT" not in r.stdout
        assert r.code == 0
        # The one-Ctrl-C guidance was printed to stderr (verbatim run.sh:119 wording).
        assert "letting the in-flight OpenTofu op finish" in capsys.readouterr().err

    def test_fix_13_sigint_handler_restored_after_op(self) -> None:
        """[fix #13] The forwarding handler spans ONLY the tofu op — the previous
        SIGINT handler is restored on exit (the bash trap install/scope equivalent).
        """
        before = signal.getsignal(signal.SIGINT)
        proc.long_running([sys.executable, "-c", "pass"])
        assert signal.getsignal(signal.SIGINT) is before
