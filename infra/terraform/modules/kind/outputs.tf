# Cluster attributes are null when the environment is suspended (cluster_active = false →
# the cluster is destroyed, count → 0). Callers that interpolate these must guard for null.
# Mirrors modules/gke/outputs.tf's try(...[0]..., null) pattern.
output "cluster_name" {
  value = try(kind_cluster.this[0].name, null)
}

# The kubeconfig file kind wrote. Empty var.kubeconfig_path → the provider's default
# (~/.kube/config) is returned as the computed attribute; the devstash-infra CLI uses this to target kubectl.
output "kubeconfig_path" {
  value = try(kind_cluster.this[0].kubeconfig_path, null)
}

# Full kubeconfig contents (computed). Sensitive — it embeds the client cert/key. Surfaced
# for callers that want to write a standalone kubeconfig instead of merging into the default.
output "kubeconfig" {
  value     = try(kind_cluster.this[0].kubeconfig, null)
  sensitive = true
}

output "endpoint" {
  value = try(kind_cluster.this[0].endpoint, null)
}
