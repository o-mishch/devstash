"""Tests for gcp/context.py — preflight + the collaborator-graph factory (CLI zone).

preflight is a shutil.which probe (monkeypatched); build_context wiring is asserted through the
recovery-wiring contract here and the app CliRunner smoke test. Config resolution lives in
tests/gcp/test_tfvars.py; the apply-serialisation gates in tests/gcp/test_apply_gate.py.
"""

import shutil

import pytest

from devstash_infra.gcp import context
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.shared.errors import InfraError

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)


class TestPreflight:
    def test_all_present_passes(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        def _which(_name: str) -> str | None:
            return "/usr/bin/x"

        monkeypatch.setattr(shutil, "which", _which)
        context.preflight()
        assert "all CLIs present" in capsys.readouterr().out

    def test_missing_cli_raises_with_hint(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _which(name: str) -> str | None:
            return None if name == "tofu" else "/usr/bin/x"

        monkeypatch.setattr(shutil, "which", _which)
        with pytest.raises(InfraError, match="tofu"):
            context.preflight()


class TestAutoApproveFromEnv:
    def test_true_when_set_to_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AUTO_APPROVE", "1")
        assert context.auto_approve_from_env() is True

    def test_false_otherwise(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("AUTO_APPROVE", raising=False)
        assert context.auto_approve_from_env() is False
        monkeypatch.setenv("AUTO_APPROVE", "yes")
        assert context.auto_approve_from_env() is False


class TestBuildContextRecoveryWiring:
    """The orchestrator tofu auto-launches guided recovery on a stuck lock, WITHOUT recursion."""

    def test_recovery_wired_into_orchestrator_tofu_over_separate_client(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(context, "resolve_config", lambda: _CONFIG)
        ctx = context.build_context()
        # (1) apply/suspend/resume run on ctx.tofu, which is now wired to the guided recovery
        #     (shell parity) — a stuck lock retries via recovery instead of failing outright.
        assert ctx.tofu._recover == ctx.state_recovery.recover  # pyright: ignore[reportPrivateUsage]  # the wiring is the contract
        # (2) recovery force-unlocks over its OWN Tofu, NOT ctx.tofu — so a lock error during that
        #     force_unlock can't re-enter recovery (the infinite-loop the separation prevents).
        assert ctx.state_recovery.tofu is not ctx.tofu
