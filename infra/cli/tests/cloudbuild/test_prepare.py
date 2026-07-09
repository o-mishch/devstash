"""Tests for cloudbuild/prepare.py — reconstruct the tofu tfvars from Secret Manager."""

import base64
import json
from pathlib import Path

import pytest

from devstash_infra.cloudbuild.env import BuildEnv
from devstash_infra.cloudbuild.prepare import prepare
from devstash_infra.shared.errors import InfraError
from tests.conftest import ExpectFn

_APP_VER = "projects/proj/secrets/devstash-app-config/versions/3"
_OPS_VER = "projects/proj/secrets/devstash-ops-config/versions/1"


def _versions_list(secret: str) -> list[str]:
    return [
        "gcloud",
        "secrets",
        "versions",
        "list",
        secret,
        "--project=proj",
        "--filter=state:ENABLED",
        "--sort-by=~createTime",
        "--limit=1",
        "--format=value(name)",
    ]


def _access(version: str, secret: str) -> list[str]:
    return [
        "gcloud",
        "secrets",
        "versions",
        "access",
        version,
        f"--secret={secret}",
        "--project=proj",
    ]


def _ops_describe() -> list[str]:
    return ["gcloud", "secrets", "describe", "devstash-ops-config", "--project=proj"]


def _idle(tmp_path: Path) -> Path:
    sentinel = tmp_path / "SUSPEND"
    sentinel.touch()
    return sentinel


def test_skips_entirely_when_not_idle(build_env: BuildEnv, tmp_path: Path) -> None:
    prepare(build_env, tf_dir=tmp_path, sentinel=tmp_path / "SUSPEND")
    assert not (tmp_path / "zz-secrets.auto.tfvars.json").exists()


def test_writes_nonsecret_and_third_party_secrets_without_ops(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout=_APP_VER)
    # database-url is a TF-minted infra key — must NOT be extracted into third_party_secrets.
    expect(
        _access(_APP_VER, "devstash-app-config"),
        stdout='{"openai-api-key":"sk-1","database-url":"x"}',
    )
    expect(_ops_describe(), returncode=1)  # ops secret absent (opt-in)
    prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))

    assert (tmp_path / "zz-nonsecret.auto.tfvars.json").read_bytes() == base64.b64decode(
        build_env.nonsecret_b64
    )
    secrets = json.loads((tmp_path / "zz-secrets.auto.tfvars.json").read_text())
    assert secrets == {"third_party_secrets": {"openai-api-key": "sk-1"}}


def test_folds_spaceship_creds_when_ops_present(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout=_APP_VER)
    expect(_access(_APP_VER, "devstash-app-config"), stdout='{"openai-api-key":"sk-1"}')
    expect(_ops_describe(), returncode=0)  # ops secret present
    expect(_versions_list("devstash-ops-config"), stdout=_OPS_VER)
    expect(
        _access(_OPS_VER, "devstash-ops-config"),
        stdout='{"spaceship-api-key":"k","spaceship-api-secret":"s"}',
    )
    prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))

    secrets = json.loads((tmp_path / "zz-secrets.auto.tfvars.json").read_text())
    assert secrets["spaceship_api_key"] == "k"
    assert secrets["spaceship_api_secret"] == "s"


def test_no_enabled_app_config_version_aborts(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    expect(_versions_list("devstash-app-config"), stdout="")  # no ENABLED version
    with pytest.raises(InfraError, match="no ENABLED version"):
        prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))


def test_non_object_app_config_payload_aborts_loudly(
    build_env: BuildEnv, tmp_path: Path, expect: ExpectFn
) -> None:
    # [FL-1] valid JSON but not an object (e.g. stored as a bare string) must raise InfraError here,
    # not slip past the cast to blow up later as a TypeError past the InfraError-only boundary.
    expect(_versions_list("devstash-app-config"), stdout=_APP_VER)
    expect(_access(_APP_VER, "devstash-app-config"), stdout='"just-a-string"')
    with pytest.raises(InfraError, match="not a JSON object"):
        prepare(build_env, tf_dir=tmp_path, sentinel=_idle(tmp_path))
