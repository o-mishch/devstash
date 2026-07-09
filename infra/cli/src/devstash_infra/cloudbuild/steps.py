"""cloudbuild/steps.py — consolidated Cloud Build auto-suspend step functions. 3.14 floor.

HARD RULE: stdlib-only + shared/ + cloudbuild/env.py. No clients/, no typer, no pydantic.
"""

import base64
import json
import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol, cast

from devstash_infra.cloudbuild.deploy_check import deploy_in_flight
from devstash_infra.cloudbuild.env import (
    AR_IAM_ADDR_FILE,
    SUSPEND_SENTINEL,
    TF_DIR,
    BuildEnv,
)
from devstash_infra.cloudbuild.idle_count import fetch_request_count
from devstash_infra.cloudbuild.secrets_tfvars import build_secrets_tfvars
from devstash_infra.shared import proc, reap_negs
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.dump import (
    export_and_verify_dump,
    prune_dump_versions,
)
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.lock_contention import (
    force_unlock_if_dead,
    older_autosuspend_build_running,
)
from devstash_infra.shared.reconcile_ar_iam import purge_stranded_ar_iam
from devstash_infra.shared.secrets import newest_enabled_secret_version

log = logging.getLogger(__name__)

# ── coordinates ──────────────────────────────────────────────────────────────
_BACKEND_PREFIX = "gke/dev"
_RFC3339 = "%Y-%m-%dT%H:%M:%SZ"

_DATABASE = "devstash"
APP_CONFIG_SECRET = "devstash-app-config"  # noqa: S105
OPS_CONFIG_SECRET = "devstash-ops-config"  # noqa: S105

_NONSECRET_TFVARS = "zz-nonsecret.auto.tfvars.json"
_SECRETS_TFVARS = "zz-secrets.auto.tfvars.json"

_AR_REPO = "devstash"
_APPLY_ARGV = [
    "tofu",
    "apply",
    "-input=false",
    "-auto-approve",
    "-refresh=false",
    "-lock-timeout=900s",
    "-var",
    "environment_active=false",
    "-var",
    "db_active=false",
]

_PSC_PURPOSE_RE = re.compile(r'^\s*purpose\s*=\s*"([^"]+)"', re.MULTILINE)


# ── protocol/types ───────────────────────────────────────────────────────────
class RequestCount(Protocol):
    """The idle-window LB request_count probe — `idle_count.fetch_request_count`'s shape."""

    def __call__(self, *, project: str, start: str, end: str, window_s: str, token: str) -> int: ...


type DeployRunning = Callable[[str], bool]


# ── helper logic ─────────────────────────────────────────────────────────────
def _rfc3339_to_epoch(value: str) -> float:
    """Epoch seconds for an RFC3339 timestamp."""
    return datetime.fromisoformat(value).timestamp()


def _cluster_create_time(env: BuildEnv) -> str:
    """CreateTime of the (single) cluster, or "" if none."""
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


