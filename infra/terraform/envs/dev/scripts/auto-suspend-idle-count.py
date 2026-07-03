#!/usr/bin/env python3
"""Sum ingress LB request_count over the idle window — the auto-suspend guard's idle check.

Invoked by auto-suspend-guard.sh (Cloud Build guard step) on the genuinely-idle path, once the
cheap uptime/age checks have NOT already decided to suspend. Kept as a standalone file rather
than an inline heredoc in the shell step so the JSON-summation logic is independently
lintable/testable and each language stays in its own file — same rationale as
build-secrets-tfvars.py.

Queries the Cloud Monitoring API for loadbalancing.googleapis.com/https/request_count aggregated
(ALIGN_SUM + REDUCE_SUM) across the window and prints the integer total to stdout. All inputs
come from the ENVIRONMENT so the OAuth token never lands in argv / the process list:
  MON_PROJECT  GCP project id
  MON_START    interval.startTime (RFC3339)
  MON_END      interval.endTime (RFC3339)
  MON_WINDOW   idle window in seconds (used as the alignment period)
  MON_TOKEN    OAuth2 access token (gcloud auth print-access-token)
"""

import json
import os
import urllib.parse
import urllib.request

params = urllib.parse.urlencode(
    {
        "filter": 'metric.type="loadbalancing.googleapis.com/https/request_count"',
        "interval.startTime": os.environ["MON_START"],
        "interval.endTime": os.environ["MON_END"],
        "aggregation.alignmentPeriod": os.environ["MON_WINDOW"] + "s",
        "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM",
    }
)
url = "https://monitoring.googleapis.com/v3/projects/%s/timeSeries?%s" % (
    os.environ["MON_PROJECT"],
    params,
)
req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["MON_TOKEN"]})
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)

print(
    int(
        sum(
            float(point["value"].get("int64Value", point["value"].get("doubleValue", 0)))
            for series in data.get("timeSeries", [])
            for point in series.get("points", [])
        )
    )
)
