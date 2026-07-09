"""Shared fixtures for the cloudbuild step tests — a canonical BuildEnv factory."""

import base64
import dataclasses
from collections.abc import Callable

import pytest

from devstash_infra.cloudbuild.env import BuildEnv

_DEFAULT = BuildEnv(
    project_id="proj",
    region="us-central1",
    state_bucket="tfstate",
    repo_slug="owner/repo",
    repo_branch="main",
    secret_keys=("openai-api-key",),
    nonsecret_b64=base64.b64encode(b'{"region":"us-central1"}').decode(),
    idle_window_s=3600,
    max_uptime_s=7200,
    db_instance="devstash-db",
    db_dumps_bucket="dumps",
    db_dump_object="dump.sql",
    db_dump_keep=2,
    vpc="devstash-vpc",
    build_id="build-1",
    trigger_name="auto-suspend",
)


def _make(**overrides: object) -> BuildEnv:
    """A BuildEnv with sensible test defaults; pass keyword overrides per test."""
    # replace() is per-field typed; **object overrides can't unify — safe in a test factory.
    return dataclasses.replace(_DEFAULT, **overrides)  # type: ignore[arg-type]


@pytest.fixture
def make_env() -> Callable[..., BuildEnv]:
    """Factory fixture: `make_env(idle_window_s=10)` → a BuildEnv with that override."""
    return _make


@pytest.fixture
def build_env() -> BuildEnv:
    """The canonical default BuildEnv."""
    return _make()
