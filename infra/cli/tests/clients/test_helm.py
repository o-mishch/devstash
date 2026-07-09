"""Tests for clients/helm.py — argv-parity + the tolerant search/list JSON parses.

Every method's exact argv is asserted (the parity contract the ensure-*.sh scripts encode), plus
the two `--output json` parses: newest-chart-version and deployed-release-chart, including their
empty/absent fallbacks.
"""

from collections.abc import Sequence

import pytest

from devstash_infra.clients.helm import Helm
from devstash_infra.shared import proc
from devstash_infra.shared.proc import Result


def _route(monkeypatch: pytest.MonkeyPatch, *, ok: bool = True, out: str = "") -> list[list[str]]:
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        return Result(args, out, "", 0 if ok else 1)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


class TestRefreshRepo:
    def test_argv_is_add_then_update(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Helm().refresh_repo("external-secrets", "https://charts.external-secrets.io")
        assert calls == [
            ["helm", "repo", "add", "external-secrets", "https://charts.external-secrets.io"],
            ["helm", "repo", "update", "external-secrets"],
        ]


class TestLatestChartVersion:
    def test_argv_and_newest_version(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out='[{"version": "0.20.0"}, {"version": "0.19.0"}]')
        assert Helm().latest_chart_version("external-secrets/external-secrets") == "0.20.0"
        assert calls == [
            ["helm", "search", "repo", "external-secrets/external-secrets", "--output", "json"]
        ]

    def test_empty_result_is_blank(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, out="[]")
        assert Helm().latest_chart_version("stakater/reloader") == ""

    def test_failed_search_is_blank(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, ok=False)
        assert Helm().latest_chart_version("stakater/reloader") == ""


class TestDeployedChart:
    _LIST = (
        '[{"name": "external-secrets", "status": "deployed", "chart": "external-secrets-0.20.0"}]'
    )

    def test_argv_and_deployed_chart(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch, out=self._LIST)
        chart = Helm().deployed_chart("external-secrets", namespace="external-secrets")
        assert chart == "external-secrets-0.20.0"
        assert calls == [["helm", "list", "-n", "external-secrets", "-o", "json"]]

    def test_non_deployed_release_is_blank(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(
            monkeypatch,
            out='[{"name": "reloader", "status": "pending-upgrade", "chart": "reloader-1.0.0"}]',
        )
        assert Helm().deployed_chart("reloader", namespace="reloader") == ""

    def test_empty_list_is_blank(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route(monkeypatch, out="[]")
        assert Helm().deployed_chart("reloader", namespace="reloader") == ""


class TestUpgradeInstall:
    def test_full_argv_with_ordered_sets(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Helm().upgrade_install(
            "external-secrets",
            "external-secrets/external-secrets",
            namespace="external-secrets",
            version="0.20.0",
            sets={
                "resources.requests.cpu": "50m",
                "resources.requests.memory": "128Mi",
            },
        )
        assert calls == [
            [
                "helm",
                "upgrade",
                "--install",
                "external-secrets",
                "external-secrets/external-secrets",
                "-n",
                "external-secrets",
                "--create-namespace",
                "--wait",
                "--timeout",
                "5m",
                "--atomic",
                "--version",
                "0.20.0",
                "--set",
                "resources.requests.cpu=50m",
                "--set",
                "resources.requests.memory=128Mi",
            ]
        ]

    def test_failure_policy_override_is_rendered(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _route(monkeypatch)
        Helm().upgrade_install(
            "reloader",
            "stakater/reloader",
            namespace="reloader",
            version="1.0.0",
            sets={},
            failure_policy="--rollback-on-failure",
        )
        assert "--rollback-on-failure" in calls[0]
        assert "--atomic" not in calls[0]
