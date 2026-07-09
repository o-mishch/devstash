"""Tests for cloudbuild/env.py — the Cloud Build substitution → typed BuildEnv parse."""

import pytest

from devstash_infra.cloudbuild.env import BuildEnv
from devstash_infra.shared.errors import InfraError

_FULL = {
    "_PROJECT_ID": "proj",
    "_REGION": "us-central1",
    "_STATE_BUCKET": "tfstate",
    "_REPO_SLUG": "owner/repo",
    "_REPO_BRANCH": "main",
    "_SECRET_KEYS": "openai-api-key resend-api-key",
    "_NONSECRET_B64": "e30=",
    "_IDLE_WINDOW": "3600",
    "_MAX_UPTIME": "7200",
    "_DB_INSTANCE": "devstash-db",
    "_DB_DUMPS_BUCKET": "dumps",
    "_DB_DUMP_OBJECT": "dump.sql",
    "_DB_DUMP_KEEP": "3",
    "_VPC": "devstash-vpc",
    "_BUILD_ID": "build-1",
    "_TRIGGER_NAME": "auto-suspend",
}


def test_parses_a_full_environment() -> None:
    env = BuildEnv.from_environ(_FULL)
    assert env.project_id == "proj"
    assert env.secret_keys == ("openai-api-key", "resend-api-key")
    assert env.idle_window_s == 3600
    assert env.db_dump_keep == 3
    assert env.dump_uri == "gs://dumps/dump.sql"


def test_db_dump_keep_defaults_to_two_when_absent() -> None:
    env = {k: v for k, v in _FULL.items() if k != "_DB_DUMP_KEEP"}
    assert BuildEnv.from_environ(env).db_dump_keep == 2


def test_missing_required_key_raises_naming_it() -> None:
    env = {k: v for k, v in _FULL.items() if k != "_STATE_BUCKET"}
    with pytest.raises(InfraError, match="_STATE_BUCKET"):
        BuildEnv.from_environ(env)


def test_empty_required_value_is_treated_as_missing() -> None:
    with pytest.raises(InfraError, match="_REGION"):
        BuildEnv.from_environ({**_FULL, "_REGION": ""})


def test_non_integer_window_raises() -> None:
    with pytest.raises(InfraError, match=r"_IDLE_WINDOW.*not an integer"):
        BuildEnv.from_environ({**_FULL, "_IDLE_WINDOW": "soon"})


def test_non_integer_dump_keep_raises_naming_it() -> None:
    # [FL-2] a malformed optional _DB_DUMP_KEEP raises the same actionable InfraError as
    # _require_int, not a bare ValueError past the InfraError-only boundary.
    with pytest.raises(InfraError, match=r"_DB_DUMP_KEEP.*not an integer"):
        BuildEnv.from_environ({**_FULL, "_DB_DUMP_KEEP": "many"})
