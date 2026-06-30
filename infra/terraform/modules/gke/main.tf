# GKE Autopilot cluster.
#
# Autopilot vs Standard:
#   Standard — you provision node pool VMs; pay per VM (~$50/node/month).
#   Autopilot — Google manages nodes; you pay per pod (CPU + RAM requested).
#              GKE still charges $0.10/cluster-hour, then applies up to $74.40 of
#              monthly free-tier credit per billing account to Autopilot/zonal clusters.
#              No google_container_node_pool resource needed or allowed.

resource "google_container_cluster" "primary" {
  name             = "${var.name_prefix}-gke"
  location         = var.region # regional = control plane replicated across zones (HA)
  enable_autopilot = true
  resource_labels  = var.labels

  network    = var.network_self_link
  subnetwork = var.subnet_self_link

  # VPC-native networking: pods/services use secondary IP ranges (alias IPs).
  # Required for NEG / container-native load balancing.
  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  # Workload Identity: pods authenticate to GCP APIs as a Google SA, no JSON keys.
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Private nodes — no public IPs on pods/nodes. The control plane's *public IP*
  # endpoint is disabled too (enable_private_endpoint = true): external access goes
  # exclusively through the DNS-based endpoint below, which is gated by IAM rather
  # than an IP allowlist. This removes the open public control-plane IP without
  # forcing a static-egress allowlist that GitHub's rotating runner IPs can't satisfy.
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = true
    # Optional on Autopilot, but when specified this /28 is used for the hosted
    # control-plane network and ILB VIP. It must not overlap any VPC, Pod, Service,
    # or Private Service Access range. Keep it explicit for deterministic addressing.
    master_ipv4_cidr_block = "172.16.0.0/28"
  }

  # DNS-based control-plane endpoint — the modern replacement for IP-based
  # master_authorized_networks. Reachable from outside the VPC (allow_external_traffic)
  # but authorized via Google IAM: CI authenticates with the Workload-Identity SA it
  # already holds (container.developer) using
  # `gcloud container clusters get-credentials --dns-endpoint`
  # (get-gke-credentials action: use_dns_based_endpoint: true). No public IP, no allowlist.
  #
  # allow_external_traffic = true is REQUIRED and CORRECT — DO NOT change it to false
  # and DO NOT delete this block. GitHub-hosted runners are OUTSIDE Google Cloud; with
  # external traffic disabled, the DNS endpoint's Google Front End refuses their packets
  # at the network layer, before IAM or kube-apiserver ever see them.
  #
  # ── FAILURE SIGNATURE / DRIFT GUARD ───────────────────────────────────────────
  # If a CI deploy fails at the first helm/kubectl call with:
  #     Error: Kubernetes cluster unreachable: <!DOCTYPE html> ... Error 403 (Forbidden)!!1
  #     ... That's an error. ... That's all we know.
  # that GENERIC Google HTML page is the GFE rejecting external traffic — it is NOT an
  # IAM problem. (An IAM denial instead names the permission:
  #     Permission 'container.clusters.connect' denied on resource ...
  # — see modules/iam/main.tf deployer_gke. Do NOT go remove that IAM condition chasing
  # this symptom.) The get-gke-credentials step still SUCCEEDS in this state because it
  # reads the cluster over the always-on regional container.googleapis.com API, not the
  # DNS endpoint — so a green "Get GKE credentials" step followed by a 403 on the first
  # API call is the tell.
  #
  # The generic 403 means the LIVE cluster has external traffic effectively off while
  # this code says true — i.e. drift (the attribute was added/changed but never applied,
  # or the cluster predates it). This is a NON-DESTRUCTIVE field, so reconcile in place:
  #     # confirm live state (read-only; expect True after the fix):
  #     gcloud container clusters describe devstash-dev-gke --region us-central1 \
  #       --format='value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)'
  #     # reconcile (authoritative — applies exactly this block):
  #     tofu apply           # from infra/terraform/envs/dev
  #     # gcloud equivalent for a hotfix without a full apply:
  #     gcloud container clusters update devstash-dev-gke --region us-central1 --enable-dns-access
  # The fix is to APPLY this config, never to edit the value here — it is already right.
  control_plane_endpoints_config {
    dns_endpoint_config {
      allow_external_traffic = true
    }
  }

  # Required by the GKE API when enable_private_endpoint = true.
  #
  # The GKE API maps `master_authorized_networks_config` to the v1 field
  # `masterAuthorizedNetworksConfig`. When `enable_private_endpoint = true` the API
  # requires `masterAuthorizedNetworksConfig.enabled = true` — but the Terraform
  # provider does NOT expose a top-level `enabled` boolean on this block (adding one
  # causes "Unexpected attribute" from the provider). Instead, the provider derives
  # `enabled = true` automatically from the presence of the block itself.
  #
  # `private_endpoint_enforcement_enabled = true` maps to the v1 API field
  # `privateEndpointEnforcementEnabled`, which satisfies the constraint:
  # "enable_master_authorized_networks should be enabled if private endpoint is enabled".
  # It enforces the authorized-networks check on the PRIVATE endpoint too, not just the
  # public one — which is the correct posture when the public IP endpoint is disabled.
  #
  # cidr_blocks is intentionally omitted: access is handled exclusively through the
  # DNS-based endpoint above (IAM-gated, no IP allowlist needed).
  # gcp_public_cidrs_access_enabled = false prevents Google's own public CIDRs from
  # bypassing the private endpoint restriction.
  #
  # DO NOT add an `enabled` attribute — it does not exist in the provider schema and
  # will cause a validate/plan error. The block's presence implies enabled = true.
  master_authorized_networks_config {
    private_endpoint_enforcement_enabled = true
    gcp_public_cidrs_access_enabled      = false
  }

  release_channel {
    channel = "REGULAR" # tested auto-upgrade cadence
  }

  # Restrict automatic GKE upgrades to a low-traffic window. Without this, the
  # REGULAR channel can upgrade the cluster during business hours. GKE requires at
  # least 48 hours of maintenance availability in every rolling 32 days and counts
  # only contiguous windows of 4+ hours. A 12-hour weekly window satisfies that
  # requirement; the old 4-hour weekly window did not.
  # The date component of start_time/end_time is irrelevant for recurring windows —
  # GCP only reads the time-of-day portion; the year/month/day are arbitrary anchors.
  maintenance_policy {
    recurring_window {
      start_time = "2025-01-05T02:00:00Z"
      end_time   = "2025-01-05T14:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SU"
    }
  }

  # Enable evaluation of the project Binary Authorization policy. The current
  # cluster-specific rule below is deliberately transitional ALWAYS_ALLOW, so this
  # does not yet enforce provenance. GitHub/Sigstore OCI attestations are not native
  # Binary Authorization attestations; enforcement requires a Container Analysis
  # attestor plus a CI step that signs the image digest for that attestor.
  binary_authorization {
    evaluation_mode = "PROJECT_SINGLETON_POLICY_ENFORCE"
  }

  # Environment policy, passed from root rather than edited in module source.
  # GKE requires false to be applied into state before destroy can delete the cluster.
  deletion_protection = var.deletion_protection
}

