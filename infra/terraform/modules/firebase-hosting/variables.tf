variable "project_id" { type = string }

# Firebase Hosting site ids are globally unique across all Firebase projects — cannot be a
# short generic name like "beta". Becomes the default *.web.app/*.firebaseapp.com subdomain.
variable "hosting_site_id" {
  type    = string
  default = "devstash-beta"
}

# The transition subdomain (per current-feature.md) — apex devstash.one stays on Vercel until
# final cutover; this custom domain is what Firebase actually serves.
variable "custom_domain" {
  type    = string
  default = "beta.devstash.one"
}

# False until web/ exists and DNS is actually pointed at this custom domain (Frontend Track
# F0) — otherwise `apply` blocks waiting on DNS records that can't resolve yet.
variable "wait_dns_verification" {
  type    = bool
  default = false
}

variable "github_repository" { type = string }

# Numeric project number — used to construct the existing WIF pool's resource name (principalSet
# members reference the pool by project NUMBER, not id).
variable "project_number" { type = string }

# The already-existing (dev-managed) WIF pool + provider ids this module binds prod's deployer
# SA to, rather than creating its own. Defaults match dev's iam module.
variable "wif_pool_id" {
  type    = string
  default = "github-actions"
}

variable "wif_provider_id" {
  type    = string
  default = "github"
}
