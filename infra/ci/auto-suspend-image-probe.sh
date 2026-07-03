#!/bin/sh
# In-container probe for the cloud-sdk:slim builder. Run by auto-suspend-image-check.sh, which
# mounts this file at /probe.sh and the repo scripts dir at /scripts (read-only). Kept as its own
# file so the orchestrator never inlines a `sh -c '...'` script string. Asserts the deps the four
# gcloud steps rely on are present, then byte-compiles the Python step-helpers with the image's
# own python3 so a helper that fails to parse under it is caught before deploy.
set -e
for b in gcloud git python3; do
  command -v "$b" >/dev/null || { echo "MISS $b"; exit 1; }
done
[ -e /etc/ssl/certs/ca-certificates.crt ] || { echo "MISS ca-certificates bundle"; exit 1; }
python3 -m py_compile /scripts/build-secrets-tfvars.py /scripts/auto-suspend-idle-count.py
echo "cloud-sdk slim probe OK"
