# Surfaced for infra/run/local/run.sh to consume. All null when cluster_active = false
# (the cluster is destroyed) — mirrors envs/dev/outputs.tf's null-when-suspended outputs.
output "cluster_name" {
  value = module.kind.cluster_name
}

# Path to the kubeconfig kind wrote (provider default ~/.kube/config unless overridden).
# run.sh can point kubectl at it; null when suspended.
output "kubeconfig_path" {
  value = module.kind.kubeconfig_path
}

output "cluster_endpoint" {
  value = module.kind.endpoint
}
