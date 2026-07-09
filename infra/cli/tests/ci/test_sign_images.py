"""Tests for ci/sign_images.py — signs both deployed artifacts, hard-fails loudly."""

import pytest

from devstash_infra.ci.sign_images import sign_images
from devstash_infra.clients.gcloud import Gcloud


class _RecordingContainer:
    def __init__(self, *, fail_on: str | None = None) -> None:
        self.fail_on = fail_on
        self.signed: list[tuple[str, str, str, str]] = []

    def sign_attestation(self, artifact: str, *, attestor: str, keyring: str, key: str) -> None:
        if artifact == self.fail_on:
            raise RuntimeError("kms signing failed")
        self.signed.append((artifact, attestor, keyring, key))


class _FakeGcloud:
    def __init__(self, container: _RecordingContainer) -> None:
        self.container = container


def _gcloud(container: _RecordingContainer) -> Gcloud:
    return _FakeGcloud(container)  # type: ignore[return-value]


def test_signs_web_by_digest_and_migrate_ref() -> None:
    container = _RecordingContainer()
    sign_images(
        _gcloud(container),
        image_uri="reg/repo/web",
        web_digest="sha256:abc",
        migrate_image="reg/repo/migrate@sha256:def",
        attestor="att",
        keyring="kr",
        key="k",
    )
    signed_artifacts = [entry[0] for entry in container.signed]
    assert signed_artifacts == ["reg/repo/web@sha256:abc", "reg/repo/migrate@sha256:def"]
    assert container.signed[0][1:] == ("att", "kr", "k")  # attestor/keyring/key threaded through


def test_signing_failure_propagates() -> None:
    container = _RecordingContainer(fail_on="reg/repo/web@sha256:abc")
    with pytest.raises(RuntimeError, match="kms signing failed"):
        sign_images(
            _gcloud(container),
            image_uri="reg/repo/web",
            web_digest="sha256:abc",
            migrate_image="reg/repo/migrate@sha256:def",
            attestor="att",
            keyring="kr",
            key="k",
        )
    assert container.signed == []  # failed on the first artifact — never reached migrate
