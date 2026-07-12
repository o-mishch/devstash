output "service_name" {
  value = google_cloud_run_v2_service.app.name
}

output "service_uri" {
  value = google_cloud_run_v2_service.app.uri
}

output "service_account_email" {
  value = google_cloud_run_v2_service.app.template[0].service_account
}

# Null when var.domain is "" (no mapping created) — count-indexed resource.
output "domain_mapping_status" {
  value = one(google_cloud_run_domain_mapping.app[*].status)
}
