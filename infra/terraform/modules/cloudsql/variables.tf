variable "name_prefix" { type = string }
variable "region" { type = string }
variable "network_id" { type = string }
variable "tier" { type = string }
variable "highly_available" {
  type    = bool
  default = false
}
variable "point_in_time_recovery" {
  type        = bool
  default     = true
  description = "Enable continuous WAL archiving for point-in-time recovery. Adds log-storage cost on top of daily backups; turn off for dev, keep on for prod."
}
variable "activation_policy" {
  type        = string
  default     = "ALWAYS"
  description = "ALWAYS = instance running. NEVER = stopped (no vCPU/RAM charge, disk + data retained). This is the compute-off-DB-kept lever (instance_active stays true); the deep suspend paths destroy the instance via instance_active instead, so today NEVER is only reached transiently (e.g. dump_db starting a stopped instance)."
  validation {
    condition     = contains(["ALWAYS", "NEVER"], var.activation_policy)
    error_message = "activation_policy must be ALWAYS or NEVER."
  }
}
variable "instance_active" {
  type        = bool
  default     = true
  description = "true = the Cloud SQL instance exists. false = it is DESTROYED (count-gated) for true ~$0 idle. The deep suspend (run.sh suspend) sets this false ONLY after dumping the DB to GCS; run.sh resume recreates the instance and restores the dump. Stopping (activation_policy=NEVER) keeps the disk (~$1.70/mo); destroying keeps nothing (data lives in the GCS dump instead)."
}
variable "backups_enabled" {
  type        = bool
  default     = true
  description = "Cloud SQL automated daily backups. Off for the dev showcase (data durability comes from the suspend-time GCS dump, not backups); keep on for prod. PITR requires this to be true."
}
variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Prevent Terraform from deleting the instance until explicitly disabled and applied."
}
variable "app_user_password" {
  type      = string
  sensitive = true
}
variable "authorized_networks" {
  type = list(object({
    name  = string
    value = string
  }))
  default     = []
  description = "CIDRs allowed to reach the PUBLIC IP (developer machines). SSL is still required regardless."
}
variable "labels" {
  type    = map(string)
  default = {}
}
