"""gcp/state_recovery.py — guided, interactive recovery for a STUCK OpenTofu state lock. CLI zone.

Port of run.sh's `_recover_state_lock` + the three holder probes + the `unlock` verb. Safety rule
[#1]: NEVER force-break a lock whose holder could still be alive. Read the `.tflock` blob, probe the
three holder categories (an ongoing auto-suspend Cloud Build, the pre-dispatched deploy-gke GH run,
a local `tofu`/`terraform` PID), offer to kill each, and release ONLY when every identified holder
is confirmed dead — or, interactively, when the operator explicitly overrides the "release anyway?"
gate. Under `AUTO_APPROVE=1` an unconfirmed/live holder REFUSES outright (never auto-releases). The
state bucket has versioning on, so a mistaken release is recoverable — the net that makes this safe.

Every OS-facing seam (hostname, the pgrep, `os.kill`, liveness, sleep) is injected so the whole
recovery tests with fakes — no real process signalling. Force-unlock addresses the lock by the GCS
object GENERATION [#1], never the JSON "ID" UUID (gcs rejects the UUID as non-numeric).
"""

import contextlib
import os
import signal
import socket
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.gh import Gh
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import confirm, ok, warn
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.models.tofu import TfLock
from devstash_infra.shared import proc
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.proc import ProcError

_STATE_PREFIX = (
    "gke/dev"  # run.sh STATE_PREFIX (the gcs backend prefix); lock is <prefix>/default.tflock
)


class _Verdict(Enum):
    """A probe's contribution to `holder_alive` (mirrors the shell's set0/set1/keep)."""

    DEAD = "dead"  # positively confirmed dead/absent/killed → holder_alive = False
    ALIVE = "alive"  # a holder survives or the operator declined to kill → holder_alive = True
    KEEP = "keep"  # this category absent/not-applicable → leave holder_alive untouched


@dataclass(frozen=True)
class _Probe:
    """One holder-probe outcome: did it identify its category, and its liveness verdict."""

    identified: bool
    verdict: _Verdict


def _pgrep_tofu(tf_dir: str) -> list[int]:
    """PIDs of local `tofu`/`terraform` processes touching `tf_dir` (`pgrep -f`; tolerant → [])."""
    result = proc.run(["pgrep", "-f", f"(tofu|terraform).*{tf_dir}"], check=False)
    return [int(line) for line in result.out.split() if line.isdigit()] if result.ok else []


def _pid_alive(pid: int) -> bool:
    """True iff `pid` exists (kill(pid, 0) probes liveness without signalling)."""
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


