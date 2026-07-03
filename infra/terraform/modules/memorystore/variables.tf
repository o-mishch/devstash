variable "name_prefix" { type = string }
variable "region" { type = string }
variable "project_id" {
  type        = string
  description = "GCP project ID — required for the Valkey PSC auto-created endpoints."
}
variable "network_id" { type = string }
variable "node_type" {
  type        = string
  default     = "SHARED_CORE_NANO"
  description = "Valkey node size. SHARED_CORE_NANO is cheapest (dev); STANDARD_SMALL+ for prod."
}
variable "highly_available" {
  type    = bool
  default = false
}
variable "labels" {
  type    = map(string)
  default = {}
}
