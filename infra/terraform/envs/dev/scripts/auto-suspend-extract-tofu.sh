#!/bin/sh
# Cloud Build auto-suspend — EXTRACT TOFU (Option 4, see auto-suspend.tf / context/current-feature).
# The pinned opentofu image is a statically-linked Go binary, so its `tofu` runs anywhere; copy it
# into the shared /workspace/bin (Google-recommended /workspace binary passing) so the next step,
# SUSPEND, can run tofu on cloud-sdk:slim where gcloud + python3 are ALSO present. That co-presence
# is the whole point: the force-unlock / lock-contention layer the suspend step drives needs
# gcloud + python3, which the bare opentofu image lacks — so historically it was dead there.
set -eu
mkdir -p /workspace/bin
cp "$(command -v tofu)" /workspace/bin/tofu
