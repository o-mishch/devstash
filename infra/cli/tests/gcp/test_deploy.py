"""Tests for gcp/deploy.py — dispatch (snapshot → poll for a newer run) + smoke (watch → health).

A `_FakeGh` (subclass of the real client, so the types stay honest) scripts run-id sequences and
records the dispatch/watch calls; a `_FakeTofu` serves the app_domain output. Both the health poll
and the dispatch poll are driven with `gap_s=0.0` so no real time passes.
"""

from collections.abc import Sequence

import pytest

from devstash_infra.clients.gh import Gh
from devstash_infra.clients.tofu import Tofu
from devstash_infra.gcp.deploy import Deploy
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.errors import ClusterUnreachable, InfraError


class _FakeGh(Gh):
    """Scripts latest_deploy_run_id over a sequence; records dispatch/watch/cancel."""

    def __init__(self, *, run_ids: Sequence[str] = (), watch_ok: bool = True) -> None:
        self._run_ids = list(run_ids)
        self._watch_ok = watch_ok
        self.dispatched: list[bool] = []  # one entry per workflow_run, the provision flag
        self.watched: list[str] = []
        self.cancelled: list[str] = []

    def latest_deploy_run_id(self) -> str:
        # Pop the scripted sequence; once exhausted keep returning the final value.
        if len(self._run_ids) > 1:
            return self._run_ids.pop(0)
        return self._run_ids[0] if self._run_ids else ""

    def workflow_run(self, *, provision: bool = False) -> None:
        self.dispatched.append(provision)

    def run_watch(self, run_id: str) -> bool:
        self.watched.append(run_id)
        return self._watch_ok

    def run_cancel(self, run_id: str) -> bool:
        self.cancelled.append(run_id)
        return True


class _FakeTofu(Tofu):
    def __init__(self, outputs: dict[str, str]) -> None:
        self._outputs = outputs

    def output_json(self) -> TofuOutputs:
        return TofuOutputs.model_validate({k: {"value": v} for k, v in self._outputs.items()})


def _deploy(gh: Gh, tofu: Tofu | None = None) -> Deploy:
    return Deploy(gh=gh, tofu=tofu or _FakeTofu({}))


class TestDispatch:
    def test_returns_newly_appeared_run_id(self) -> None:
        # before-snapshot = "10", then a strictly-newer "11" registers → confirmed.
        gh = _FakeGh(run_ids=["10", "11"])
        run_id = _deploy(gh).dispatch(gap_s=0.0)
        assert run_id == "11"
        assert gh.dispatched == [False]  # bare dispatch, no provision flag

    def test_provision_sets_reason_flag(self) -> None:
        gh = _FakeGh(run_ids=["10", "11"])
        _deploy(gh).dispatch(provision=True, gap_s=0.0)
        assert gh.dispatched == [True]

    def test_unconfirmed_run_returns_empty(self, capsys: pytest.CaptureFixture[str]) -> None:
        # The latest id never changes from the before-snapshot → poll times out → "" (non-fatal).
        gh = _FakeGh(run_ids=["10"])
        assert _deploy(gh).dispatch(attempts=2, gap_s=0.0) == ""
        assert "could not confirm" in capsys.readouterr().out


