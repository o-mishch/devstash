# Suspend/resume toggle — the local analog of envs/dev's environment_active. false destroys
# the kind cluster (modules/kind gates its kind_cluster resource on this via count). run.sh
# `down` drives this false through `tofu destroy`; `up` leaves it at the true default.
# Persisted (when set) in the gitignored active.auto.tfvars so a plain `tofu apply` keeps the
# chosen state, exactly as envs/dev persists environment_active.
variable "cluster_active" {
  type        = bool
  default     = true
  description = "Create the kind cluster. False = suspended (cluster destroyed). Local analog of environment_active."
}

variable "cluster_name" {
  type        = string
  default     = "devstash"
  description = "kind cluster name — must match what run.sh / kubectl tooling expects."
}

# Path to kind-config.yaml relative to the modules/kind directory (the module reads it via
# file()). The default in the module already points at the checked-in file; this override
# exists so run.sh could repoint it without editing module code.
variable "kind_config_path" {
  type        = string
  default     = "../../../k8s/local/kind-config.yaml"
  description = "Path to kind-config.yaml, relative to modules/kind (read via file()+yamldecode)."
}
