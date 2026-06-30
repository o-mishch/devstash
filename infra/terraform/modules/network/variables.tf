variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names (e.g. devstash-dev)."
}

variable "region" {
  type = string
}

variable "waf_preview" {
  type        = bool
  default     = true
  description = "Log SQLi/XSS WAF matches without blocking. Set false only after reviewing false positives."
}
