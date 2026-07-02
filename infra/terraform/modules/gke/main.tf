# GKE Autopilot cluster.
#
# Autopilot vs Standard:
#   Standard — you provision node pool VMs; pay per VM (~$50/node/month).
#   Autopilot — Google manages nodes; you pay per pod (CPU + RAM requested).
#              GKE still charges $0.10/cluster-hour, then applies up to $74.40 of
#              monthly free-tier credit per billing account to Autopilot/zonal clusters.
#              No google_container_node_pool resource needed or allowed.

resource "google_container_cluster" "primary" {
  # Cost toggle. The cluster is the largest line item; it holds no persistent state
  # (the app's data lives in Cloud SQL, which is kept), so it is fully destroyed when
  # the environment is suspended and re-created on resume. Only the CLUSTER is gated —
  # the Binary Authorization KMS key / attestor / policy below are NOT (the KMS key has
  # prevent_destroy and must survive a suspend, so they stay always-on and ungated).
  count            = var.cluster_active ? 1 : 0
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

  # Secret Manager add-on (secret_manager_config) is DELIBERATELY omitted. It is a GKE
  # golden-path default, but this stack already reaches Secret Manager through External
  # Secrets Operator (see k8s/overlays/gcp/external-secrets.yaml) materializing a K8s
  # Secret, so the managed CSI add-on would add a standing controller for no benefit —
  # counter to the $0-idle / minimal-running-cost posture. Do NOT add it to "close a
  # golden-path gap"; the omission is intentional. Revisit only if a workload needs the
  # Secret Manager CSI driver's live-mount/rotation semantics that ESO does not provide.

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
  # ── FAILURE SIGNATURE (resolved) ──────────────────────────────────────────────
  # CI once failed at the first helm/kubectl call with:
  #     Error: Kubernetes cluster unreachable: <!DOCTYPE html> ... Error 403 (Forbidden)!!1
  #     ... That's an error. ... That's all we know.
  # That GENERIC Google HTML page is a Google-Front-End rejection at the DNS endpoint.
  # CONFIRMED CAUSE (commit a051ad7, verified green afterwards): an IAM Condition on the
  # deployer's container role pinned resource.name to the cluster path, which the DNS
  # endpoint does NOT match when checking container.clusters.connect — so the GFE returned
  # this page. Removing that condition fixed it (see modules/iam/main.tf deployer_gke).
  # allow_external_traffic was already ON; it was NOT the cause this time.
  # The get-gke-credentials step still SUCCEEDS under this 403 because it reads the cluster
  # over the always-on regional container.googleapis.com API, not the DNS endpoint — so a
  # green "Get GKE credentials" followed by a 403 on the first API call is the tell.
  #
  # If this 403 ever RECURS, check BOTH gates before editing code:
  #   (a) this value is actually applied on the LIVE cluster (drift) —
  #       gcloud container clusters describe devstash-dev-gke --region us-central1 \
  #         --format='value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)'  # expect True
  #       tofu apply   # from infra/terraform/envs/dev (applies this block authoritatively)
  #   (b) no resource-name IAM Condition was re-added to the deployer (modules/iam/main.tf).
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

  # Cost-optimized telemetry (var.full_observability = false, the dev default). Present ONLY
  # when trimming: on full_observability = true both blocks are omitted so Autopilot applies
  # its full-observability defaults (all monitoring components + Advanced Datapath metrics +
  # WORKLOADS logs) for prod parity. When present, telemetry is cut to SYSTEM_COMPONENTS only —
  # GKE system metrics/logs are non-chargeable, so this drops the billable
  # kube-state/cadvisor/kubelet/DCGM sample streams and workload log ingestion. SYSTEM_COMPONENTS
  # is the required minimum on Autopilot (it cannot be fully disabled). The idle auto-suspend
  # alert reads a Cloud Load Balancing metric, not a GKE monitoring component, so this trim never
  # affects idle detection (see envs/dev/auto-suspend.tf).
  #
  # managed_prometheus MUST stay enabled: GKE Autopilot (1.25+) forbids disabling Managed Service
  # for Prometheus and the API rejects `enabled = false` with a 400
  # ("Managed Service for Prometheus cannot be disabled in Autopilot clusters"). It costs nothing
  # on its own — Cloud Monitoring bills per ingested sample, and with the metric components above
  # trimmed and no PodMonitoring/ClusterPodMonitoring CRs deployed, GMP scrapes nothing. The cost
  # is gated by enable_components, not by this toggle. Do NOT set it to false: it fails the apply
  # after logging already updated, leaving a half-applied changeset.
  dynamic "monitoring_config" {
    for_each = var.full_observability ? [] : [1]
    content {
      enable_components = ["SYSTEM_COMPONENTS"]
      managed_prometheus {
        enabled = true
      }
      # enable_metrics MUST be true: with datapathProvider = ADVANCED_DATAPATH, GKE keeps
      # advanced-datapath flow metrics enabled and silently re-asserts true — setting false
      # here does NOT stick (the UpdateCluster succeeds but the value stays true), so it only
      # produced a permanent `tofu plan` diff (true -> false on every plan). It is cost-neutral:
      # enable_metrics only EXPOSES the flow metrics on a node port; Cloud Monitoring bills per
      # INGESTED sample, and with enable_components trimmed to SYSTEM_COMPONENTS and no
      # PodMonitoring/ClusterPodMonitoring CRs nothing scrapes them — same "gated by
      # enable_components, not the toggle" logic as managed_prometheus above. enable_relay stays
      # false (the billable GKE-hosted flow-log relay; that one IS honored and off).
      advanced_datapath_observability_config {
        enable_metrics = true
        enable_relay   = false
      }
    }
  }

  dynamic "logging_config" {
    for_each = var.full_observability ? [] : [1]
    content {
      # WORKLOADS dropped — the app's Cloud SQL/Redis errors surface in the workload logs the
      # envs/dev logging.tf exclusion deliberately preserves; system-namespace noise is already
      # excluded there. SYSTEM_COMPONENTS retained (required, non-chargeable) for control-plane
      # visibility during the cluster's active window.
      enable_components = ["SYSTEM_COMPONENTS"]
    }
  }

  # Enable evaluation of the project Binary Authorization policy. The current
  # cluster-specific rule below is deliberately transitional ALWAYS_ALLOW, so this
  # does not yet enforce provenance. GitHub/Sigstore OCI attestations are not native
  # Binary Authorization attestations; enforcement requires a Container Analysis
  # attestor plus a CI step that signs the image digest for that attestor.
  # Gated by var.binauthz_enabled: when the signing pipeline below is omitted (dev $0
  # posture), the cluster carries no binary_authorization block at all (GKE default =
  # DISABLED) so there is no dangling reference to a non-existent policy/attestor.
  dynamic "binary_authorization" {
    for_each = var.binauthz_enabled ? [1] : []
    content {
      evaluation_mode = "PROJECT_SINGLETON_POLICY_ENFORCE"
    }
  }

  # Environment policy, passed from root rather than edited in module source.
  # GKE requires false to be applied into state before destroy can delete the cluster.
  deletion_protection = var.deletion_protection
}

