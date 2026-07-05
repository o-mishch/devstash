#!/usr/bin/env python3
"""Check whether a deploy-gke.yml run is currently in progress or queued.

Invoked by auto-suspend-guard.sh (Cloud Build guard step), between the hard-uptime-cap check and
the idle-traffic check. A deploy-gke.yml run does real work against the live cluster (Helm
installs, kubectl rollout) that generates zero ingress LB traffic, so without this check it is
indistinguishable from "idle" — letting the guard tear the cluster down mid-deploy. Kept as a
standalone file rather than an inline heredoc, same rationale as auto-suspend-idle-count.py.

Public repo, unauthenticated read of the Actions API — no token needed, no new secret granted to
the lifecycle SA.

Exit 0 means "treat as in-flight, skip idle suspend this tick" — either a run is genuinely
in_progress/queued, OR the GitHub API call itself failed (rate-limited, unreachable, malformed
response). A transient API hiccup must fail safe toward NOT suspending: this check only ever
defers the fast idle path (never the hard uptime cap — see auto-suspend-guard.sh), so the cost of
a false positive is one skipped tick, while the cost of a false negative (an API blip silently
falling through to "no run found") is tearing down a cluster mid-deploy. Exit 1 means a real run
lookup succeeded and found neither in_progress nor queued.

Env:
  REPO_SLUG   "owner/repo"
"""

import json
import os
import sys
import urllib.request


def run_count(status):
    url = (
        "https://api.github.com/repos/%s/actions/workflows/deploy-gke.yml/runs"
        "?status=%s&per_page=1" % (os.environ["REPO_SLUG"], status)
    )
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)
    return data["total_count"]


try:
    in_flight = run_count("in_progress") > 0 or run_count("queued") > 0
except Exception as exc:
    print("deploy-check API call failed (%s) — failing safe as in-flight" % exc, file=sys.stderr)
    in_flight = True

raise SystemExit(0 if in_flight else 1)
