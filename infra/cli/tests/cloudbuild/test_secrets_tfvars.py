"""Tests for cloudbuild/secrets_tfvars.py — the auto-suspend secrets tfvars assembler."""

import pytest

from devstash_infra.cloudbuild.secrets_tfvars import build_secrets_tfvars

_APP = {
    "openai-api-key": "sk-1",
    "resend-api-key": "re-2",
    "database-url": "postgres://…",  # a TF-minted infra key — must NOT be extracted
}


def test_extracts_only_the_named_third_party_keys() -> None:
    out = build_secrets_tfvars(_APP, None, ["openai-api-key", "resend-api-key"])
    assert out == {"third_party_secrets": {"openai-api-key": "sk-1", "resend-api-key": "re-2"}}


def test_folds_spaceship_creds_when_ops_blob_present() -> None:
    ops = {"spaceship-api-key": "key-x", "spaceship-api-secret": "sec-y"}
    out = build_secrets_tfvars(_APP, ops, ["openai-api-key"])
    assert out == {
        "third_party_secrets": {"openai-api-key": "sk-1"},
        "spaceship_api_key": "key-x",
        "spaceship_api_secret": "sec-y",
    }


def test_omits_absent_or_empty_spaceship_creds() -> None:
    assert "spaceship_api_key" not in build_secrets_tfvars(_APP, {}, ["openai-api-key"])
    ops = {"spaceship-api-key": "", "spaceship-api-secret": "sec-y"}  # empty key omitted
    out = build_secrets_tfvars(_APP, ops, ["openai-api-key"])
    assert "spaceship_api_key" not in out
    assert out["spaceship_api_secret"] == "sec-y"


def test_missing_required_key_raises_keyerror() -> None:
    # A required key absent from the blob must fail the build, not drop silently.
    with pytest.raises(KeyError):
        build_secrets_tfvars(_APP, None, ["openai-api-key", "not-in-blob"])