# --- Binary Authorization attestor: KMS-backed signing key + Container Analysis note.
#
# This provisions the FULL signing pipeline (step 1 of the enforcement path below) and
# CI now signs every deployed digest (step 2, see .github/workflows/deploy-gke.yml
# "Sign images for Binary Authorization"). The cluster admission rule further below is
# DELIBERATELY left at ALWAYS_ALLOW (step 3 NOT applied yet) — see that resource's
# comment for the exact, verified-safe flip-over steps. Do not flip it as part of
# applying this block; the two are independent and sequenced on purpose.
#
# KMS-backed (not a locally-generated PGP/PKIX keypair): the private key material never
# leaves Google Cloud KMS, consistent with this stack's existing keyless-auth posture
# (Workload Identity for pods, WIF for CI — no exported credentials anywhere). CI signs
# by invoking KMS (roles/cloudkms.signerVerifier, granted to the deployer SA in
# modules/iam/main.tf), never by handling a private key file.
# The whole signing pipeline (keyring → key → note → attestor → policy) is gated by
# var.binauthz_enabled. Default false (dev) removes the KMS key — the only idle resource
# with no free tier — for a literal $0 suspended footprint. The key deliberately carries
# NO prevent_destroy: that lifecycle flag must be a static literal (it cannot be
# var.binauthz_enabled), so keeping it would permanently block dev from flipping the flag
# off once the key exists in state. Destroying the crypto key only tears down its billed
# key VERSION (GCP forbids deleting the keyring/key shells outright), so a flag flip is
# reversible; prod safety comes from binauthz_enabled being permanently true there
# (count stays 1 — the key is only ever destroyed by a deliberate flag flip), not from a
# lifecycle guard that would break the dev/prod count gate.
resource "google_kms_key_ring" "binauthz" {
  count    = var.binauthz_enabled ? 1 : 0
  name     = "${var.name_prefix}-binauthz-keyring"
  location = "global" # Binary Authorization attestors are global resources.
}

