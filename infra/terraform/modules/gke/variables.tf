variable "name_prefix" { type = string }
variable "project_id" { type = string }
variable "region" { type = string }
variable "network_self_link" { type = string }
variable "subnet_self_link" { type = string }
variable "pods_range_name" { type = string }
variable "services_range_name" { type = string }
variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Prevent Terraform from deleting the cluster until explicitly disabled and applied."
}

# Cost toggle. False = the Autopilot cluster is destroyed (stateless, re-created on
# resume) so a suspended environment costs ~nothing. The Binary Authorization KMS key /
# attestor / policy in this module are NOT gated by this — they stay always-on.
# Note: deletion_protection must be false for an active→inactive flip to actually
# delete the cluster; devstash-infra gcp suspend passes both together.
variable "cluster_active" {
  type        = bool
  default     = true
  description = "Create the Autopilot cluster. False = suspended (cluster destroyed; data in Cloud SQL is untouched)."
}
# Supply-chain toggle. Gates the ENTIRE Binary Authorization subsystem in this module:
# the KMS keyring + asymmetric signing key, the Container Analysis note, the attestor,
# the project policy, AND the cluster's binary_authorization enforcement block. Default
# false so a cost-optimized dev env never creates the KMS key — KMS has no free tier, so
# an always-on signing key is the one resource that can never round to $0 while a deep-
# suspended environment is idle. Set true in prod for supply-chain enforcement parity.
# The deployer-SA signing IAM grants (modules/iam) are gated by the same flag at the root.
variable "binauthz_enabled" {
  type        = bool
  default     = false
  description = "Provision the Binary Authorization signing pipeline (KMS key, attestor, note, policy, cluster enforcement). False = omit it entirely (no KMS cost)."
}
# Observability cost toggle. Cloud Ops ingestion is the only recurring while-up cost the
# cluster's own settings control; on Autopilot you pay per pod request, not per node/CIDR,
# so trimming telemetry is the sole cost-positive cluster knob. False (dev) = system-only
# monitoring + logging, Advanced Datapath metrics off — GKE SYSTEM metrics are non-chargeable,
# so this drops the billable kube-state/cadvisor/kubelet/DCGM sample streams while keeping the
# control plane observable. Managed Prometheus stays enabled because Autopilot forbids disabling
# it (API 400), but with the metric components trimmed and no PodMonitoring CRs it ingests
# nothing chargeable — cost is gated by enable_components, not the GMP toggle. The idle auto-suspend
# alert keys on a Cloud Load Balancing metric (loadbalancing.googleapis.com/https/request_count),
# NOT a GKE monitoring component, so trimming here never affects idle detection. True = omit
# both blocks so Autopilot applies its full-observability defaults (prod parity).
variable "full_observability" {
  type        = bool
  default     = false
  description = "Full Cloud Ops telemetry (all monitoring components, Advanced Datapath metrics, WORKLOADS logs). False = cost-optimized system-only telemetry (Managed Prometheus stays enabled — Autopilot forbids disabling it — but ingests nothing without PodMonitoring CRs)."
}
variable "labels" {
  type    = map(string)
  default = {}
}
