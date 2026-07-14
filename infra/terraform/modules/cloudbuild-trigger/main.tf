# Cloud Build trigger, classic GitHub-App-integration form (`github { owner, name, push }`) —
# NOT the 2nd-gen `google_cloudbuildv2_connection`/`repository_event_config` form. Verified
# against the LIVE trigger (`gcloud builds triggers describe`): its `github` block is the
# classic shape and `gcloud builds connections list` returns zero 2nd-gen connections in this
# project, confirming Cloud Run's "Continuously deploy" console flow set this up via the
# GitHub App integration directly, with no separate connection/repository resource. Built to
# ADOPT the already-live trigger via an `import` block in envs/prod/imports.tf.

resource "google_cloudbuild_trigger" "devstash" {
  project     = var.project_id
  location    = var.location
  name        = var.trigger_name
  description = var.description

  # Preserve the live trigger's own (top-level) tags + build-log inclusion so the import diff is
  # ONLY the intended region/branch changes, not incidental console-set-field churn.
  tags               = var.tags
  include_build_logs = var.include_build_logs

  github {
    owner = var.github_owner
    name  = var.github_repo_name

    push {
      branch = var.branch_filter_regex
    }
  }

  # Top-level (not nested in github.push) — scopes the trigger to a subtree. null (not []) when
  # unset so the provider omits it and the trigger fires on any changed file, preserving the
  # original behaviour.
  included_files = length(var.included_files) > 0 ? var.included_files : null

  service_account = "projects/${var.project_id}/serviceAccounts/${var.deployer_service_account}"
  substitutions   = var.substitutions

  build {
    dynamic "step" {
      for_each = var.build_steps
      content {
        id         = step.value.id
        name       = step.value.name
        entrypoint = try(step.value.entrypoint, null)
        dir        = try(step.value.dir, null)
        args       = step.value.args
        env        = try(step.value.env, null)
      }
    }

    images = var.build_images
    tags   = var.tags

    options {
      logging             = "CLOUD_LOGGING_ONLY"
      substitution_option = "ALLOW_LOOSE"
    }
  }
}
