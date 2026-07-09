"""Tests for ci/inject_settings.py — the loud project_id guard + the two in-place edits."""

from pathlib import Path

import pytest

from devstash_infra.ci.inject_settings import inject_settings
from devstash_infra.clients.yq import Yq
from devstash_infra.shared.errors import InfraError


class _RecordingYq:
    def __init__(self) -> None:
        self.edits: list[tuple[str, str, dict[str, str]]] = []

    def eval_in_place(
        self, expression: str, path: str, *, env_extra: dict[str, str] | None = None
    ) -> None:
        self.edits.append((expression, path, env_extra or {}))


def _yq(fake: _RecordingYq) -> Yq:
    return fake  # type: ignore[return-value]


def _overlay(tmp_path: Path) -> Path:
    (tmp_path / "settings.yaml").write_text("data: {}\n")
    return tmp_path


def test_empty_project_id_raises_before_any_edit() -> None:
    fake = _RecordingYq()
    with pytest.raises(InfraError, match="GCP_PROJECT_ID must be set"):
        inject_settings(
            _yq(fake),
            overlay_dir=Path("/nope"),
            project_id="",
            app_domain="app.example.com",
            email_from="no-reply@example.com",
            image_uri="reg/web",
            web_digest="sha256:abc",
        )
    assert fake.edits == []  # never emit a poisoned manifest


def test_edits_settings_and_kustomization_with_env(tmp_path: Path) -> None:
    fake = _RecordingYq()
    inject_settings(
        _yq(fake),
        overlay_dir=_overlay(tmp_path),
        project_id="my-proj",
        app_domain="app.example.com",
        email_from="no-reply@example.com",
        image_uri="reg/web",
        web_digest="sha256:abc",
        auth_github_id="gh-id",
    )
    settings_edit, image_edit = fake.edits
    # settings.yaml carries the full env (required + optional); unset optionals default to "".
    assert settings_edit[1].endswith("settings.yaml")
    assert settings_edit[2]["GCP_PROJECT_ID"] == "my-proj"
    assert settings_edit[2]["AUTH_GITHUB_ID"] == "gh-id"
    assert settings_edit[2]["ARMOR_ENABLED"] == ""  # unset optional defaults to empty
    # kustomization.yaml pins the image by digest.
    assert image_edit[1].endswith("kustomization.yaml")
    assert image_edit[2] == {"IMAGE_URI": "reg/web", "WEB_DIGEST": "sha256:abc"}
