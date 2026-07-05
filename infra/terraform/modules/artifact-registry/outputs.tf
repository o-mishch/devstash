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

# ORDERING-ONLY handle on the repo resource itself (not its attributes). Consumers pass this
# into another module's `depends_on` to obtain a real graph edge to the repo. Unlike the static
# outputs above, this deliberately references the resource so the edge exists — and because it
# is used ONLY in depends_on (never as a value), it does NOT reintroduce the plan-time-unknown /
# null-while-suspended problem those outputs were made static to avoid.
#
# WHY THIS EXISTS: the repo-scoped AR IAM members (modules/iam) target the STATIC repository_id
# string, so absent this handle the graph has no edge between them and the repo. On the suspend
# destroy they then race — the repo destroyed first, the IAM members 403 on the vanished repo
# (getIamPolicy/setIamPolicy on an absent resource returns 403), aborting the apply BEFORE it
# reaches the GKE destroy and stranding the cluster billing. A depends_on edge is reversed on
# destroy, so wiring this into the iam module forces the members to destroy FIRST, while the
# repo still exists. `toset([...])` tolerates the count=0 (suspended) case: an empty set is a
# valid, still-ordered depends_on target.
output "repository_depends_on" {
  value = toset(google_artifact_registry_repository.docker[*])
}
