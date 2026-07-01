# Log-ingestion guard (WAF Cost Optimization — "Optimize resource usage").
#
# Cloud Logging bills on INGESTION beyond the 50 GiB/project/month always-free tier
# ($0.50/GiB after). A showcase that is up only for the occasional demo is almost certainly
# already $0 here — this is a belt-and-suspenders cap, not a fix for a known overage. It drops
# the highest-volume / lowest-value stream (GKE SYSTEM-namespace container logs: kube-system,
# gke-managed-*, gmp-system, etc.) BEFORE it counts against the tier, so a chatty control
# plane can never quietly push ingestion over the free line during a long-running demo.
#
# EXPLICITLY UNTOUCHED — the application (web) workload logs documented in
# infra/docs/11-logs.md. The exclusion filter is scoped to system namespaces only, so
# `kubectl logs` and the Logs Explorer queries in that doc keep working exactly as written.
#
# Reversible + gated: set log_system_exclusion_enabled = false to ingest everything again
# (e.g. when debugging a cluster-system issue). Removing the resource restores full ingestion;
# it manages only a sink exclusion, never a log bucket, so there is no locked-bucket risk.

resource "google_logging_project_exclusion" "gke_system_noise" {
  count = var.log_system_exclusion_enabled ? 1 : 0

  name        = "${local.name_prefix}-gke-system-noise"
  description = "Cost guard: drop GKE system-namespace container logs from ingestion (keeps the app/web logs in infra/docs/11-logs.md). Disable with log_system_exclusion_enabled=false."

  # System namespaces only — never the app namespace (var-driven so it tracks the real one).
  filter = <<-EOT
    resource.type="k8s_container"
    resource.labels.namespace_name=("kube-system" OR "gke-managed-system" OR "gke-managed-cim" OR "gmp-system" OR "gke-gmp-system")
  EOT
}
