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
variable "labels" {
  type    = map(string)
  default = {}
}
