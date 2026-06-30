output "repository_id" {
  value = google_artifact_registry_repository.docker.repository_id
}

# Full image path prefix: REGION-docker.pkg.dev/PROJECT/devstash
output "repository_url" {
  value = "${var.region}-docker.pkg.dev/${google_artifact_registry_repository.docker.project}/${google_artifact_registry_repository.docker.repository_id}"
}
