"""Tests for ci/validate_inputs.py — the pre-deploy required-input guard."""

import pytest

from devstash_infra.ci.validate_inputs import validate_inputs
from devstash_infra.shared.errors import InfraError

_VALID = {
    "project_id": "proj",
    "wif_provider": "projects/1/locations/global/workloadIdentityPools/p/providers/gh",
    "deployer_sa": "deployer@proj.iam.gserviceaccount.com",
    "app_domain": "app.example.com",
}


def test_full_valid_inputs_pass() -> None:
    validate_inputs(**_VALID)  # no raise


@pytest.mark.parametrize("missing", ["project_id", "wif_provider", "deployer_sa", "app_domain"])
def test_missing_required_input_raises(missing: str) -> None:
    args = {**_VALID, missing: ""}
    with pytest.raises(InfraError, match="required GitHub deployment input is missing"):
        validate_inputs(**args)


def test_all_binauthz_set_passes() -> None:
    validate_inputs(**_VALID, binauthz_attestor="a", binauthz_keyring="kr", binauthz_key="k")


def test_partial_binauthz_raises() -> None:
    with pytest.raises(InfraError, match=r"partially configured.*BINAUTHZ_KMS_KEY"):
        validate_inputs(**_VALID, binauthz_attestor="a", binauthz_keyring="kr")  # key missing


@pytest.mark.parametrize(
    "bad", ["https://app.example.com", "App.Example.Com", "nodots", "app.example.com/path"]
)
def test_bad_app_domain_raises(bad: str) -> None:
    with pytest.raises(InfraError, match="APP_DOMAIN must be a lowercase hostname"):
        validate_inputs(**{**_VALID, "app_domain": bad})
