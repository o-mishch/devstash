output "site_id" {
  value = google_firebase_hosting_site.default.site_id
}

output "default_url" {
  value = "https://${google_firebase_hosting_site.default.site_id}.web.app"
}

output "custom_domain_status" {
  value = google_firebase_hosting_custom_domain.default.host_state
}

# The DNS records (TXT ownership verification + A/AAAA/CNAME) Hosting needs to serve this
# custom domain — surface them so the operator can add them to Spaceship by hand once web/
# exists (Frontend Track F0), same "copy this into DNS" pattern as dev's cert DNS-auth outputs.
output "required_dns_updates" {
  value = google_firebase_hosting_custom_domain.default.required_dns_updates
}

output "deployer_service_account_email" {
  value = google_service_account.firebase_deployer.email
}

# Full resource name of the (dev-owned) WIF provider prod's deploy workflow authenticates
# through — feeds the WORKLOAD_IDENTITY_PROVIDER GitHub secret.
output "wif_provider" {
  value = local.wif_provider_name
}
