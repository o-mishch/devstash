# Same user_project_override/billing_project pattern as dev (see dev/providers.tf) — several
# APIs enabled here (Cloud Build, Firebase Hosting) require an explicit quota project header.
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
