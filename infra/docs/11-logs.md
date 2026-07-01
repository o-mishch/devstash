# 11 · Application logs — viewing & searching

The app logs JSON (Pino) to stdout/stderr. GKE ships every container's stdout/stderr to
**Cloud Logging** automatically (the `k8s_container` log stream), so there are two ways in:
`kubectl` for live tailing, and Logs Explorer when you need to **search** history across
restarts and replicas.

Cluster facts (dev):

| Field | Value |
|---|---|
| `project_id` | `project-39965ce5-4c4b-495e-8d4` |
| `location` | `us-central1` |
| `cluster_name` | `devstash-dev-gke` |
| `namespace_name` | `devstash` |
| workload labels | `app_kubernetes_io/{name=devstash, component=web, part-of=devstash}` |

## kubectl — live, ephemeral

```bash
kubectl logs -n devstash -l app.kubernetes.io/component=web -f --all-containers --prefix
kubectl logs -n devstash <pod> --previous          # last crashed instance
kubectl logs -n devstash <pod> --tail=200 --since=15m | grep -i error
```

Limit: only the current + one previous container instance; gone once the pod is deleted.

## Logs Explorer — searchable, retained

Console → **Logging → Logs Explorer**. Base query scoped to the web workload:

```
resource.type="k8s_container"
resource.labels.project_id="project-39965ce5-4c4b-495e-8d4"
resource.labels.location="us-central1"
resource.labels.cluster_name="devstash-dev-gke"
resource.labels.namespace_name="devstash"
labels.k8s-pod/app_kubernetes_io/component="web"
labels.k8s-pod/app_kubernetes_io/name="devstash"
labels.k8s-pod/app_kubernetes_io/part-of="devstash"
```

Or via the GKE UI: **Workloads → the workload → Logs tab → "View in Logs Explorer"** lands
you here pre-filtered.

### Searching by substring

Append one line to the base query (it ANDs with everything above):

```
"3000"                                   # global token match across all fields — fastest
SEARCH("3000")                           # substring match across the whole entry
jsonPayload.msg:"connection refused"     # substring on the Pino message field
jsonPayload.msg=~"connection (refused|reset)"   # regex on the message
textPayload=~"3000"                      # raw (non-JSON) lines, e.g. Next.js startup output
```

Notes:
- Pino structured fields are parsed into `jsonPayload` (`jsonPayload.msg`, `jsonPayload.tag`,
  `jsonPayload.level` — 30=info, 40=warn, 50=error). Raw startup lines (e.g.
  `- Local: http://localhost:3000`) land in `textPayload`.
- A bare `"3000"` is token/substring matching, case-insensitive, but splits on punctuation —
  good for whole tokens. Use `SEARCH(...)` or `=~` when you need a true partial-token match.
- The top **"Search all fields"** box just injects the same global match; typing `3000` there
  and **Run query** is the no-syntax route.

### gcloud equivalent

```bash
gcloud logging read '
  resource.type="k8s_container"
  resource.labels.namespace_name="devstash"
  jsonPayload.tag="stripe-webhook"
' --project=project-39965ce5-4c4b-495e-8d4 --limit=50 --freshness=1h --format=json
```

### Shareable link

Logs Explorer encodes the query + time window in the URL (`Share link` button), e.g. the
`3000` substring search on the web workload:

```
https://console.cloud.google.com/logs/query;query=labels.k8s-pod%2Fapp_kubernetes_io%2Fpart-of%3D%22devstash%22%0A%223000%22%0A?project=project-39965ce5-4c4b-495e-8d4
```

## kubectl vs Logs Explorer

| Need | Use |
|---|---|
| Tail a running pod right now | `kubectl logs -f` |
| Search history, across restarts/replicas | Logs Explorer |
| Filter by Pino fields (`tag`, `level`) | Logs Explorer (`jsonPayload.*`) |
| Logs after a pod is deleted | Logs Explorer (kubectl can't) |

## Cost guard — system-log exclusion

To stay inside Cloud Logging's 50 GiB/month always-free ingestion tier, a sink exclusion
(`logging.tf`, `log_system_exclusion_enabled`, ON by default) drops **GKE system-namespace**
container logs (`kube-system`, `gke-managed-*`, `gmp-system`) before they're ingested. The
**app/web** logs above are in the `devstash` namespace and are **not** affected — every query
on this page keeps working. If you need the system logs back (e.g. debugging a control-plane
or GMP issue), set `log_system_exclusion_enabled = false` and re-apply.
