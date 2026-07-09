variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names (e.g. devstash-dev)."
}

variable "region" {
  type = string
}

variable "waf_preview" {
  type        = bool
  default     = true
  description = "Log SQLi/XSS WAF matches without blocking. Set false only after reviewing false positives."
}

# Cost toggle. Cloud Armor bills per-policy (~$5/mo) + per-rule + per-request. The dev
# showcase serves the gke.* subdomain, not revenue traffic, so it does not need an edge
# WAF. Default false in dev → the policy is never created and the BackendConfig attaches
# no securityPolicy. Set true in prod for edge DDoS/WAF protection. Independent of
# compute_active: even a fully-active dev env skips Armor when this is false.
variable "armor_enabled" {
  type        = bool
  default     = false
  description = "Create the Cloud Armor security policy and attach it to the ingress. False = no edge WAF (dev $0 posture)."
}

# Cost toggle. The VPC, subnet, secondary ranges, and PSA peering are ALWAYS created
# (they are free and the stopped Cloud SQL instance keeps its private IP on the PSA
# range). The billable edge resources — the global ingress IP, Cloud NAT + its router,
# and the Cloud Armor policy — are created only when the environment is active. When
# false they are destroyed so a suspended environment costs ~nothing. See
# envs/dev/variables.tf:environment_active and devstash-infra gcp suspend/resume.
variable "compute_active" {
  type        = bool
  default     = true
  description = "Create the billable edge resources (ingress IP, NAT+router, Cloud Armor). False = suspended/torn down to ~$0."
}
