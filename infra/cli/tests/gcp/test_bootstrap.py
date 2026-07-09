"""Tests for gcp/bootstrap.py — the pre-`tofu init` GCP prerequisite collaborator.

No bats peer exists (bootstrap has no incident fix), so these cover the logic-bearing branches:
billing resolution (already-linked / override / first-open / none→raise), the state-bucket
create-vs-harden split, the confirm gate (decline → Aborted), and the full-order orchestration.

Post-re-architecture the collaborator drives the typed `Gcloud` client, so the seam under test is
the client, not `proc.run`. A recording fake `Gcloud` captures which client methods fire (argv
itself is asserted in tests/clients/test_gcloud.py — the one parity anchor); these assert the
BRANCHING (which method, in what order, with which value).
"""

from collections.abc import Callable

import pytest

from devstash_infra.gcp import bootstrap
from devstash_infra.gcp.bootstrap import Bootstrap
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.shared.errors import Aborted, InfraError

_CONFIG = GcpConfig(
    project="proj",
    region="us-central1",
    environment="dev",
    db_name="devstash",
    state_bucket="proj-tfstate-dev",
)
_LIFECYCLE = "/data/tfstate-lifecycle.json"


class _FakeAuth:
    def __init__(self, *, account: str = "me@example.com", adc: bool = True) -> None:
        self._account = account
        self._adc = adc
        self.calls: list[str] = []

    def active_account(self) -> str:
        return self._account

    def login(self) -> None:
        self.calls.append("login")

    def adc_present(self) -> bool:
        return self._adc

    def adc_login(self) -> None:
        self.calls.append("adc_login")


class _FakeConfig:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def set_active_project(self) -> None:
        self.calls.append("set_active_project")


class _FakeProjects:
    def __init__(self, *, exists: bool = True) -> None:
        self._exists = exists
        self.calls: list[str] = []

    def exists(self) -> bool:
        return self._exists

    def create(self, *, name: str) -> None:
        self.calls.append(f"create:{name}")


class _FakeBilling:
    def __init__(self, *, linked: bool = False, first_open: str = "") -> None:
        self._linked = linked
        self._first_open = first_open
        self.calls: list[str] = []

    def is_linked(self) -> bool:
        return self._linked

    def first_open_account(self) -> str:
        return self._first_open

    def link(self, account: str) -> None:
        self.calls.append(f"link:{account}")


class _FakeServices:
    def __init__(self) -> None:
        self.enabled: tuple[str, ...] = ()

    def enable(self, apis: tuple[str, ...]) -> None:
        self.enabled = tuple(apis)


class _FakeStorage:
    def __init__(self, *, bucket: bool = True) -> None:
        self._bucket = bucket
        self.calls: list[str] = []

    def bucket_exists(self, uri: str) -> bool:
        return self._bucket

    def create_bucket(self, uri: str, *, location: str) -> None:
        self.calls.append(f"create:{uri}:{location}")

    def harden_bucket(self, uri: str) -> None:
        self.calls.append(f"harden:{uri}")

    def set_bucket_lifecycle(self, uri: str, *, lifecycle_file: str) -> None:
        self.calls.append(f"lifecycle:{uri}:{lifecycle_file}")


class _FakeGcloud:
    """A recording stand-in for `Gcloud` — the collaborator's only outbound seam.

    Defaults keep every step in its no-op branch (account + ADC present, project + bucket exist,
    billing already linked) so `run()` reaches the end; each test flips ONE default to drive the
    branch it asserts, then reads that sub-facade's recorded calls.
    """

    def __init__(
        self,
        *,
        account: str = "me@example.com",
        adc: bool = True,
        project_exists: bool = True,
        billing_linked: bool = True,
        first_open: str = "",
        bucket_exists: bool = True,
    ) -> None:
        self.auth = _FakeAuth(account=account, adc=adc)
        self.config = _FakeConfig()
        self.projects = _FakeProjects(exists=project_exists)
        self.billing = _FakeBilling(linked=billing_linked, first_open=first_open)
        self.services = _FakeServices()
        self.storage = _FakeStorage(bucket=bucket_exists)


def _noop() -> None:
    """A do-nothing ensure_tfvars stub."""


def _accept(*_a: object, **_k: object) -> bool:
    return True


