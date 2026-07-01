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
# delete the cluster; run.sh suspend passes both together.
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
variable "labels" {
  type    = map(string)
  default = {}
}