def _fetch_enabled_secret(secret: str, project: str) -> dict[str, str]:
    """Access `secret`'s newest ENABLED version and parse its JSON blob — FATAL on any gap."""
    version = newest_enabled_secret_version(secret, project)
    if not version:
        raise InfraError(f"{secret} has no ENABLED version — cannot proceed")
    payload = proc.run(
        [
            "gcloud",
            "secrets",
            "versions",
            "access",
            version,
            f"--secret={secret}",
            f"--project={project}",
        ],
    ).out
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise InfraError(f"{secret} payload is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise InfraError(f"{secret} payload is not a JSON object")
    return cast("dict[str, str]", parsed)


# ── steps ────────────────────────────────────────────────────────────────────
def guard(
    env: BuildEnv,
    *,
    sentinel: Path = SUSPEND_SENTINEL,
    clock: Clock = SYSTEM_CLOCK,
    deploy_running: DeployRunning = deploy_in_flight,
    request_count: RequestCount = fetch_request_count,
) -> None:
    """Evaluate the suspend decision, writing `sentinel` iff it fires; else a clean no-op."""
    created = _cluster_create_time(env)
    if not created:
        log.info("no cluster found (already suspended) — nothing to do")
        return

    if _state_lock_held(env):
        log.info("state lock held (a run.sh apply/suspend/resume is in progress) — skipping")
        return

    if older_autosuspend_build_running(env.region, env.project_id, env.trigger_name, env.build_id):
        log.info("an earlier auto-suspend build is already in flight — deferring to it (no-op)")
        return

    age_s = clock.now().timestamp() - _rfc3339_to_epoch(created)
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

    marker = _object_time(env, ".provisioning")
    if marker:
        marker_age_s = clock.now().timestamp() - _rfc3339_to_epoch(marker)
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

    if deploy_running(env.repo_slug):
        log.info(
            "a deploy-gke.yml run is in progress/queued — skipping to avoid a mid-deploy teardown"
        )
        return

    count = _idle_request_count(env, clock.now(), request_count)
    log.info("LB request_count over idle window: %d", count)
    if count == 0:
        log.info("idle — will suspend")
        sentinel.touch()
    else:
        log.info("traffic present (%d requests) — skipping suspend", count)


def prepare(env: BuildEnv, *, tf_dir: Path = TF_DIR, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Write the non-secret + reconstructed-secret tfvars into `tf_dir`. No-op unless idle."""
    if not sentinel.exists():
        log.info("not idle — skipping prepare")
        return

    (tf_dir / _NONSECRET_TFVARS).write_bytes(base64.b64decode(env.nonsecret_b64))

    app_config = _fetch_enabled_secret(APP_CONFIG_SECRET, env.project_id)
    ops_config: dict[str, str] | None = None
    if proc.run_ok(
        ["gcloud", "secrets", "describe", OPS_CONFIG_SECRET, f"--project={env.project_id}"]
    ):
        ops_config = _fetch_enabled_secret(OPS_CONFIG_SECRET, env.project_id)

    tfvars = build_secrets_tfvars(app_config, ops_config, env.secret_keys)
    (tf_dir / _SECRETS_TFVARS).write_text(json.dumps(tfvars))
    log.info("prepared tofu tfvars — non-secret + %d third-party secret(s)", len(env.secret_keys))


def dump_step(env: BuildEnv, *, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Export + verify the DB dump, or skip if the instance is already gone. No-op unless idle."""
    if not sentinel.exists():
        log.info("not idle — skipping DB export")
        return

    state = proc.run(
        [
            "gcloud",
            "sql",
            "instances",
            "describe",
            env.db_instance,
            f"--project={env.project_id}",
            "--format=value(state)",
        ],
        check=False,
    )
    if not state.ok or not state.out.strip():
        log.info(
            "Cloud SQL instance %s not found — already destroyed by a prior suspend; "
            "skipping dump and continuing teardown",
            env.db_instance,
        )
        return

    result = export_and_verify_dump(env.db_instance, env.dump_uri, _DATABASE, env.project_id)
    if not result.verified:
        raise InfraError(
            "could not produce a non-empty dump after retry — aborting before any destroy"
        )
    log.info("dump verified (%s bytes) — safe to destroy the instance", result.size_bytes)

    prune_dump_versions(env.dump_uri, env.db_dump_keep + 1)


def suspend_step(
    env: BuildEnv,
    *,
    sentinel: Path = SUSPEND_SENTINEL,
    tf_dir: Path = TF_DIR,
    addr_file: Path = AR_IAM_ADDR_FILE,
) -> None:
    """Reconcile stranded AR-IAM, then apply the suspend with guarded lock recovery (idle only)."""
    if not sentinel.exists():
        log.info("not idle — skipping suspend")
        return

    proc.run(
        ["tofu", "init", "-input=false", f"-backend-config=bucket={env.state_bucket}"],
        cwd=str(tf_dir),
    )

    if not purge_stranded_ar_iam(_AR_REPO, env.region, env.project_id, str(addr_file)):
        raise InfraError(
            "could not purge a stranded AR-IAM member from state — aborting the suspend apply"
        )

    def _apply() -> proc.Result:
        return proc.long_running(_APPLY_ARGV, cwd=str(tf_dir))

    result = _apply()
    if result.ok:
        return

    if not proc.is_lock_error(result.stdout):
        raise InfraError(
            "suspend apply failed for a non-lock reason — surfacing the error (alert will fire)"
        )

    if not force_unlock_if_dead(
        env.region, env.project_id, env.state_bucket, env.trigger_name, env.build_id
    ):
        log.info(
            "another auto-suspend build holds the lock (or it cleared) — this build is a no-op"
        )
        return

    log.info("retrying the suspend apply after clearing the stale lock")
    if not _apply().ok:
        raise InfraError("suspend apply failed after clearing the stale lock — surfacing the error")


def cleanup_builds(env: BuildEnv, *, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Cancel other in-flight builds + delete the staging bucket — no-op unless idle."""
    if not sentinel.exists():
        log.info("not idle — skipping build cleanup")
        return

    log.info("cancelling in-flight Cloud Builds (excluding this build %s)", env.build_id)
    listing = proc.run(
        [
            "gcloud",
            "builds",
            "list",
            f"--region={env.region}",
            f"--project={env.project_id}",
            "--ongoing",
            f"--filter=id!={env.build_id}",
            "--format=value(id)",
        ],
        check=False,
    )
    ids = listing.out.split() if listing.ok else []
    if ids:
        cancel = proc.run(
            [
                "gcloud",
                "builds",
                "cancel",
                *ids,
                f"--region={env.region}",
                f"--project={env.project_id}",
                "--quiet",
            ],
            check=False,
        )
        if not cancel.ok:
            log.info(
                "build cancel returned non-zero (some may have finished mid-cancel) — continuing"
            )
    else:
        log.info("no other in-flight builds — nothing to cancel")

    staging = f"gs://{env.project_id}_cloudbuild"
    log.info("deleting Cloud Build staging bucket %s", staging)
    removed = proc.run(
        ["gcloud", "storage", "rm", "-r", staging, "--quiet", f"--project={env.project_id}"],
        check=False,
    )
    if not removed.ok:
        log.info("staging bucket delete returned non-zero (likely never created / already gone)")
    log.info(
        "build cleanup complete — in-flight builds cancelled, staging bucket reclaimed for $0 idle"
    )


def cleanup_negs(env: BuildEnv, *, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Reap leaked NEGs/firewalls on our VPC — no-op unless the guard marked this build idle."""
    if not sentinel.exists():
        log.info("not idle — skipping NEG cleanup")
        return
    reap_negs.reap_leaked_negs(env.vpc, env.project_id)
    log.info(
        "NEG/firewall cleanup complete — leaked GKE networking reaped so a future down stays clean"
    )