# Binary Authorization project-level policy.
# PROJECT_SINGLETON_POLICY_ENFORCE (set above) reads this policy. The default is
# ALWAYS_DENY so any future cluster has to opt in explicitly; this cluster has an
# ALWAYS_ALLOW exception until a real Binary Authorization attestor is provisioned.
#
# GitHub artifact attestations remain useful for `gh attestation verify`, but are a
# separate trust system and do not satisfy REQUIRE_ATTESTATION here.
#
# Full enforcement path:
#   1. Manage a Binary Authorization attestor and its Container Analysis note/key:
#      gcloud container binauthz attestors create devstash-slsa \
#        --attestation-authority-note=projects/<project>/notes/devstash-slsa \
#        --attestation-authority-note-public-keys=...
#   2. Have CI create a Binary Authorization attestation for each deployed digest.
#   3. Replace ALWAYS_ALLOW below with REQUIRE_ATTESTATION + require_attestations_by.
# Do not switch step 3 first: it blocks the web, migrator, and third-party init images.
resource "google_binary_authorization_policy" "default" {
  # Inherit Google's curated allow-list for GKE system images so the control plane
  # components are never blocked by the default deny rule.
  global_policy_evaluation_mode = "ENABLE"

  default_admission_rule {
    # Provider/API enum is ALWAYS_DENY. "DENY_ALL" is invalid and prevents validate/apply.
    evaluation_mode  = "ALWAYS_DENY"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
  }

  # Per-cluster override: allow ALL images on this cluster unconditionally.
  # DO NOT change evaluation_mode to "REQUIRE_ATTESTATION" until the devstash-slsa
  # attestor has been created and bound (see §Full enforcement path above) — doing so
  # without the attestor configured will block ALL image pulls and break the cluster.
  # Binary Authorization cluster rules cannot restrict by registry. This exception
  # includes Docker Hub images as well as Artifact Registry; it is a bootstrap state,
  # not supply-chain enforcement.
  #
  # ── cluster key format — DO NOT CHANGE without verifying the GCP API ──────────
  # The GCP Binary Authorization API and the Terraform google provider BOTH require
  # DOT-separated "location.clusterId" for the cluster_admission_rules map key:
  #
  #   Regional cluster in us-central1 → "us-central1.devstash-dev-gke"  ✓
  #   Zonal cluster in us-central1-a  → "us-central1-a.devstash-dev-gke"
  #
  # SLASH notation ("us-central1/devstash-dev-gke") is WRONG for both regional
  # and zonal clusters — it is silently treated as an unknown key, the per-cluster
  # override is ignored, and the default ALWAYS_DENY blocks every image pull.
  #
  # Source: Terraform provider docs (registry.terraform.io/providers/hashicorp/google
  # /latest/docs/resources/binary_authorization_policy) — "Identifier format:
  # {{location}}.{{clusterId}}". Confirmed in GCP REST API docs for
  # binaryauthorization.projects.policy clusterAdmissionRules field.
  #
  # This value has been toggled between "." and "/" by automated agents more than
  # once. The dot is authoritative — do not change it.
  cluster_admission_rules {
    cluster          = "${var.region}.${var.name_prefix}-gke"
    evaluation_mode  = "ALWAYS_ALLOW"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
  }
}
