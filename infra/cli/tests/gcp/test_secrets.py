"""Tests for gcp/secrets.py — the GitHub Actions push + read-back verify.

A `_FakeGh` (subclass of the real client, so the types stay honest) records writes into in-memory
stores and serves them back on read, giving a full push→verify round-trip without touching `gh`.
Tofu outputs are supplied by routing `proc.run` (the Tofu client's only exec path).
"""

import json
from collections.abc import Sequence

import pytest

from devstash_infra.clients.gh import Gh
from devstash_infra.clients.tofu import Tofu
from devstash_infra.gcp.secrets import Secrets
from devstash_infra.shared import proc
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import Result

# The minimal applied-state outputs the push requires (binauthz/armor absent → the $0 dev posture).
_BASE_OUTPUTS: dict[str, str] = {
    "gcp_project_id": "my-proj",
    "deployer_service_account_email": "deployer@my-proj.iam",
    "lifecycle_deployer_service_account_email": "lifecycle@my-proj.iam",
    "wif_provider": "projects/1/locations/global/workloadIdentityPools/p/providers/gh",
    "app_domain": "app.example.com",
    "email_from": "noreply@example.com",
}


class _FakeGh(Gh):
    """In-memory GitHub Actions store — records writes, serves them back on read."""

    def __init__(self, *, authed: bool = True) -> None:
        self._authed = authed
        self.secrets: dict[str, str] = {}
        self.variables: dict[str, str] = {}
        self.deleted_secrets: list[str] = []
        self.deleted_variables: list[str] = []

    def authenticated(self) -> bool:
        return self._authed

    def secret_set(self, name: str, value: str) -> None:
        self.secrets[name] = value

    def secret_delete(self, name: str) -> None:
        self.deleted_secrets.append(name)
        self.secrets.pop(name, None)

    def variable_set(self, name: str, value: str) -> None:
        self.variables[name] = value

    def variable_delete(self, name: str) -> None:
        self.deleted_variables.append(name)
        self.variables.pop(name, None)

    def secret_names(self) -> list[str]:
        return list(self.secrets)

    def variable_value(self, name: str) -> str:
        return self.variables.get(name, "")


def _route_outputs(monkeypatch: pytest.MonkeyPatch, outputs: dict[str, str]) -> None:
    """Make the Tofu client's `output -json` return `outputs` (name → {value})."""
    payload = json.dumps({name: {"value": value} for name, value in outputs.items()})

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        return Result(list(argv), payload, "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)


def _secrets(gh: Gh) -> Secrets:
    return Secrets(gh=gh, tofu=Tofu("tf/dev"))


class TestPush:
    def test_pushes_secrets_and_variables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_outputs(monkeypatch, _BASE_OUTPUTS)
        gh = _FakeGh()
        _secrets(gh).push()

        assert gh.secrets == {
            "DEPLOYER_SA": "deployer@my-proj.iam",
            "LIFECYCLE_DEPLOYER_SA": "lifecycle@my-proj.iam",
            "WORKLOAD_IDENTITY_PROVIDER": _BASE_OUTPUTS["wif_provider"],
        }
        assert gh.variables["GCP_PROJECT_ID"] == "my-proj"
        assert gh.variables["APP_DOMAIN"] == "app.example.com"
        assert gh.variables["EMAIL_FROM"] == "noreply@example.com"
        assert gh.variables["ENABLE_GITHUB_ATTESTATIONS"] == "false"

    def test_deletes_stale_project_id_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # GCP_PROJECT_ID must be a variable, and any stale *secret* copy keeps GitHub masking the
        # image-URI job outputs — so the push always deletes it.
        _route_outputs(monkeypatch, _BASE_OUTPUTS)
        gh = _FakeGh()
        _secrets(gh).push()
        assert "GCP_PROJECT_ID" in gh.deleted_secrets

    def test_optional_toggles_cleared_when_absent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # armor_enabled=false / no binauthz attestor → every optional var is deleted, not set.
        _route_outputs(monkeypatch, _BASE_OUTPUTS)
        gh = _FakeGh()
        _secrets(gh).push()
        for name in (
            "ARMOR_ENABLED",
            "BINAUTHZ_ATTESTOR",
            "BINAUTHZ_KMS_KEYRING",
            "BINAUTHZ_KMS_KEY",
        ):
            assert name in gh.deleted_variables
            assert name not in gh.variables

    def test_armor_enabled_sets_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_outputs(monkeypatch, {**_BASE_OUTPUTS, "armor_enabled": "true"})
        gh = _FakeGh()
        _secrets(gh).push()
        assert gh.variables["ARMOR_ENABLED"] == "true"

    def test_binauthz_outputs_set_when_attestor_present(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _route_outputs(
            monkeypatch,
            {
                **_BASE_OUTPUTS,
                "binauthz_attestor_name": "projects/p/attestors/a",
                "binauthz_kms_keyring": "kr",
                "binauthz_kms_key": "k",
            },
        )
        gh = _FakeGh()
        _secrets(gh).push()
        assert gh.variables["BINAUTHZ_ATTESTOR"] == "projects/p/attestors/a"
        assert gh.variables["BINAUTHZ_KMS_KEYRING"] == "kr"
        assert gh.variables["BINAUTHZ_KMS_KEY"] == "k"


class TestPushGates:
    def test_unauthenticated_raises_before_any_write(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_outputs(monkeypatch, _BASE_OUTPUTS)
        gh = _FakeGh(authed=False)
        with pytest.raises(InfraError, match="not authenticated"):
            _secrets(gh).push()
        assert gh.secrets == {}  # aborted before writing

    def test_missing_required_output_raises_before_any_write(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        incomplete = {k: v for k, v in _BASE_OUTPUTS.items() if k != "wif_provider"}
        _route_outputs(monkeypatch, incomplete)
        gh = _FakeGh()
        with pytest.raises(InfraError, match="wif_provider"):
            _secrets(gh).push()
        assert gh.secrets == {}

    def test_attestor_present_but_kms_missing_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_outputs(
            monkeypatch, {**_BASE_OUTPUTS, "binauthz_attestor_name": "projects/p/attestors/a"}
        )
        gh = _FakeGh()
        with pytest.raises(InfraError, match="binauthz_kms_keyring"):
            _secrets(gh).push()


class TestVerify:
    def test_missing_secret_after_push_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A silent write no-op: the store drops a required secret, so the read-back gate fires.
        _route_outputs(monkeypatch, _BASE_OUTPUTS)

        class _DropGh(_FakeGh):
            def secret_set(self, name: str, value: str) -> None:
                if name != "WORKLOAD_IDENTITY_PROVIDER":  # this one silently fails to land
                    super().secret_set(name, value)

        gh = _DropGh()
        with pytest.raises(InfraError, match=r"1 secret.*not confirmed"):
            _secrets(gh).push()

    def test_missing_variable_warns_not_raises(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _route_outputs(monkeypatch, _BASE_OUTPUTS)

        class _DropVarGh(_FakeGh):
            def variable_set(self, name: str, value: str) -> None:
                if name != "EMAIL_FROM":  # this one silently fails to land
                    super().variable_set(name, value)

        gh = _DropVarGh()
        _secrets(gh).push()  # must NOT raise — the push already reported success
        assert "EMAIL_FROM variable not found" in capsys.readouterr().out
