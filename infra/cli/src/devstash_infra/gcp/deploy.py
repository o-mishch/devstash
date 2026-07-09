"""gcp/deploy.py — dispatch the deploy-gke CI workflow, then smoke-test the rollout.

CLI zone (3.14). Ports run.sh's `deploy()` + `smoke()` + the shared `_latest_deploy_run_id` /
`_print_parallel_deploy_hint` helpers — the operator-facing "trigger the deploy, follow it, verify
health" verbs. A `Deploy` COLLABORATOR over the typed `Gh` + `Tofu` clients.

The deploy-gke workflow (not this CLI) does the actual build → push → migrate → rollout; `deploy`
only DISPATCHES it and confirms the new run id, because `gh workflow run` does not return the id of
the run it starts. So `dispatch` snapshots the newest existing run id BEFORE dispatch and polls for
a strictly-newer one to appear (GitHub takes a few seconds to register it), returning that id so a
caller (resume/up overlap) can watch it directly instead of racing to re-discover "the latest run"
later. `smoke` waits out the whole run, then polls the public health endpoint through the L7 LB.
"""

import contextlib
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Protocol

from devstash_infra.clients.health import deep_health_ok
from devstash_infra.common import log, ok, poll_until, warn
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.errors import ClusterUnreachable, InfraError

# deploy(): wait ≤1 min (12 × 5s) for the dispatched run to register. smoke(): wait ≤2 min
# (12 × 10s) for the health endpoint — the cert may still be provisioning on a first bring-up.
_DISPATCH_ATTEMPTS = 12
_DISPATCH_GAP_S = 5.0
_SMOKE_ATTEMPTS = 12
_SMOKE_GAP_S = 10.0


class _Gh(Protocol):
    """The deploy-gke run controls Deploy drives — the `Gh` subset it depends on (structural).

    A consumer-owned interface (ISP): the real `Gh` client and the test fakes satisfy it by shape,
    so nothing subclasses `Gh` to be injected here.
    """

    def latest_deploy_run_id(self) -> str: ...
    def workflow_run(self, *, provision: bool = False) -> None: ...
    def run_watch(self, run_id: str) -> bool: ...
    def run_cancel(self, run_id: str) -> bool: ...


class _Tofu(Protocol):
    """The `Tofu` subset Deploy reads — just the outputs (for `app_domain`)."""

    def output_json(self) -> TofuOutputs: ...