def _decline(*_a: object, **_k: object) -> bool:
    return False


def _run(
    monkeypatch: pytest.MonkeyPatch,
    gcloud: _FakeGcloud,
    *,
    billing_account: str = "",
    ensure_tfvars: Callable[[], None] = _noop,
    accept: bool = True,
) -> None:
    """Drive the collaborator through its PUBLIC entry (`run`), so tests never touch a private
    step — the whole sequence runs and each test asserts on the one sub-facade it cares about.
    """
    monkeypatch.setattr(bootstrap, "confirm", _accept if accept else _decline)
    Bootstrap(
        config=_CONFIG,
        gcloud=gcloud,  # type: ignore[arg-type]  # structural stand-in for Gcloud
        ensure_tfvars=ensure_tfvars,
        state_lifecycle=_LIFECYCLE,
        billing_account=billing_account,
    ).run(auto_approve=True)


# ── billing resolution ────────────────────────────────────────────────────────
class TestBilling:
    def test_already_linked_skips_link(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(billing_linked=True)
        _run(monkeypatch, gcloud)
        assert gcloud.billing.calls == []

    def test_override_account_is_linked(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(billing_linked=False)
        _run(monkeypatch, gcloud, billing_account="012345-ABCDEF-678901")
        assert gcloud.billing.calls == ["link:012345-ABCDEF-678901"]

    def test_falls_back_to_first_open_account(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(billing_linked=False, first_open="billingAccounts/AAA")
        _run(monkeypatch, gcloud)
        assert gcloud.billing.calls == ["link:billingAccounts/AAA"]

    def test_no_account_available_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(billing_linked=False, first_open="")
        with pytest.raises(InfraError):
            _run(monkeypatch, gcloud)


# ── project + auth branches ───────────────────────────────────────────────────
class TestProjectAndAuth:
    def test_absent_project_is_created_then_selected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(project_exists=False)
        _run(monkeypatch, gcloud)
        assert gcloud.projects.calls == ["create:DevStash"]
        assert gcloud.config.calls == ["set_active_project"]

    def test_existing_project_is_only_selected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(project_exists=True)
        _run(monkeypatch, gcloud)
        assert gcloud.projects.calls == []
        assert gcloud.config.calls == ["set_active_project"]

    def test_missing_account_triggers_login(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(account="")
        _run(monkeypatch, gcloud)
        assert gcloud.auth.calls == ["login"]

    def test_missing_adc_triggers_adc_login(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(adc=False)
        _run(monkeypatch, gcloud)
        assert gcloud.auth.calls == ["adc_login"]


# ── state bucket ──────────────────────────────────────────────────────────────
class TestStateBucket:
    def test_existing_bucket_hardened_not_created(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(bucket_exists=True)
        _run(monkeypatch, gcloud)
        assert gcloud.storage.calls == [
            "harden:gs://proj-tfstate-dev",
            f"lifecycle:gs://proj-tfstate-dev:{_LIFECYCLE}",
        ]

    def test_absent_bucket_created_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(bucket_exists=False)
        _run(monkeypatch, gcloud)
        assert gcloud.storage.calls[0] == "create:gs://proj-tfstate-dev:us-central1"


# ── APIs ──────────────────────────────────────────────────────────────────────
class TestApis:
    def test_enables_the_full_data_list_in_one_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud()
        _run(monkeypatch, gcloud)
        assert gcloud.services.enabled == bootstrap.REQUIRED_APIS


# ── orchestration + gate ──────────────────────────────────────────────────────
class TestRun:
    def test_confirm_decline_aborts_before_gcp(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gcloud = _FakeGcloud(account="")
        with pytest.raises(Aborted):
            _run(monkeypatch, gcloud, accept=False)
        assert gcloud.auth.calls == []  # _auth never ran

    def test_ensure_tfvars_runs_before_any_gcp_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        order: list[str] = []

        def _record_login() -> None:
            order.append("gcloud")

        def _record_tfvars() -> None:
            order.append("tfvars")

        gcloud = _FakeGcloud(account="")  # missing account → login is the first gcloud call
        gcloud.auth.login = _record_login  # type: ignore[method-assign]
        _run(monkeypatch, gcloud, ensure_tfvars=_record_tfvars)
        assert order[0] == "tfvars"
        assert "gcloud" in order  # a real client call followed
