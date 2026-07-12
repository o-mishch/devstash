locals {
  name_prefix = "devstash-${var.environment}"

  common_labels = {
    app         = "devstash"
    environment = var.environment
    managed_by  = "terraform"
  }

  # The default Compute Engine SA — the identity the Cloud Build trigger currently deploys as
  # (console-created default; see the plan's "Follow-ups" section for the dedicated
  # least-privilege deployer SA this should move to later). Built from var.project_number
  # (a static input), not a google_project data source — same plan-time-known rationale as
  # dev/main.tf's compute_default_sa_member.
  compute_default_sa_email = "${var.project_number}-compute@developer.gserviceaccount.com"

  # The existing live trigger's own id (console-created, imported — see imports.tf). Baked in
  # as a historical constant because the build's --labels flag self-references $_TRIGGER_ID;
  # this does NOT change when the trigger's other config (region substitutions, branch filter)
  # is updated in the same reviewed follow-up.
  cloudbuild_trigger_id = "9df333f5-0194-4213-bc85-d81fe3e0c64e"
}