@dataclass(frozen=True)
class Deploy:
    """Dispatch + smoke-test the deploy-gke workflow over the `Gh` + `Tofu` clients (protocols)."""

    gh: _Gh
    tofu: _Tofu
    clock: Clock = SYSTEM_CLOCK

    def dispatch(
        self,
        *,
        provision: bool = False,
        attempts: int = _DISPATCH_ATTEMPTS,
        gap_s: float = _DISPATCH_GAP_S,
    ) -> str:
        """Dispatch deploy-gke.yml and return the new run's id, or "" if it couldn't be confirmed.

        Ports `deploy()`. `provision=True` tells CI's gate job to build even though the cluster
        does not exist yet (a resume/up pre-dispatch overlapping `apply`). The newest run id is
        snapshotted before dispatch; `poll_until` then waits for a strictly-newer one. A "" return
        is non-fatal (the run may still be running — operator follows it), like the shell's warn.
        """
        before_id = self.gh.latest_deploy_run_id()
        self.gh.workflow_run(provision=provision)

        confirmed = ""

        def _new_run_appeared() -> bool:
            nonlocal confirmed
            latest = self.gh.latest_deploy_run_id()
            if latest and latest != before_id:
                confirmed = latest
                return True
            return False

        log(
            "Triggering the deploy-gke CI workflow "
            "(build web+migrate → push → apply -k → migrate Job → rollout)"
        )

        if not poll_until(
            _new_run_appeared, attempts=attempts, gap_seconds=gap_s, clock=self.clock
        ):
            warn("dispatched, but could not confirm the new run ID — follow it with: gh run watch")
            return ""
        ok(f"dispatched — run {confirmed} — follow it with:  gh run watch {confirmed}")
        return confirmed

    def predispatch(self, push_secrets: Callable[[], None]) -> str:
        """Refresh CI auth secrets, then pre-dispatch the deploy build.

        Ports `_predispatch_ci_build`. The shared "pre-dispatch the deploy so its
        cluster-independent build-push job overlaps apply" step used identically by
        up/resume/apply-with-overlap. CI authenticates to GCP with the WIF/DEPLOYER_SA GitHub
        secrets, so `push_secrets` (the `Secrets.push` bound method) MUST run first to refresh them
        against the current tofu outputs before the just-dispatched run tries to authenticate.
        `provision=True` tells CI's gate job to build even though the cluster does not exist yet
        (mid-provision). ONLY call when the outputs `secrets` reads exist — callers gate on it.
        Returns the dispatched run id (or "" if unconfirmed) for the watch + the cancel trap.
        Takes the `push` callable, not the whole `Secrets`, to stay decoupled from it.
        """
        push_secrets()
        return self.dispatch(provision=True)

    @contextlib.contextmanager
    def cancel_run_on_error(self, run_id: str, phase: str) -> Generator[None]:
        """Cancel the pre-dispatched CI run if the wrapped bring-up raises.

        Ports `_arm_ci_cancel_trap`. Both up() and resume() dispatch the build, then run the
        apply/wire steps that provision the infra the build will deploy onto. If any of those steps
        raises, the orphaned run is left compiling against infra that will never finish provisioning
        — so this context manager cancels it on the way out. On a clean exit it does nothing: the
        caller takes ownership and watches the run itself. A "" `run_id` (dispatch couldn't
        confirm the id) makes cancel a no-op — nothing to cancel. The Python context manager
        replaces the shell's fragile EXIT trap: scope is lexical (the `with` block), so there is no
        trap to clear before watching.

        ONE exception is spared: a `ClusterUnreachable` reachability TIMEOUT is re-raised WITHOUT
        cancelling. The cluster exists and its endpoint is still propagating (the DNS gap), so
        the pre-dispatched deploy is LEFT RUNNING — its own waits may still carry it home.
        This mirrors the shell clearing the EXIT trap before dying on a reachability timeout.
        """
        try:
            yield
        except ClusterUnreachable:
            raise  # endpoint still propagating — leave the pre-dispatched deploy running
        except BaseException:
            if run_id:
                self.gh.run_cancel(run_id)  # tolerant of an already-finished run
                warn(f"{phase} failed — cancelled pre-dispatched CI run {run_id}")
            raise

    def watch_run(self, run_id: str) -> None:
        """Block on the dispatched run and surface pass/fail here. Ports `_watch_ci_run`.

        A resume that merely kicks CI off and returns "done" hides a hung/failed build behind a
        healthy-looking cluster (ESO/Reloader up, but no devstash-web Deployment until the run's
        rollout step lands) — so this takes ownership of the run and blocks on it. Called AFTER the
        `cancel_run_on_error` block has exited normally, so a failure here does NOT cancel the run
        we just watched fail (the watch already reported it). No confirmed run id → warn + manual
        hint (not fatal). CI failure → `InfraError` with the fix-forward hint.
        """
        if not run_id:
            warn("could not confirm the dispatched run — follow it manually:  gh run watch")
            return
        log(
            f"Watching deploy-gke run {run_id} "
            "(build+push has its own retry/timeout — see deploy-gke.yml)"
        )
        if self.gh.run_watch(run_id):
            ok(f"CI run {run_id} completed successfully — devstash-web is rolled out")
            log("Next: devstash-infra gcp smoke   # health-check the live app")
            return
        raise InfraError(
            f"CI run {run_id} FAILED — devstash-web is not deployed",
            hint=(
                f"inspect: gh run view {run_id} --log-failed  ·  "
                "re-run once fixed: devstash-infra gcp deploy"
            ),
        )

    def print_parallel_hint(self, infra_word: str, run_id: str) -> None:
        """The "infra is wired, the deploy is building in parallel, here's how to follow it" block.

        Ports `_print_parallel_deploy_hint` — printed identically by up()/resume() (only the verb
        differs, "up" vs "applied"). `run_id` may be "" if the dispatch couldn't confirm it, in
        which case the `gh run watch` line is omitted (the smoke line still stands).
        """
        log(
            f"Infra {infra_word} and the app deploy is building/rolling out in parallel. Follow it:"
        )
        if run_id:
            ok(f"gh run watch {run_id}   # build → migrate → rollout")
        ok("devstash-infra gcp smoke   # wait for CI + verify health endpoint")

    def smoke(
        self,
        *,
        health_ok: Callable[[str], bool] = deep_health_ok,
        attempts: int = _SMOKE_ATTEMPTS,
        gap_s: float = _SMOKE_GAP_S,
    ) -> None:
        """Wait for the latest deploy-gke run to finish, then verify the public health endpoint.

        Ports `smoke()`. Pins to the most recent run so it doesn't watch some other workflow that
        fired around the same time; a failed run or an unreachable endpoint raises. The endpoint
        poll goes through the L7 LB (`/api/health?deep=1`) — a cold first bring-up can sit here
        while the cert provisions. `health_ok` is injected so tests poll without real HTTP.
        """
        log("Waiting for the latest deploy-gke workflow run to finish")
        run_id = self.gh.latest_deploy_run_id()
        if not run_id:
            raise InfraError("no deploy-gke workflow runs found")
        if not self.gh.run_watch(run_id):
            raise InfraError(f"CI workflow failed — check: gh run view {run_id}")
        ok(f"CI run {run_id} completed successfully")

        domain = self.tofu.output_json().value("app_domain")
        if not domain:
            raise InfraError("app_domain not set — run 'apply' first")

        url = f"https://{domain}/api/health?deep=1"
        log(f"Health check: {url}")
        if poll_until(
            lambda: health_ok(url), attempts=attempts, gap_seconds=gap_s, clock=self.clock
        ):
            ok("app is healthy")
        else:
            raise InfraError("health check timed out after 2 min — cert may still be provisioning")
