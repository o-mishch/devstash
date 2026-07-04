# Root module for the `local` environment. Mirrors envs/dev/main.tf's module-per-resource
# layout — but the only building block a local kind stack needs is the cluster itself. Like
# envs/dev (which stops at the GKE cluster and lets run.sh/CI apply manifests), Terraform
# here provisions the CLUSTER ONLY; the in-cluster backing services and app overlay stay in
# kustomize and are applied by infra/run/local/run.sh.
module "kind" {
  source = "../../modules/kind"

  # Cost/lifecycle toggle: destroy the cluster when suspended. Mirrors how envs/dev/main.tf
  # passes var.environment_active into module.gke's cluster_active.
  cluster_active   = var.cluster_active
  cluster_name     = var.cluster_name
  kind_config_path = var.kind_config_path
}
