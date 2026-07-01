# Cost visibility (WAF Cost Optimization — "Budgets and Alerts" + "Granular Visibility").
#
# This file adds a monthly Cloud Billing budget with threshold alerts. It is GATED:
# nothing is created until var.billing_account is set in the gitignored terraform.tfvars
# (an empty default keeps `tofu plan` clean for anyone who hasn't supplied it). The
# billing account is intentionally NOT in version control — it is account-scoped, not a
# per-project value, and lives alongside the other real values in terraform.tfvars.
#
# ── BigQuery billing export (manual, one-time) ────────────────────────────────────
# There is no first-class Terraform resource for the billing-export *config* itself —
# it is enabled at the BILLING ACCOUNT level, not the project, and a project-scoped
# Terraform run cannot toggle it. Enable it once in the Console:
#   Billing → Billing export → BigQuery export → "Standard usage cost" → Edit settings
#   → pick/create a dataset (e.g. `billing_export` in this project, region us-central1).
# After that, query spend by the labels this stack already applies (app/environment/
# managed_by — see locals.tf) for the regular cost reviews the checklist calls for.

# Project number — google_billing_budget.budget_filter.projects requires the
# "projects/{number}" form, not the human-readable project ID.
data "google_project" "current" {
  project_id = var.project_id
}

resource "google_billing_budget" "monthly" {
  # Inert until a billing account is provided in terraform.tfvars.
  count = var.billing_account != "" ? 1 : 0

  billing_account = var.billing_account
  display_name    = "${local.name_prefix}-monthly"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_amount)
    }
  }

  # Threshold alerts on actual (CURRENT_SPEND) spend. With no notifications block,
  # Cloud Billing emails the billing-account admins at each threshold — enough for a
  # solo/dev setup without standing up a Pub/Sub topic. Add notifications_rule later
  # if alerts need to fan out to a channel or trigger automation.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.apis]
}
