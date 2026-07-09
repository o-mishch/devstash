"""Tests for gcp/tfvars.py — the pre-init tfvars reader + config resolution (CLI zone).

read_tfvar/ensure_tfvars/resolve_config are pure file/parse logic exercised over tmp_path files;
read_tfvar/ensure_tfvars are monkeypatched on the module namespace where resolve_config consumes
them. No gcloud/tofu — this layer runs BEFORE `tofu init`.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from devstash_infra.gcp import tfvars
from devstash_infra.shared.errors import InfraError


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
        assert tfvars.read_tfvar("project_id", f) == "my-proj"
        assert tfvars.read_tfvar("region", f) == "us-central1"

    def test_reads_bare_scalar(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text("github_owner_id = 12345\n", encoding="utf-8")
        assert tfvars.read_tfvar("github_owner_id", f) == "12345"

    def test_strips_inline_comment(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('region = "us-west1"  # override\n', encoding="utf-8")
        assert tfvars.read_tfvar("region", f) == "us-west1"

    def test_absent_key_returns_empty(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('project_id = "p"\n', encoding="utf-8")
        assert tfvars.read_tfvar("nope", f) == ""

    def test_missing_file_returns_empty(self, tmp_path: Path) -> None:
        assert tfvars.read_tfvar("project_id", tmp_path / "absent.tfvars") == ""

    def test_list_shape_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text('zones = ["a", "b"]\n', encoding="utf-8")
        with pytest.raises(InfraError, match="not a simple scalar"):
            tfvars.read_tfvar("zones", f)

    def test_object_shape_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text("third_party_secrets = {\n", encoding="utf-8")
        with pytest.raises(InfraError, match="not a simple scalar"):
            tfvars.read_tfvar("third_party_secrets", f)

    def test_heredoc_shape_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "terraform.tfvars"
        f.write_text("body = <<EOT\n", encoding="utf-8")
        with pytest.raises(InfraError, match="not a simple scalar"):
            tfvars.read_tfvar("body", f)


class TestEnsureTfvars:
    def test_creates_from_example_then_raises(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        example = tmp_path / "terraform.tfvars.example"
        example.write_text('project_id = "sk_..."\n', encoding="utf-8")
        target = tmp_path / "terraform.tfvars"
        # ensure_tfvars reads _TFVARS_EXAMPLE (module const) for the copy source.
        monkeypatch.setattr(tfvars, "_TFVARS_EXAMPLE", example)
        with pytest.raises(InfraError, match="then re-run"):
            tfvars.ensure_tfvars(target)
        assert target.is_file()  # created
        assert "Created" in capsys.readouterr().out

    def test_placeholder_raises(self, tmp_path: Path) -> None:
        target = tmp_path / "terraform.tfvars"
        target.write_text('stripe = "sk_..."\n', encoding="utf-8")
        with pytest.raises(InfraError, match="still contain placeholders"):
            tfvars.ensure_tfvars(target)

    def test_clean_tfvars_passes(self, tmp_path: Path) -> None:
        target = tmp_path / "terraform.tfvars"
        target.write_text('project_id = "real-proj"\nstripe = "sk_live_real"\n', encoding="utf-8")
        tfvars.ensure_tfvars(target)  # no raise


class TestResolveConfig:
    def test_derives_state_bucket_from_project(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("STATE_BUCKET", raising=False)
        monkeypatch.setattr(tfvars, "ensure_tfvars", _noop_ensure)
        values = {"project_id": "acme", "region": "eu-west1", "environment": "dev"}
        monkeypatch.setattr(tfvars, "read_tfvar", _reader(values))
        cfg = tfvars.resolve_config()
        assert cfg.project == "acme"
        assert cfg.region == "eu-west1"
        assert cfg.state_bucket == "acme-tfstate-dev"
        assert cfg.db_name == "devstash"

    def test_defaults_region_and_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("STATE_BUCKET", raising=False)
        monkeypatch.setattr(tfvars, "ensure_tfvars", _noop_ensure)
        monkeypatch.setattr(tfvars, "read_tfvar", _reader({"project_id": "acme"}))
        cfg = tfvars.resolve_config()
        assert cfg.region == "us-central1"
        assert cfg.environment == "dev"

    def test_env_override_state_bucket(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("STATE_BUCKET", "custom-bucket")
        monkeypatch.setattr(tfvars, "ensure_tfvars", _noop_ensure)
        monkeypatch.setattr(tfvars, "read_tfvar", _reader({"project_id": "acme"}))
        assert tfvars.resolve_config().state_bucket == "custom-bucket"

    def test_missing_project_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(tfvars, "ensure_tfvars", _noop_ensure)
        monkeypatch.setattr(tfvars, "read_tfvar", _reader({}))
        with pytest.raises(InfraError, match="project_id not set"):
            tfvars.resolve_config()
