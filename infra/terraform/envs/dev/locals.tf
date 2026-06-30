locals {
  name_prefix = "devstash-${var.environment}"

  # Labels applied to every resource that supports them — essential for cost
  # attribution, ownership, and cleanup. "Untagged resources" is a real interview
  # red flag; tag everything.
  common_labels = {
    app         = "devstash"
    environment = var.environment
    managed_by  = "terraform"
  }
}
