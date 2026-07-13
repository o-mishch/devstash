# Bare email — callers pass this to the cloudbuild-trigger module's `deployer_service_account`
# and use it as the member in any resource-scoped grants they own.
output "email" {
  value = google_service_account.deployer.email
}

# All project-level role bindings, so callers can express a real depends_on edge (e.g. a trigger
# waiting for the SA's roles to land before it runs a build as the SA).
output "role_bindings" {
  value = toset([for b in google_project_iam_member.roles : b.id])
}
