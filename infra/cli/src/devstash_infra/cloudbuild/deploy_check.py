"""cloudbuild/deploy_check.py — is a deploy-gke run in flight? 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-deploy-check.py (Cloud Build guard step). A
deploy-gke.yml run does real work against the live cluster (Helm installs, kubectl rollout) that
generates ZERO ingress LB traffic, so without this check it is indistinguishable from "idle" — and
the guard would tear the cluster down mid-deploy. Uses the vendored `requests` (gcloud's
lib/third_party copy on the image; the pinned `vendored` dep on dev/CI). Unauthenticated read of
the public Actions API (no token, no new secret granted to the lifecycle SA).

FAIL SAFE toward NOT suspending: in-flight is True when a run is in_progress/queued OR the API call
itself fails (rate-limited, unreachable, malformed) — this only ever defers the fast idle path
(never the hard uptime cap), so a false positive costs one skipped tick while a false negative costs
a cluster torn down mid-deploy.
"""

import sys
from collections.abc import Callable
from typing import ReadOnly, TypedDict, cast

import requests

_RUNS_URL = "https://api.github.com/repos/{slug}/actions/workflows/deploy-gke.yml/runs"
_HTTP_TIMEOUT_S = 30  # bound the unattended call so a hung connection resolves to the fail-safe

type RunCount = Callable[[str, str], int]


# The Actions "list workflow runs" response, typed as far as we read it: only `total_count`. A
# response missing that key is a malformed API reply — the KeyError propagates to `deploy_in_flight`
# and is caught as the fail-safe (treat as in-flight), never silently read as zero.
class _RunsResponse(TypedDict):
    total_count: ReadOnly[int]


def github_run_count(repo_slug: str, status: str) -> int:
    """`total_count` of deploy-gke runs in `status` (in_progress / queued) for `repo_slug`."""
    params: dict[str, str | int] = {"status": status, "per_page": 1}
    response = requests.get(
        _RUNS_URL.format(slug=repo_slug),
        params=params,
        headers={"Accept": "application/vnd.github+json"},
        timeout=_HTTP_TIMEOUT_S,
    )
    response.raise_for_status()
    # One boundary cast: assert the parsed JSON matches the documented Actions runs shape.
    return cast("_RunsResponse", response.json())["total_count"]


def deploy_in_flight(repo_slug: str, *, run_count: RunCount = github_run_count) -> bool:
    """True if a deploy-gke run is in_progress/queued — or the API call failed (fail-safe).

    `run_count` is injected for tests; production uses the public Actions API read.
    """
    try:
        return run_count(repo_slug, "in_progress") > 0 or run_count(repo_slug, "queued") > 0
    except Exception as exc:  # noqa: BLE001 — fail safe: ANY API hiccup means "treat as in-flight"
        sys.stderr.write(f"deploy-check API call failed ({exc}) — failing safe as in-flight\n")
        return True
