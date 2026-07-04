# Local kind cluster — the local analog of modules/gke. Provisions the CLUSTER ONLY;
# in-cluster manifests (Postgres/Redis/MinIO/pgAdmin + the app overlay) stay in kustomize
# and are applied by infra/run/local/run.sh, exactly as envs/dev stops at the GKE
# cluster and lets CI/run.sh apply manifests. No kubernetes_manifest here (it needs a live
# cluster + CRDs at plan time — a documented anti-pattern).

# Read the checked-in kind-config.yaml and decode it so the YAML file remains the single
# source of truth for the node + port-mapping layout. The provider has no "config by path"
# argument (kind_config is a nested block, not a file path), so we drive that block from the
# decoded content via dynamic blocks below — the YAML is referenced by path, never inlined.
locals {
  kind_config = yamldecode(file("${path.module}/${var.kind_config_path}"))
  # kind-config.yaml uses the upstream kind schema (camelCase): nodes[].extraPortMappings[]
  # with containerPort/hostPort/protocol. Normalise to the tehcyx provider's snake_case block
  # shape once here so the dynamic blocks stay readable.
  kind_nodes = [
    for node in local.kind_config.nodes : {
      role = node.role
      extra_port_mappings = [
        for m in try(node.extraPortMappings, []) : {
          container_port = m.containerPort
          host_port      = m.hostPort
          # protocol is optional in the YAML (kind defaults to TCP); preserve it when present.
          protocol = try(m.protocol, null)
        }
      ]
    }
  ]
}

resource "kind_cluster" "this" {
  # Cost/lifecycle toggle — count → 0 destroys the cluster (local suspend). Mirrors
  # modules/gke's google_container_cluster.primary count = var.cluster_active ? 1 : 0.
  count = var.cluster_active ? 1 : 0

  name = var.cluster_name
  # Block until the control plane is ready so run.sh's immediately-following kubectl apply
  # steps don't race a half-up API server (a bare `kind create cluster` already waits).
  wait_for_ready = true
  # Empty string → omit so the provider falls back to its default (~/.kube/config merge),
  # matching the previous `kind create cluster` behaviour. A non-empty value pins the file.
  kubeconfig_path = var.kubeconfig_path != "" ? var.kubeconfig_path : null

  kind_config {
    kind        = local.kind_config.kind
    api_version = local.kind_config.apiVersion

    dynamic "node" {
      for_each = local.kind_nodes
      content {
        role = node.value.role

        dynamic "extra_port_mappings" {
          for_each = node.value.extra_port_mappings
          content {
            container_port = extra_port_mappings.value.container_port
            host_port      = extra_port_mappings.value.host_port
            protocol       = extra_port_mappings.value.protocol
          }
        }
      }
    }
  }
}
