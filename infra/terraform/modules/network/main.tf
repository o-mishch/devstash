# VPC + subnet + private connectivity for the managed services.
#
# Why a custom VPC (not "default"): the default network has permissive firewall
# rules and no control over IP ranges. A custom VPC with explicit ranges is the
# baseline for any production setup.

resource "google_compute_network" "vpc" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false # we define subnets explicitly
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${var.name_prefix}-subnet"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/20" # nodes

  # Secondary ranges for GKE VPC-native (alias IP) networking: pods and services
  # get their own ranges instead of NAT'd node IPs. Referenced by the GKE module.
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.20.0.0/14"
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.24.0.0/20"
  }

  private_ip_google_access = true # nodes reach Google APIs without public IPs
}

# --- Private Services Access: lets Cloud SQL / Memorystore get a PRIVATE IP on
# our VPC (via VPC peering) instead of a public endpoint. This is what keeps the
# database off the public internet. ----------------------------------------
resource "google_compute_global_address" "private_service_range" {
  name         = "${var.name_prefix}-psa"
  purpose      = "VPC_PEERING"
  address_type = "INTERNAL"
  # /16 reserves 65536 IPs for the PSA peering range (Cloud SQL + Memorystore private
  # IPs). A /24 would suffice for a single-service dev setup, but GCP recommends /16
  # as a safe default: PSA ranges cannot be resized after creation without destroying
  # and re-creating the peering connection (and the managed services it backs).
  # DO NOT reduce this without a full destroy-and-recreate of Cloud SQL + Memorystore.
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]
}

# --- Global static IP for the Ingress (HTTP(S) Load Balancer) --------------
# The GCE Ingress in overlays/gcp references this by name via the
# `kubernetes.io/ingress.global-static-ip-name` annotation. It must be a GLOBAL
# EXTERNAL address (external HTTP(S) LB is global), NOT the regional/internal PSA
# range above. DNS A-record for the app domain points here; the Google-managed
# cert only provisions once that DNS resolves to this IP.
resource "google_compute_global_address" "ingress_ip" {
  name = "${var.name_prefix}-ip" # -> "devstash-dev-ip" (matches the overlay annotation)
}

# --- Cloud NAT: private nodes have no external IP, so outbound internet (pulling
# from Resend/Stripe/OAuth, npm, etc.) goes through a NAT gateway. ----------
resource "google_compute_router" "router" {
  name    = "${var.name_prefix}-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  name   = "${var.name_prefix}-nat"
  router = google_compute_router.router.name
  region = var.region
  # AUTO_ONLY: GCP picks and rotates the external IPs used for egress NAT.
  # Fine for a dev environment. For production, switch to MANUAL_ONLY with
  # reserved static IPs (google_compute_address) if a stable egress IP is needed
  # for third-party allowlisting. Stripe and Resend do NOT require IP allowlisting,
  # so AUTO_ONLY is sufficient for the current service integrations.
  #
  # UPGRADE PATH TO STABLE EGRESS (if a downstream requires IP allowlisting):
  #   1. Add: resource "google_compute_address" "nat_ips" { count = 2; region = ... }
  #   2. Change: nat_ip_allocate_option = "MANUAL_ONLY"
  #   3. Add: nat_ips = [for ip in google_compute_address.nat_ips : ip.self_link]
  #   4. `tofu apply` — no service disruption, existing connections survive NAT IP change.
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  # Log only errors (translation failures, port exhaustion) — not every
  # connection. This is enough to debug outbound connectivity issues without
  # flooding Cloud Logging with routine NAT traffic.
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# --- Cloud Armor security policy (WAF + rate limiting) ----------------------
# Attached to the GCE HTTP(S) load balancer via the BackendConfig annotation.
# Provides DDoS mitigation and per-IP rate limiting at the LB edge — before
# traffic reaches pods. Complements the NetworkPolicy which only operates
# inside the cluster.
resource "google_compute_security_policy" "default" {
  name        = "${var.name_prefix}-armor"
  description = "Cloud Armor WAF + rate limiting for the DevStash GKE ingress"

  # Adaptive Protection: GCP's ML layer for L7 DDoS anomalies. On Cloud Armor
  # Standard this produces only basic alerts; attack signatures, suggested rules,
  # and full alert detail require Cloud Armor Enterprise. Enabling this block does
  # not auto-deploy mitigations: that additionally requires an explicit
  # evaluateAdaptiveProtectionAutoDeploy() policy rule. Keep it enabled for the
  # basic signal, but do not describe it as automated blocking.
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }

  # Strict rate limit on auth endpoints (sign-in, register, password flows).
  # These accept credentials and are the primary brute-force/credential-stuffing
  # surface. 20 req/min per IP is generous for legitimate use (OAuth redirects,
  # MFA flows) while blocking automated attacks. Cloud Armor is first-match: this
  # runs after WAF priority 50 but before the global rate limit. Benign auth traffic
  # stops here; malicious auth traffic can be denied by WAF first.
  rule {
    action   = "throttle"
    priority = 100
    match {
      expr {
        expression = "request.path.matches('^/api/auth/') || request.path.matches('^/register') || request.path.matches('^/forgot-password') || request.path.matches('^/reset-password')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 20
        interval_sec = 60
      }
    }
    description = "Strict rate limit: 20 req/min per IP on auth/credential endpoints"
  }

  # OWASP pre-configured WAF rules: block SQL injection and XSS at the LB edge.
  # They are available on Cloud Armor Standard but normal policy/rule/request
  # charges still apply; "available without Enterprise" does not mean no-cost.
  # Priority 50 is deliberate. Cloud Armor stops at the first matching rule, so placing
  # WAF after the auth throttle would let every matching auth request bypass WAF.
  # It remains before both auth (100) and global (1000) rate limits.
  # Scope: sqli + xss cover the highest-risk attack classes for a Next.js API.
  # Additional rule sets available (not enabled — evaluate impact before adding):
  #   lfi-v33-stable (path traversal), rfi-v33-stable (remote file inclusion),
  #   methodenforcement-v33-stable, scannerdetection-v33-stable, protocolattack-v33-stable.
  # Run in PREVIEW mode first to measure false positives on auth forms, editor content,
  # and code snippets. `waf_preview=true` still logs the deny decision but does not
  # block it. Promote deliberately by setting the module input false after review.
  rule {
    action   = "deny(403)"
    priority = 50
    preview  = var.waf_preview
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable') || evaluatePreconfiguredExpr('xss-v33-stable')"
      }
    }
    description = "Block SQLi and XSS (OWASP pre-configured WAF)"
  }

  # Rate-limit rule: 1 000 req/min per source IP; excess → 429.
  # Runs before the allow-all default so it applies to all traffic.
  rule {
    action   = "rate_based_ban"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 1000
        interval_sec = 60
      }
      # Ban the offending IP for 5 minutes after the threshold is exceeded.
      ban_duration_sec = 300
      ban_threshold {
        count        = 1500
        interval_sec = 60
      }
    }
    description = "Rate limit: 1000 req/min per IP; ban at 1500"
  }

  # Default: allow all other traffic. Must be last (highest priority number).
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow"
  }
}
