variable "name_prefix" { type = string }
variable "region" { type = string }
variable "network_id" { type = string }
variable "tier" { type = string }
variable "highly_available" {
  type    = bool
  default = false
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
