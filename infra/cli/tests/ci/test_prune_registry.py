"""Tests for ci/prune_registry.py — package routing, index-first passes, child protection."""

from datetime import UTC, datetime

import pytest

from devstash_infra.ci.images import image_base
from devstash_infra.ci.prune_registry import prune_registry
from tests.doubles import ManualClock

_REGION, _PROJECT, _REPO = "us-central1", "proj", "repo"
_BASE = image_base(_REGION, _PROJECT, _REPO)
_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
_INDEX = "application/vnd.oci.image.index.v1+json"


class _FakeArtifacts:
    def __init__(
        self,
        *,
        packages: list[str],
        newest: dict[str, str] | None = None,
        superseded: dict[str, list[tuple[str, str]]] | None = None,
    ) -> None:
        self._packages = packages
        self._newest = newest or {}
        self._superseded = superseded or {}
        self.deleted: list[str] = []
        self.cutoffs: list[str] = []

    def list_packages(self, repo: str, *, location: str) -> list[str]:
        return list(self._packages)

    def newest_tagged_index(self, image_path: str) -> str:
        return self._newest.get(image_path, "")

    def superseded_manifests(
        self, image_path: str, *, created_before: str
    ) -> list[tuple[str, str]]:
        self.cutoffs.append(created_before)
        return list(self._superseded.get(image_path, []))

    def delete_docker_image(self, image_ref: str) -> bool:
        self.deleted.append(image_ref)
        return True


class _FakeGcloud:
    def __init__(self, artifacts: _FakeArtifacts) -> None:
        self.artifacts = artifacts


class _FakeDocker:
    def __init__(self, children: dict[str, list[str]] | None = None) -> None:
        self._children = children or {}

    def manifest_child_digests(self, image_ref: str) -> list[str]:
        return list(self._children.get(image_ref, []))


def _run(
    artifacts: _FakeArtifacts,
    docker: _FakeDocker,
    *,
    keep_digests: dict[str, str],
    known_images: tuple[str, ...] = ("web", "migrate"),
) -> None:
    prune_registry(
        _FakeGcloud(artifacts),  # type: ignore[arg-type]
        docker,  # type: ignore[arg-type]
        region=_REGION,
        project=_PROJECT,
        repo=_REPO,
        keep_digests=keep_digests,
        clock=ManualClock(wall=_NOW),
        known_images=known_images,
    )


def test_known_image_keeps_digest_and_children_deletes_rest_index_first() -> None:
    web = f"{_BASE}/web"
    artifacts = _FakeArtifacts(
        packages=["web"],
        superseded={
            web: [
                ("sha256:keep", _INDEX),  # kept (the deployed index) — protected
                ("sha256:oldidx", _INDEX),  # delete in pass 1
                ("sha256:childkeep", "manifest"),  # kept child — protected
                ("sha256:oldman", "manifest"),  # delete in pass 2
            ]
        },
    )
    docker = _FakeDocker({f"{web}@sha256:keep": ["sha256:childkeep"]})
    _run(artifacts, docker, keep_digests={"web": "sha256:keep"})
    # index deleted before manifest; kept digest + child never touched.
    assert artifacts.deleted == [f"{web}@sha256:oldidx", f"{web}@sha256:oldman"]


def test_known_image_without_keep_digest_is_skipped(capsys: pytest.CaptureFixture[str]) -> None:
    artifacts = _FakeArtifacts(
        packages=["web"], superseded={f"{_BASE}/web": [("sha256:x", _INDEX)]}
    )
    _run(artifacts, _FakeDocker(), keep_digests={})  # no WEB_DIGEST resolved
    assert artifacts.deleted == []  # never prune a known image without its live digest
    assert "no keep digest for known image 'web'" in capsys.readouterr().out


def test_extra_package_keeps_newest_tagged_index() -> None:
    extra = f"{_BASE}/legacy"
    artifacts = _FakeArtifacts(
        packages=["legacy"],
        newest={extra: "sha256:new"},
        superseded={extra: [("sha256:new", _INDEX), ("sha256:old", _INDEX)]},
    )
    _run(artifacts, _FakeDocker(), keep_digests={})
    assert artifacts.deleted == [f"{extra}@sha256:old"]  # newest kept, older index pruned


def test_discovery_empty_falls_back_to_known_images(capsys: pytest.CaptureFixture[str]) -> None:
    artifacts = _FakeArtifacts(packages=[])  # discovery returns nothing
    _run(artifacts, _FakeDocker(), keep_digests={})  # no digests → both known images warn+skip
    out = capsys.readouterr().out
    assert "falling back to the static list" in out
    assert "known image 'web'" in out and "known image 'migrate'" in out


def test_cutoff_is_30_minutes_before_now() -> None:
    web = f"{_BASE}/web"
    artifacts = _FakeArtifacts(packages=["web"], superseded={web: []})
    _run(artifacts, _FakeDocker(), keep_digests={"web": "sha256:keep"})
    assert artifacts.cutoffs == ["2026-01-01T11:30:00Z", "2026-01-01T11:30:00Z"]  # both passes


def test_failed_delete_warns_and_continues(capsys: pytest.CaptureFixture[str]) -> None:
    web = f"{_BASE}/web"

    class _FailingArtifacts(_FakeArtifacts):
        def delete_docker_image(self, image_ref: str) -> bool:
            super().delete_docker_image(image_ref)
            return False  # simulate a missing delete permission

    artifacts = _FailingArtifacts(
        packages=["web"],
        superseded={web: [("sha256:oldidx", _INDEX), ("sha256:oldman", "manifest")]},
    )
    _run(artifacts, _FakeDocker(), keep_digests={"web": "sha256:keep"})
    # both deletes attempted despite the first failing (best-effort, never aborts)
    assert artifacts.deleted == [f"{web}@sha256:oldidx", f"{web}@sha256:oldman"]
    assert "failed to delete" in capsys.readouterr().out
