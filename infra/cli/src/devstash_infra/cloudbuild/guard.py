"""cloudbuild/guard.py — step 1: the suspend decision + SUSPEND sentinel. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-guard.sh. Fired by BOTH the idle Monitoring alert
and the uptime-cap cron on one Pub/Sub topic; this decides whether to actually suspend, writing the
`/workspace/SUSPEND` sentinel the later steps require. Any other case is a clean no-op. Suspends
when EITHER:
  (a) HARD UPTIME CAP — the cluster is older than `max_uptime_s`. UNCONDITIONAL, ignores traffic:
      a public LB never sees true-zero traffic (internet scanners keep request_count > 0), so the
      idle path (b) alone can fail to fire forever; the cap guarantees teardown within the cron
      cadence. Resume is deliberate/manual, so capping uptime after a resume is exactly right.
  (b) GENUINELY IDLE — older than the fresh-resume grace (`idle_window_s`) AND zero LB requests
      across that window.

A deploy-gke run OR a local `apply` (provisioning marker) does real cluster work that emits ZERO
ingress traffic, so both are indistinguishable from idle — they DEFER ONLY path (b), NEVER the
hard cap (a): a wedged run must never pin the env up forever past the scanner-proof backstop.

The gcloud probes run through `proc` (argv-parity tested via pytest-subprocess); the two HTTP
probes (`deploy_in_flight`, `fetch_request_count`) and the clock are injected seams — they cannot
be intercepted at the subprocess layer, and injecting them makes the safety ORDERING directly
assertable with typed stubs.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

from devstash_infra.cloudbuild.deploy_check import deploy_in_flight
from devstash_infra.cloudbuild.env import SUSPEND_SENTINEL, BuildEnv
from devstash_infra.cloudbuild.idle_count import fetch_request_count
from devstash_infra.shared import proc
from devstash_infra.shared.lock_contention import older_autosuspend_build_running

log = logging.getLogger(__name__)

# The OpenTofu backend prefix (backend.tf) — the state lock + provisioning marker live under it.
_BACKEND_PREFIX = "gke/dev"
_RFC3339 = "%Y-%m-%dT%H:%M:%SZ"  # the Monitoring interval format (matches the shell's `date -u`)


class RequestCount(Protocol):
    """The idle-window LB request_count probe — `idle_count.fetch_request_count`'s shape."""

    def __call__(self, *, project: str, start: str, end: str, window_s: str, token: str) -> int: ...


type DeployRunning = Callable[[str], bool]  # deploy_in_flight - repo_slug -> in-flight?


def _utc_now() -> datetime:
    """Current UTC time (injected as the guard's clock; overridable in tests)."""
    return datetime.now(tz=UTC)


def _rfc3339_to_epoch(value: str) -> float:
    """Epoch seconds for an RFC3339 timestamp (gcloud createTime/timeCreated are tz-aware)."""
    return datetime.fromisoformat(value).timestamp()


def _cluster_create_time(env: BuildEnv) -> str:
    """CreateTime of the (single) cluster, or "" if none. `--limit=1` not `| head`: POSIX had no
    pipefail, so capping output server-side keeps a real gcloud error fatal (check=True) instead of
    masked as an empty 'already suspended'.
    """
    return proc.run(
        [
            "gcloud",
            "container",
            "clusters",
            "list",
            f"--region={env.region}",
            f"--project={env.project_id}",
            "--format=value(createTime)",
            "--limit=1",
        ]
    ).out


def _object_time(env: BuildEnv, name: str) -> str:
    """TimeCreated of a backend GCS object (the .provisioning marker), or "" if absent."""
    uri = f"gs://{env.state_bucket}/{_BACKEND_PREFIX}/{name}"
    return proc.run(
        ["gcloud", "storage", "objects", "describe", uri, "--format=value(timeCreated)"],
        check=False,
    ).out


def _state_lock_held(env: BuildEnv) -> bool:
    """True if the state lock object exists — a human run.sh apply/suspend/resume is live."""
    uri = f"gs://{env.state_bucket}/{_BACKEND_PREFIX}/default.tflock"
    return proc.run_ok(["gcloud", "storage", "objects", "describe", uri])


def _idle_request_count(env: BuildEnv, now: datetime, request_count: RequestCount) -> int:
    """Sum LB request_count over the idle window. The token goes via env (never argv)."""
    token = proc.run(["gcloud", "auth", "print-access-token"]).out
    start = (now - timedelta(seconds=env.idle_window_s)).strftime(_RFC3339)
    end = now.strftime(_RFC3339)
    return request_count(
        project=env.project_id,
        start=start,
        end=end,
        window_s=str(env.idle_window_s),
        token=token,
    )


def guard(
    env: BuildEnv,
    *,
    sentinel: Path = SUSPEND_SENTINEL,
    clock: Callable[[], datetime] = _utc_now,
    deploy_running: DeployRunning = deploy_in_flight,
    request_count: RequestCount = fetch_request_count,
) -> None:
    """Evaluate the suspend decision, writing `sentinel` iff it fires; else a clean no-op."""
    created = _cluster_create_time(env)
    if not created:
        log.info("no cluster found (already suspended) — nothing to do")
        return

    # A human run.sh apply/suspend/resume holds the state lock — proceeding would collide mid-apply.
    if _state_lock_held(env):
        log.info("state lock held (a run.sh apply/suspend/resume is in progress) — skipping")
        return

    # Dedup concurrent auto-suspend builds: the idle alert + the cron share one topic, so two
    # builds can start seconds apart and both pass the (not-yet-held) lock. Defer to the earliest.
    if older_autosuspend_build_running(env.region, env.project_id, env.trigger_name, env.build_id):
        log.info("an earlier auto-suspend build is already in flight — deferring to it (no-op)")
        return

    age_s = clock().timestamp() - _rfc3339_to_epoch(created)
    # (a) Hard uptime cap — suspend regardless of traffic. Checked first; max_uptime >= idle_window
    # is enforced by variable validation, so this never conflicts with the grace below.
    if age_s >= env.max_uptime_s:
        log.info(
            "cluster age %ds >= max uptime %ds — hard uptime cap reached, will suspend",
            age_s,
            env.max_uptime_s,
        )
        sentinel.touch()
        return
    if age_s < env.idle_window_s:
        log.info(
            "cluster age %ds < idle window %ds — too fresh, skipping to avoid flapping",
            age_s,
            env.idle_window_s,
        )
        return

    # A local run.sh apply (fresh bring-up, no CI to poll) writes a .provisioning marker. Defers
    # only path (b): a marker younger than the window means a bring-up is live; a stale one is an
    # interrupted run and is not honored (bounded by the same grace as everything else).
    marker = _object_time(env, ".provisioning")
    if marker:
        marker_age_s = clock().timestamp() - _rfc3339_to_epoch(marker)
        if marker_age_s < env.idle_window_s:
            log.info(
                "provisioning marker present (%ds old) — skipping to spare a fresh bring-up",
                marker_age_s,
            )
            return
        log.info(
            "provisioning marker present but stale (%ds old) — likely interrupted; not honoring",
            marker_age_s,
        )

    # A deploy-gke run in progress/queued means CI is actively using the cluster — defer path (b).
    if deploy_running(env.repo_slug):
        log.info(
            "a deploy-gke.yml run is in progress/queued — skipping to avoid a mid-deploy teardown"
        )
        return

    count = _idle_request_count(env, clock(), request_count)
    log.info("LB request_count over idle window: %d", count)
    if count == 0:
        log.info("idle — will suspend")
        sentinel.touch()
    else:
        log.info("traffic present (%d requests) — skipping suspend", count)