class TestPrintParallelHint:
    def test_includes_watch_line_when_run_id_present(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _deploy(_FakeGh()).print_parallel_hint("applied", "42")
        out = capsys.readouterr().out
        assert "gh run watch 42" in out
        assert "devstash-infra gcp smoke" in out

    def test_omits_watch_line_when_run_id_empty(self, capsys: pytest.CaptureFixture[str]) -> None:
        _deploy(_FakeGh()).print_parallel_hint("up", "")
        out = capsys.readouterr().out
        assert "gh run watch" not in out
        assert "devstash-infra gcp smoke" in out


class TestSmoke:
    def test_healthy_after_run_succeeds(self, capsys: pytest.CaptureFixture[str]) -> None:
        gh = _FakeGh(run_ids=["7"], watch_ok=True)
        tofu = _FakeTofu({"app_domain": "app.example"})
        _deploy(gh, tofu).smoke(health_ok=lambda url: True, gap_s=0.0)
        assert gh.watched == ["7"]
        out = capsys.readouterr().out
        assert "https://app.example/api/health?deep=1" in out
        assert "app is healthy" in out

    def test_no_runs_raises(self) -> None:
        with pytest.raises(InfraError, match="no deploy-gke workflow runs"):
            _deploy(_FakeGh(run_ids=[])).smoke(health_ok=lambda url: True, gap_s=0.0)

    def test_failed_run_raises(self) -> None:
        gh = _FakeGh(run_ids=["7"], watch_ok=False)
        with pytest.raises(InfraError, match="CI workflow failed"):
            _deploy(gh, _FakeTofu({"app_domain": "app.example"})).smoke(
                health_ok=lambda url: True, gap_s=0.0
            )

    def test_missing_app_domain_raises(self) -> None:
        gh = _FakeGh(run_ids=["7"], watch_ok=True)
        with pytest.raises(InfraError, match="app_domain not set"):
            _deploy(gh, _FakeTofu({})).smoke(health_ok=lambda url: True, gap_s=0.0)

    def test_unhealthy_endpoint_times_out(self) -> None:
        gh = _FakeGh(run_ids=["7"], watch_ok=True)
        with pytest.raises(InfraError, match="health check timed out"):
            _deploy(gh, _FakeTofu({"app_domain": "app.example"})).smoke(
                health_ok=lambda url: False, attempts=2, gap_s=0.0
            )


class TestPredispatch:
    def test_pushes_secrets_then_dispatches_provision(self) -> None:
        gh = _FakeGh(run_ids=["10", "11"])
        pushed: list[str] = []
        run_id = _deploy(gh).predispatch(lambda: pushed.append("push"))
        assert pushed == ["push"]  # secrets refreshed BEFORE the dispatch
        assert gh.dispatched == [True]  # provision flag set
        assert run_id == "11"


class TestCancelRunOnError:
    def test_cancels_run_when_block_raises(self, capsys: pytest.CaptureFixture[str]) -> None:
        gh = _FakeGh()
        with pytest.raises(RuntimeError), _deploy(gh).cancel_run_on_error("42", "resume"):
            raise RuntimeError("apply blew up")
        assert gh.cancelled == ["42"]  # orphaned run reaped
        assert "cancelled pre-dispatched CI run 42" in capsys.readouterr().out

    def test_no_cancel_on_clean_exit(self) -> None:
        gh = _FakeGh()
        with _deploy(gh).cancel_run_on_error("42", "resume"):
            pass  # caller took ownership
        assert gh.cancelled == []

    def test_noop_when_run_id_empty(self) -> None:
        gh = _FakeGh()
        with pytest.raises(RuntimeError), _deploy(gh).cancel_run_on_error("", "up"):
            raise RuntimeError("boom")
        assert gh.cancelled == []  # nothing to cancel

    def test_cluster_unreachable_spares_the_run(self) -> None:
        # Reachability timeout: cluster exists, endpoint still propagating → leave the
        # deploy running.
        gh = _FakeGh()
        with pytest.raises(ClusterUnreachable), _deploy(gh).cancel_run_on_error("42", "resume"):
            raise ClusterUnreachable("endpoint not answering yet")
        assert gh.cancelled == []  # NOT cancelled — its own waits may carry it home


class TestWatchRun:
    def test_success_reports_and_returns(self, capsys: pytest.CaptureFixture[str]) -> None:
        gh = _FakeGh(watch_ok=True)
        _deploy(gh).watch_run("42")
        assert gh.watched == ["42"]
        assert "completed successfully" in capsys.readouterr().out

    def test_failure_raises_with_hint(self) -> None:
        gh = _FakeGh(watch_ok=False)
        with pytest.raises(InfraError, match="CI run 42 FAILED"):
            _deploy(gh).watch_run("42")

    def test_unconfirmed_run_warns_and_returns(self, capsys: pytest.CaptureFixture[str]) -> None:
        gh = _FakeGh()
        _deploy(gh).watch_run("")  # no run to watch — manual hint, not fatal
        assert gh.watched == []
        assert "follow it manually" in capsys.readouterr().out
