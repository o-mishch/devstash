# STATIC outputs — derived from the known repo name + passed-in project/region, NOT from the
# google_artifact_registry_repository resource attribute. This is deliberate: the repo resource
# is gated on var.create (destroyed during deep-suspend), so referencing its attribute would
# make these outputs null/error while suspended and break every consumer — the root
# repository_url output and the IAM module's binding target both must resolve to the repo name
# whether the repo currently exists or not.
output "repository_id" {
  value = local.repository_id
}

# Full image path prefix: REGION-docker.pkg.dev/PROJECT/devstash
output "repository_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${local.repository_id}"
}
