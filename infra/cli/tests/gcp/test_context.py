"""Tests for gcp/context.py — config resolution + the collaborator-graph factory (CLI zone).

read_tfvar/ensure_tfvars/resolve_config are pure file/parse logic (tmp_path files); preflight is
a shutil.which probe (monkeypatched); require_state_bucket/wait_for_no_autosuspend_build/
cleanup_builds emit gcloud argv so they keep the `expect`/`recorded_calls` fake_process fixtures
and assert the exact argv (parity with the shell). build_context is exercised by the app_gcp
CliRunner smoke test, not re-wired here.
"""

import shutil
from collections.abc import Callable
from pathlib import Path

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.config import GcpConfig
from devstash_infra.gcp import context
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn, RecordedCallsFn

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)


def _noop_ensure() -> None:
    """Typed stand-in for `ensure_tfvars` in resolve_config tests (basedpyright rejects lambdas)."""


def _reader(values: dict[str, str]) -> Callable[[str], str]:
    """Build a typed `read_tfvar` stub returning `values[key]` (or "")."""

    def _read(key: str) -> str:
        return values.get(key, "")

    return _read


class TestReadTfvar:
    def test_reads_quoted_scalar(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('project_id = "my-proj"\nregion = "us-central1"\n', encoding="utf-8")
        assert context.read_tfvar("project_id", f) == "my-proj"
        assert context.read_tfvar("region", f) == "us-central1"

    def test_reads_bare_scalar(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text("github_owner_id = 12345\n", encoding="utf-8")
        assert context.read_tfvar("github_owner_id", f) == "12345"

    def test_strips_inline_comment(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('region = "us-west1"  # override\n', encoding="utf-8")
        assert context.read_tfvar("region", f) == "us-west1"

    def test_absent_key_returns_empty(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('project_id = "p"\n', encoding="utf-8")
        assert context.read_tfvar("nope", f) == ""

    def test_missing_file_returns_empty(self, tmp_path: Path) -> None:
        assert context.read_tfvar("project_id", tmp_path / "absent.tfvars") == ""

    def test_list_shape_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('zones = ["a", "b"]\n', encoding="utf-8")
        with pytest.raises(InfraError, match="not a simple scalar"):
            context.read_tfvar("zones", f)

    def test_object_shape_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text("third_party_secrets = {\n", encoding="utf-8")
        with pytest.raises(InfraError, match="not a simple scalar"):
            context.read_tfvar("third_party_secrets", f)

    def test_heredoc_shape_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text("body = <<EOT\n", encoding="utf-8")
        with pytest.raises(InfraError, match="not a simple scalar"):
            context.read_tfvar("body", f)


class TestEnsureTfvars:
    def test_creates_from_example_then_raises(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        example = tmp_path / "terraform.tfvars.example"
        example.write_text('project_id = "sk_..."\n', encoding="utf-8")
        tfvars = tmp_path / "terraform.tfvars"
        # ensure_tfvars reads _TFVARS_EXAMPLE (module const) for the copy source.
        monkeypatch.setattr(context, "_TFVARS_EXAMPLE", example)
        with pytest.raises(InfraError, match="then re-run"):
            context.ensure_tfvars(tfvars)
        assert tfvars.is_file()  # created
        assert "Created" in capsys.readouterr().out

    def test_placeholder_raises(self, tmp_path: Path) -> None:
        tfvars = tmp_path / "terraform.tfvars"
        tfvars.write_text('stripe = "sk_..."\n', encoding="utf-8")
        with pytest.raises(InfraError, match="still contain placeholders"):
            context.ensure_tfvars(tfvars)

    def test_clean_tfvars_passes(self, tmp_path: Path) -> None:
        tfvars = tmp_path / "terraform.tfvars"
        tfvars.write_text('project_id = "real-proj"\nstripe = "sk_live_real"\n', encoding="utf-8")
        context.ensure_tfvars(tfvars)  # no raise


class TestResolveConfig:
    def test_derives_state_bucket_from_project(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("STATE_BUCKET", raising=False)
        monkeypatch.setattr(context, "ensure_tfvars", _noop_ensure)
        values = {"project_id": "acme", "region": "eu-west1", "environment": "dev"}
        monkeypatch.setattr(context, "read_tfvar", _reader(values))
        cfg = context.resolve_config()
        assert cfg.project == "acme"
        assert cfg.region == "eu-west1"
        assert cfg.state_bucket == "acme-tfstate-dev"
        assert cfg.db_name == "devstash"

    def test_defaults_region_and_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("STATE_BUCKET", raising=False)
        monkeypatch.setattr(context, "ensure_tfvars", _noop_ensure)
        monkeypatch.setattr(context, "read_tfvar", _reader({"project_id": "acme"}))
        cfg = context.resolve_config()
        assert cfg.region == "us-central1"
        assert cfg.environment == "dev"

    def test_env_override_state_bucket(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("STATE_BUCKET", "custom-bucket")
        monkeypatch.setattr(context, "ensure_tfvars", _noop_ensure)
        monkeypatch.setattr(context, "read_tfvar", _reader({"project_id": "acme"}))
        assert context.resolve_config().state_bucket == "custom-bucket"

    def test_missing_project_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(context, "ensure_tfvars", _noop_ensure)
        monkeypatch.setattr(context, "read_tfvar", _reader({}))
        with pytest.raises(InfraError, match="project_id not set"):
            context.resolve_config()


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


_BUCKET_DESCRIBE = ["gcloud", "storage", "buckets", "describe", "gs://proj-tfstate-dev"]
_ONGOING = [
    "gcloud", "builds", "list", "--region=us-central1", "--project=proj", "--ongoing",
    "--filter=substitutions.TRIGGER_NAME=devstash-dev-auto-suspend", "--format=value(id)",
]  # fmt: skip


class TestRequireStateBucket:
    def test_present_passes(self, expect: ExpectFn) -> None:
        expect(_BUCKET_DESCRIBE, stdout="gs://proj-tfstate-dev")
        context.require_state_bucket(Gcloud("proj"), "proj-tfstate-dev")

    def test_absent_raises_bootstrap_hint(self, expect: ExpectFn) -> None:
        expect(_BUCKET_DESCRIBE, returncode=1, stderr="NOT_FOUND")
        with pytest.raises(InfraError, match="run 'bootstrap' first"):
            context.require_state_bucket(Gcloud("proj"), "proj-tfstate-dev")


class TestWaitForNoAutosuspendBuild:
    def test_returns_immediately_when_none(self, expect: ExpectFn) -> None:
        expect(_ONGOING, stdout="")  # no ongoing build
        context.wait_for_no_autosuspend_build(Gcloud("proj"), _CONFIG, sleep=lambda _s: None)

    def test_waits_then_returns_when_build_clears(
        self, expect: ExpectFn, capsys: pytest.CaptureFixture[str]
    ) -> None:
        expect(_ONGOING, stdout="build-123")  # still running
        expect(_ONGOING, stdout="")  # cleared on the next poll
        slept: list[float] = []
        context.wait_for_no_autosuspend_build(Gcloud("proj"), _CONFIG, sleep=slept.append)
        assert slept == [20.0]  # one poll interval waited
        assert "holds the state lock" in capsys.readouterr().out

    def test_deadline_raises(self, expect: ExpectFn) -> None:
        expect(_ONGOING, stdout="build-123", occurrences=2)  # never clears
        with pytest.raises(InfraError, match="still running after"):
            context.wait_for_no_autosuspend_build(
                Gcloud("proj"), _CONFIG, sleep=lambda _s: None, deadline_s=20, poll_s=20
            )


class TestCleanupBuilds:
    def test_cancels_and_removes_staging(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn
    ) -> None:
        expect(_ONGOING, stdout="b1 b2")
        expect(
            ["gcloud", "builds", "cancel", "b1", "--region=us-central1",
             "--project=proj", "--quiet"], stdout="",
        )  # fmt: skip
        expect(
            ["gcloud", "builds", "cancel", "b2", "--region=us-central1",
             "--project=proj", "--quiet"], stdout="",
        )  # fmt: skip
        expect(["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet"], stdout="")
        context.cleanup_builds(Gcloud("proj"), _CONFIG)
        calls = recorded_calls()
        assert ["gcloud", "builds", "cancel", "b1", "--region=us-central1",
                "--project=proj", "--quiet"] in calls  # fmt: skip
        assert ["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet"] in calls

    def test_no_builds_still_removes_staging(
        self, expect: ExpectFn, recorded_calls: RecordedCallsFn
    ) -> None:
        expect(_ONGOING, stdout="")  # nothing to cancel
        expect(["gcloud", "storage", "rm", "-r", "gs://proj_cloudbuild", "--quiet"], stdout="")
        context.cleanup_builds(Gcloud("proj"), _CONFIG)
        assert [
            "gcloud",
            "storage",
            "rm",
            "-r",
            "gs://proj_cloudbuild",
            "--quiet",
        ] in recorded_calls()


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
