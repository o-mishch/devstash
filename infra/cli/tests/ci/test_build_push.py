"""Tests for ci/build_push.py — the AR gate, bake, digest parse/validate, result shape."""

import json
from pathlib import Path

import pytest

from devstash_infra.ci.build_push import BuildPushResult, build_push
from devstash_infra.clients.ar import ArtifactRegistry
from devstash_infra.clients.docker import Docker
from devstash_infra.shared.errors import InfraError
from tests.doubles import ManualClock

_WEB = "sha256:" + "a" * 64
_MIGRATE = "sha256:" + "b" * 64


class _FakeAr:
    def __init__(self, *, writable: bool) -> None:
        self._writable = writable
        self.waited = False

    def wait_until_writable(self) -> bool:
        self.waited = True
        return self._writable


class _FakeDocker:
    """Writes the metadata file bake would have produced, so build_push can read it back."""

    def __init__(self, metadata: object) -> None:
        self._metadata = metadata
        self.baked = False
        self.env_extra: dict[str, str] | None = None

    def buildx_bake(
        self, bake_file: str, *, metadata_file: str, env_extra: dict[str, str] | None = None
    ) -> None:
        self.baked = True
        self.env_extra = env_extra
        Path(metadata_file).write_text(json.dumps(self._metadata))


def _ar(fake: _FakeAr) -> ArtifactRegistry:
    return fake  # type: ignore[return-value]


def _docker(fake: _FakeDocker) -> Docker:
    return fake  # type: ignore[return-value]


def _run(ar: _FakeAr, docker: _FakeDocker, tmp_path: Path) -> BuildPushResult:
    return build_push(
        _ar(ar),
        _docker(docker),
        region="us-central1",
        project="proj",
        repo="devstash",
        image="web",
        image_migrate="migrate",
        github_sha="deadbeef",
        bake_file=tmp_path / "bake.hcl",
        metadata_file=tmp_path / "meta.json",
        clock=ManualClock(),
    )


def test_builds_and_returns_validated_digests(tmp_path: Path) -> None:
    docker = _FakeDocker(
        {"web": {"containerimage.digest": _WEB}, "migrate": {"containerimage.digest": _MIGRATE}}
    )
    result = _run(_FakeAr(writable=True), docker, tmp_path)
    base = "us-central1-docker.pkg.dev/proj/devstash"
    assert result.image_uri == f"{base}/web"
    assert result.web_digest == _WEB
    assert result.migrate_image == f"{base}/migrate@{_MIGRATE}"  # digest-pinned ref
    # the bake `variable` env carried the image coordinates + commit sha.
    assert docker.env_extra == {
        "IMAGE_URI": f"{base}/web",
        "MIGRATE_URI": f"{base}/migrate",
        "GITHUB_SHA": "deadbeef",
    }


def test_ar_not_writable_raises_before_bake(tmp_path: Path) -> None:
    ar = _FakeAr(writable=False)
    docker = _FakeDocker({})
    with pytest.raises(InfraError, match="not writable by the deployer SA"):
        _run(ar, docker, tmp_path)
    assert ar.waited is True
    assert docker.baked is False  # never build when the registry can't be pushed to


def test_invalid_digest_raises(tmp_path: Path) -> None:
    docker = _FakeDocker(
        {
            "web": {"containerimage.digest": "not-a-digest"},
            "migrate": {"containerimage.digest": _MIGRATE},
        }
    )
    with pytest.raises(InfraError, match="did not return valid registry image digests"):
        _run(_FakeAr(writable=True), docker, tmp_path)


def test_missing_target_raises(tmp_path: Path) -> None:
    docker = _FakeDocker({"web": {"containerimage.digest": _WEB}})  # no `migrate` target
    with pytest.raises(InfraError, match="did not return valid registry image digests"):
        _run(_FakeAr(writable=True), docker, tmp_path)
