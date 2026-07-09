"""Tests for ci/operators.py — the single-source ESO/Reloader install.

Two layers: (1) fake-client unit tests for the skip-guard, the failure-policy resolver, and the
parallel `ensure_operators` join; (2) ONE real-`Helm` + fake_process test that pins the exact argv
of an ESO install — proving the Autopilot `--set` block renders in order through the ensure-* path
(the deploy-critical parity assertion).
"""

from collections.abc import Mapping

import pytest

from devstash_infra.ci.operators import (
    ESO,
    ensure_operator,
    ensure_operators,
    helm_failure_policy,
)
from devstash_infra.clients.helm import Helm, HelmFailurePolicy
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError, Result
from devstash_infra.versions import Versions
from tests.conftest import ExpectFn


class _FakeHelm:
    """Records repos + installs; scripts `deployed_chart`; can fail chosen releases' installs."""

    def __init__(
        self, *, deployed: Mapping[str, str] | None = None, fail: frozenset[str] = frozenset()
    ) -> None:
        self._deployed = dict(deployed or {})
        self._fail = fail
        self.repos: list[str] = []
        self.installs: list[tuple[str, str]] = []

    def deployed_chart(self, release: str, *, namespace: str) -> str:
        return self._deployed.get(release, "")

    def refresh_repo(self, name: str, url: str) -> None:
        self.repos.append(name)

    def upgrade_install(
        self,
        release: str,
        chart: str,
        *,
        namespace: str,
        version: str,
        sets: Mapping[str, str],
        failure_policy: HelmFailurePolicy,
        timeout: str,
    ) -> None:
        self.installs.append((release, version))
        if release in self._fail:
            raise ProcError(Result(["helm"], "", "boom", 1))


def _helm(fake: _FakeHelm) -> Helm:
    return fake  # type: ignore[return-value]


class TestEnsureOperator:
    def test_installs_when_absent(self) -> None:
        fake = _FakeHelm()  # nothing deployed
        installed = ensure_operator(ESO, "2.7.0", helm=_helm(fake), failure_policy="--atomic")
        assert installed is True
        assert fake.repos == ["external-secrets"]
        assert fake.installs == [("external-secrets", "2.7.0")]

    def test_skips_when_already_at_pinned_version(self) -> None:
        fake = _FakeHelm(deployed={"external-secrets": "external-secrets-2.7.0"})
        installed = ensure_operator(ESO, "2.7.0", helm=_helm(fake), failure_policy="--atomic")
        assert installed is False
        assert fake.repos == []  # skip-guard short-circuits before the repo refresh
        assert fake.installs == []

    def test_reinstalls_when_deployed_version_differs(self) -> None:
        fake = _FakeHelm(deployed={"external-secrets": "external-secrets-2.6.0"})  # stale
        assert ensure_operator(ESO, "2.7.0", helm=_helm(fake), failure_policy="--atomic") is True
        assert fake.installs == [("external-secrets", "2.7.0")]


class TestHelmFailurePolicy:
    def test_defaults_to_atomic(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("HELM_FAILURE_POLICY", raising=False)
        assert helm_failure_policy() == "--atomic"

    def test_reads_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HELM_FAILURE_POLICY", "--rollback-on-failure")
        assert helm_failure_policy() == "--rollback-on-failure"

    def test_rejects_unknown_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HELM_FAILURE_POLICY", "--yolo")
        with pytest.raises(InfraError):
            helm_failure_policy()


class TestEnsureOperators:
    _VERSIONS = Versions(eso="2.7.0", reloader="2.2.14")

    def test_installs_both_in_parallel(self) -> None:
        fake = _FakeHelm()
        ensure_operators(self._VERSIONS, helm=_helm(fake), failure_policy="--atomic")
        # Order is non-deterministic (two threads) — assert the set of installs.
        assert sorted(fake.installs) == [("external-secrets", "2.7.0"), ("reloader", "2.2.14")]

    def test_raises_naming_the_failed_operator_and_still_runs_both(self) -> None:
        fake = _FakeHelm(fail=frozenset({"reloader"}))
        with pytest.raises(InfraError, match="Stakater Reloader"):
            ensure_operators(self._VERSIONS, helm=_helm(fake), failure_policy="--atomic")
        # Both were attempted despite the reloader failure (join waits on both, like the shell).
        assert sorted(r for r, _ in fake.installs) == ["external-secrets", "reloader"]


class TestEsoInstallArgvParity:
    """Real Helm client + fake_process: exact ESO install argv (Autopilot --set block, ordered)."""

    def test_eso_upgrade_argv(self, expect: ExpectFn) -> None:
        expect(
            ["helm", "list", "-n", "external-secrets", "-o", "json"], stdout="[]"
        )  # not deployed
        expect(["helm", "repo", "add", "external-secrets", ESO.repo_url])
        expect(["helm", "repo", "update", "external-secrets"])
        upgrade = [
            "helm", "upgrade", "--install", "external-secrets", "external-secrets/external-secrets",
            "-n", "external-secrets", "--create-namespace", "--wait", "--timeout", "5m",
            "--atomic", "--version", "2.7.0",
            "--set", "resources.requests.cpu=50m",
            "--set", "resources.requests.memory=128Mi",
            "--set", "certController.resources.requests.cpu=50m",
            "--set", "certController.resources.requests.memory=128Mi",
            "--set", "webhook.resources.requests.cpu=50m",
            "--set", "webhook.resources.requests.memory=128Mi",
        ]  # fmt: skip
        expect(upgrade)

        assert ensure_operator(ESO, "2.7.0", helm=Helm(), failure_policy="--atomic") is True
