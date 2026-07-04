# The kind provider talks to the local Docker daemon and needs no credentials or region
# (unlike envs/dev's google/google-beta providers). The block is declared explicitly for
# parity with envs/dev/providers.tf and as the anchor for any future provider settings.
provider "kind" {}
