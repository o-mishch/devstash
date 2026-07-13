locals {
  name_prefix = "devstash-${var.environment}"

  common_labels = {
    app         = "devstash"
    environment = var.environment
    managed_by  = "terraform"
  }

  # The default Compute Engine SA. No longer the DEPLOY identity — backend deploys now run as
  # the dedicated devstash-backend-deployer SA (deployers.tf). This SA remains the Cloud Run
  # RUNTIME identity (the cloud-run module gets no service_account_email) and the APP_CONFIG
  # secret accessor (secrets.tf), and is the actAs target the backend deployer needs to roll a
  # revision. Built from var.project_number (a static input), not a google_project data source —
  # same plan-time-known rationale as dev/main.tf's compute_default_sa_member.
  compute_default_sa_email = "${var.project_number}-compute@developer.gserviceaccount.com"

  # The existing live trigger's own id (console-created, imported — see imports.tf). Baked in
  # as a historical constant because the build's --labels flag self-references $_TRIGGER_ID;
  # this does NOT change when the trigger's other config (region substitutions, branch filter)
  # is updated in the same reviewed follow-up.
  cloudbuild_trigger_id = "9df333f5-0194-4213-bc85-d81fe3e0c64e"
}
