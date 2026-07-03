# Regional quota preferences, managed as IaC so a fresh bootstrap gets the right
# limits and a Console tweak can't silently drift.
#
# --- SSD_TOTAL_GB (us-central1) --------------------------------------------------
# WHY THIS EXISTS: GKE Autopilot nodes run in a Google-managed tenant project — you
# cannot see or size their boot disks (`gcloud compute instances list` shows zero),
# yet each node's pd-balanced (SSD-class) boot disk bills against THIS project's
# regional SSD_TOTAL_GB quota. Steady-state usage is ~400 GB; the default 500 GB
# limit leaves only ~100 GB of headroom.
#
# That headroom is not enough for a node-pool SURGE. When a cluster reconcile
# recreates node pools (e.g. toggling an addon like the Filestore CSI driver) or a
# REGULAR-channel auto-upgrade rolls nodes, GKE creates the new nodes BEFORE deleting
# the old ones — momentarily needing >500 GB. Every new node then fails to create
# with `QUOTA_EXCEEDED: SSD_TOTAL_GB`, pods have nowhere to schedule, the ingress NEG
# drops to zero endpoints, and gke.devstash.one serves HTTP 502 until the old nodes
# finally drain and free space. Raising the limit gives surge/upgrade operations room
# to create-before-delete, removing that failure mode.
#
# It is FREE: Compute Engine bills on disk USAGE, not on the quota limit, and a deep
# suspend destroys the cluster so idle usage is $0 regardless of this ceiling.
#
# Autopilot gives no knob to shrink the boot disks (that needs GKE Standard node
# pools), so raising the quota is the proportionate fix rather than re-architecting.
# Related: the maxReplicas cap in infra/k8s/base/hpa.yaml bounds STEADY-STATE node
# count against this same quota; this preference covers the transient SURGE on top.
locals {
  # contact_email must be a bare address; email_from is in "Name <addr>" display form,
  # so pull the address out of the angle brackets (falls back to the value as-is if it
  # is already bare). Reuses the existing email var — no new notification variable.
  quota_contact_email = try(regex("<([^>]+)>", var.email_from)[0], var.email_from)
}

resource "google_cloud_quotas_quota_preference" "compute_ssd_total_gb" {
  parent   = "projects/${var.project_id}"
  name     = "compute-ssd-total-gb-${var.region}"
  service  = "compute.googleapis.com"
  quota_id = "SSD-TOTAL-GB-per-project-region"

  # Per-region quota: scope the preference to the deploy region.
  dimensions = {
    region = var.region
  }

  contact_email = local.quota_contact_email
  justification = "GKE Autopilot node boot-disk surge headroom for node-pool recreation and auto-upgrades; steady-state usage ~400 GB leaves too little room for create-before-delete."

  quota_config {
    # ~3.75x steady-state (~400 GB). Comfortable room for a full node-pool surge
    # without over-requesting. Increase-only here, so no ignore_safety_checks needed.
    preferred_value = 1500
  }

  depends_on = [google_project_service.apis]
}
