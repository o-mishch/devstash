# user_project_override + billing_project: the Cloud Billing Budgets API
# (billingbudgets.googleapis.com, budget.tf) is a "requires a quota project" API — the
# provider must send an X-Goog-User-Project header or the call is attributed to Google's
# shared fallback project (consumer 764086051850) and fails with SERVICE_DISABLED/403.
# Setting these forwards var.project_id as the user/quota project for every request, which
# works for both local ADC and CI Workload Identity Federation (independent of whether the
# caller's ADC happens to have a quota_project_id set locally).
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
