output "trigger_id" {
  value = google_cloudbuild_trigger.devstash.trigger_id
}

output "trigger_resource_name" {
  value = google_cloudbuild_trigger.devstash.name
}
