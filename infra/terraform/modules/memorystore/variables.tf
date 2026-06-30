variable "name_prefix" { type = string }
variable "region" { type = string }
variable "network_id" { type = string }
variable "memory_size_gb" {
  type    = number
  default = 1
}
variable "highly_available" {
  type    = bool
  default = false
}
variable "labels" {
  type    = map(string)
  default = {}
}
