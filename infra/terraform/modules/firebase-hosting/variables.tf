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