@dataclass(frozen=True)
class StateLockRecovery:
    """Interactive `_recover_state_lock` over Gcloud + Gh + Tofu — the `unlock` verb's engine."""

    config: GcpConfig
    gcloud: Gcloud
    gh: Gh
    tofu: Tofu
    deploy_run_id: str = ""  # DEPLOY_RUN_ID — the pre-dispatched deploy-gke run, if any
    auto_approve: bool = False
    hostname: Callable[[], str] = socket.gethostname
    list_pids: Callable[[str], list[int]] = _pgrep_tofu
    pid_alive: Callable[[int], bool] = _pid_alive
    kill: Callable[[int, int], None] = os.kill
    clock: Clock = SYSTEM_CLOCK

    @property
    def _lock_uri(self) -> str:
        return f"gs://{self.config.state_bucket}/{_STATE_PREFIX}/default.tflock"

    def recover(self) -> bool:
        """Run the guided recovery; return True iff the lock was released (or was already gone)."""
        blob = self.gcloud.storage.cat(self._lock_uri)
        if not blob:
            ok("No .tflock object present — the lock is already released (nothing to recover).")
            return True
        lock = _parse_lock(blob)
        _describe(lock)

        probes = [self._probe_build(), self._probe_gh_run(), self._probe_local_pid(lock.host)]
        holder_alive = True  # "unknown, assume alive" — only a positive DEAD verdict clears it
        for probe in probes:
            if probe.verdict is _Verdict.DEAD:
                holder_alive = False
            elif probe.verdict is _Verdict.ALIVE:
                holder_alive = True
        if not any(probe.identified for probe in probes):
            warn(
                "Could not identify the lock holder (no ongoing CI build/run, and Who's host "
                "doesn't match this machine) — cannot confirm it is dead."
            )

        if not self._confirm_release(holder_alive=holder_alive):
            return False
        return self._force_unlock()

    # ── holder probes ────────────────────────────────────────────────────────
    def _probe_build(self) -> _Probe:
        """An ongoing auto-suspend Cloud Build very likely holds the lock — offer to cancel it."""
        ids = self.gcloud.builds.ongoing_autosuspend_ids(
            self.config.region, self.config.environment
        )
        if not ids:
            return _Probe(identified=False, verdict=_Verdict.KEEP)
        build_id = ids[0]
        warn(
            f"An auto-suspend Cloud Build ({build_id}) is QUEUED/WORKING — it very likely holds it."
        )
        if confirm(f"Cancel Cloud Build {build_id}?", auto_approve=self.auto_approve):
            if not self.gcloud.builds.cancel(build_id, region=self.config.region):
                # A FAILED cancel is NOT proof the holder is dead — keep it alive so the release
                # gate demands the strong override / refuses under AUTO_APPROVE (concurrent-writer
                # safety). Mirrors the shell setting PROBE_ALIVE only on cancel exit 0.
                warn(f"could not cancel Cloud Build {build_id} — treating as potentially alive.")
                return _Probe(identified=True, verdict=_Verdict.KEEP)
            ok(f"cancelled Cloud Build {build_id}")
            return _Probe(identified=True, verdict=_Verdict.DEAD)
        return _Probe(identified=True, verdict=_Verdict.KEEP)

    def _probe_gh_run(self) -> _Probe:
        """The pre-dispatched deploy-gke run may hold the lock. A gh probe FAILURE → ALIVE."""
        if not self.deploy_run_id:
            return _Probe(identified=False, verdict=_Verdict.KEEP)
        status = self.gh.run_status(self.deploy_run_id)
        if not status:  # "" → gh could not report (auth/network) → treat as potentially alive
            warn(
                f"Could not query GitHub run {self.deploy_run_id} — treating as potentially alive."
            )
            return _Probe(identified=True, verdict=_Verdict.KEEP)
        if status in ("in_progress", "queued"):
            warn(f"Pre-dispatched deploy-gke run {self.deploy_run_id} is {status}.")
            if confirm(
                f"Cancel GitHub Actions run {self.deploy_run_id}?", auto_approve=self.auto_approve
            ):
                if not self.gh.run_cancel(self.deploy_run_id):
                    # A FAILED cancel is NOT proof the run stopped — keep it alive so the release
                    # gate demands the strong override / refuses under AUTO_APPROVE.
                    warn(f"could not cancel run {self.deploy_run_id} — treating as maybe alive.")
                    return _Probe(identified=True, verdict=_Verdict.KEEP)
                ok(f"cancelled run {self.deploy_run_id}")
                return _Probe(identified=True, verdict=_Verdict.DEAD)
            return _Probe(identified=True, verdict=_Verdict.KEEP)
        return _Probe(identified=True, verdict=_Verdict.DEAD)  # terminal status → not holding it

    def _probe_local_pid(self, host: str) -> _Probe:
        """Only when the lock's host == this machine: probe (and offer to kill) a live local PID."""
        if not host or host != self.hostname():
            return _Probe(identified=False, verdict=_Verdict.KEEP)
        verdict = _Verdict.DEAD  # host matches but no live tofu/terraform PID → confirmed dead
        for pid in self.list_pids(self.tofu.tf_dir):
            if not self.pid_alive(pid):
                continue
            warn(
                f"A local tofu/terraform process (PID {pid}) is still alive and may hold this lock."
            )
            if not confirm(f"Kill local process {pid}?", auto_approve=self.auto_approve):
                verdict = _Verdict.ALIVE
                continue
            if not self._kill_pid(pid):
                verdict = _Verdict.ALIVE
        return _Probe(identified=True, verdict=verdict)

    def _kill_pid(self, pid: int) -> bool:
        """SIGTERM then (on survival + confirm) SIGKILL a local PID; True iff it is gone after."""
        with contextlib.suppress(OSError):
            self.kill(pid, signal.SIGTERM)
        self.clock.sleep(1)
        if self.pid_alive(pid) and confirm(
            f"PID {pid} survived SIGTERM — SIGKILL it?", auto_approve=self.auto_approve
        ):
            with contextlib.suppress(OSError):
                self.kill(pid, signal.SIGKILL)
        if self.pid_alive(pid):
            warn(f"PID {pid} still alive")
            return False
        ok(f"killed PID {pid}")
        return True

    # ── release ──────────────────────────────────────────────────────────────
    def _confirm_release(self, *, holder_alive: bool) -> bool:
        """The release gate: a live/unconfirmed holder needs the stronger override (AUTO refuse)."""
        if holder_alive:
            warn(
                "The lock holder still looks ALIVE. Releasing now can corrupt state (two writers)."
            )
            if self.auto_approve:
                warn("AUTO_APPROVE=1 refuses to force-unlock an unconfirmed holder — aborting.")
                return False
            if not confirm("Release the state lock ANYWAY?"):
                warn("left the lock in place — aborting recovery.")
                return False
            return True
        if not confirm("Release the state lock now?", auto_approve=self.auto_approve):
            warn("left the lock in place — aborting recovery.")
            return False
        return True

    def _force_unlock(self) -> bool:
        """Force-unlock by the GCS object GENERATION [#1]; a now-absent lock counts as released."""
        generation = self.gcloud.storage.object_generation(self._lock_uri)
        if not generation:
            warn("could not read the .tflock generation — cannot force-unlock; delete it manually.")
            return False
        try:
            self.tofu.force_unlock(generation)
        except ProcError:
            if not self.gcloud.storage.object_generation(self._lock_uri):
                ok("lock object already gone — treating as released.")
                return True
            warn("force-unlock failed and the lock object still exists — inspect .tflock manually.")
            return False
        ok(f"state lock (generation {generation}) released (bucket versioning is the safety net).")
        return True


def _parse_lock(blob: str) -> TfLock:
    """Parse the `.tflock` JSON for display — tolerant to a partial/garbled blob (all default)."""
    try:
        return TfLock.model_validate_json(blob)
    except ValueError:
        return TfLock()


def _describe(lock: TfLock) -> None:
    """Print who holds the lock + what operation — the operator's context before any release."""
    warn(
        f"State lock held by: {lock.who or '?'} · operation: {lock.operation or '?'} · "
        f"created: {lock.created or '?'} · id: {lock.id or '?'}"
    )
