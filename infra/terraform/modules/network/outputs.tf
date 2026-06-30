output "network_id" {
  value = google_compute_network.vpc.id
}

output "network_self_link" {
  value = google_compute_network.vpc.self_link
}

output "subnet_id" {
  value = google_compute_subnetwork.subnet.id
}

output "subnet_self_link" {
  value = google_compute_subnetwork.subnet.self_link
}

# Ingress static IP — DNS A-record target; name is referenced by the GCE Ingress
# annotation (global-static-ip-name) in overlays/gcp.
output "ingress_ip_name" {
  value = google_compute_global_address.ingress_ip.name
}

output "ingress_ip_address" {
  value = google_compute_global_address.ingress_ip.address
}

output "pods_range_name" {
  value = "pods"
}

output "services_range_name" {
  value = "services"
}

# The GKE/Cloud SQL/Memorystore modules depend on PSA being established before
# they create private-IP resources; expose it so the root can wire `depends_on`.
output "private_vpc_connection" {
  value = google_service_networking_connection.psa.id
}

# Cloud Armor security policy name — passed to the GKE overlay's BackendConfig
# annotation so the LB applies WAF + rate limiting.
output "armor_policy_name" {
  value = google_compute_security_policy.default.name
}