resource "google_kms_crypto_key" "binauthz_signer" {
  count    = var.binauthz_enabled ? 1 : 0
  name     = "${var.name_prefix}-binauthz-signer"
  key_ring = google_kms_key_ring.binauthz[0].id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm = "EC_SIGN_P256_SHA256"
  }
}

# KMS auto-creates version "1" for a new asymmetric key; read its public key (PEM) to
# register with the attestor below. No private key material is ever read here.
data "google_kms_crypto_key_version" "binauthz_signer_version" {
  count      = var.binauthz_enabled ? 1 : 0
  crypto_key = google_kms_crypto_key.binauthz_signer[0].id
}

resource "google_container_analysis_note" "devstash_slsa" {
  count = var.binauthz_enabled ? 1 : 0
  name  = "${var.name_prefix}-slsa"

  attestation_authority {
    hint {
      human_readable_name = "DevStash Binary Authorization attestor (${var.name_prefix})"
    }
  }
}

resource "google_binary_authorization_attestor" "devstash_slsa" {
  count = var.binauthz_enabled ? 1 : 0
  name  = "${var.name_prefix}-slsa"

  attestation_authority_note {
    note_reference = google_container_analysis_note.devstash_slsa[0].name

    public_keys {
      id = data.google_kms_crypto_key_version.binauthz_signer_version[0].name

      pkix_public_key {
        public_key_pem      = data.google_kms_crypto_key_version.binauthz_signer_version[0].public_key[0].pem
        signature_algorithm = "ECDSA_P256_SHA256"
      }
    }
  }
}

# Binary Authorization project-level policy.
# PROJECT_SINGLETON_POLICY_ENFORCE (set above) reads this policy. The default is
# ALWAYS_DENY so any future cluster has to opt in explicitly; this cluster has an
# ALWAYS_ALLOW exception until enforcement is deliberately turned on (see below).
#
# GitHub artifact attestations remain useful for `gh attestation verify`, but are a
# separate trust system and do not satisfy REQUIRE_ATTESTATION here.
#
# Full enforcement path:
#   1. DONE — google_binary_authorization_attestor.devstash_slsa above (KMS-backed).
#   2. DONE — CI signs every deployed digest in deploy-gke.yml ("Sign images for
#      Binary Authorization"). Confirm attestations are actually landing before
#      proceeding to step 3:
#        gcloud container binauthz attestations list \
#          --attestor=devstash_slsa --attestor-project=<project>
#      Check this after a few real deploys, not just once — a single success can hide
#      an intermittent signing failure.
#   3. NOT DONE (intentionally) — once step 2 is verified across multiple deploys,
#      replace the ALWAYS_ALLOW cluster_admission_rules block below with:
#        evaluation_mode        = "REQUIRE_ATTESTATION"
#        require_attestations_by = [google_binary_authorization_attestor.devstash_slsa.name]
#      Do not switch step 3 first or before step 2 is verified: it blocks the web,
#      migrator, and third-party init images immediately on the next pod schedule.
resource "google_binary_authorization_policy" "default" {
  count = var.binauthz_enabled ? 1 : 0
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
