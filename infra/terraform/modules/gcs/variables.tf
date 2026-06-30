variable "name_prefix" { type = string }
variable "project_id" { type = string }
variable "location" {
  type = string
  # GCS Always Free applies only in us-west1/us-central1/us-east1 (aggregate
  # 5 GB-months), not every US region or a multi-region. Dev uses us-central1.
  default = "us-central1"
}
variable "cors_origins" {
  type        = list(string)
  description = "Allowed CORS origins for the uploads bucket. Must be explicit — no wildcard '*' default to avoid cross-origin exposure of signed URLs."
}
variable "labels" {
  type    = map(string)
  default = {}
}
