# Cost/lifecycle toggle. Mirrors modules/gke's cluster_active: false = the cluster is
# destroyed (count → 0). kind clusters are disposable and hold no persistent state worth
# keeping (Postgres/MinIO data live in emptyDir/hostPath inside the node and are recreated
# by run.sh on every `up`), so a "suspended" local env is simply no cluster at all — the
# same suspend/resume concept as GKE, applied to the local analog. run.sh `down` sets this
# false via tofu destroy; `up` leaves it true.
variable "cluster_active" {
  type        = bool
  default     = true
  description = "Create the kind cluster. False = destroyed (local analog of the GKE suspend toggle)."
}

variable "cluster_name" {
  type        = string
  default     = "devstash"
  description = "kind cluster name. Must match the name run.sh / kubectl-context tooling expects."
}

# Path to the kind cluster config on disk (infra/k8s/local/kind-config.yaml). The module
# reads it with file()+yamldecode and drives the provider's kind_config block from the decoded
# content, so the YAML file stays the single source of truth for the node/port-mapping layout —
# it is referenced by path, never copy-pasted into HCL. Default points at the checked-in file
# relative to this module.
variable "kind_config_path" {
  type        = string
  default     = "../../../k8s/local/kind-config.yaml"
  description = "Path to kind-config.yaml, read via file()+yamldecode so the YAML remains the single source of truth."
}

# Where kind writes the kubeconfig. Surfaced back out so run.sh can point kubectl at it.
# Empty = the provider uses its default (~/.kube/config merge), matching a bare `kind create`.
variable "kubeconfig_path" {
  type        = string
  default     = ""
  description = "Optional path for the generated kubeconfig. Empty = provider default (~/.kube/config)."
}
