#!/usr/bin/env bash
# Pre-deploy guard against the failure that TWICE broke the idle auto-suspend build: a step
# script calling a binary its builder image does not ship. We run the four gcloud steps on
# cloud-sdk:slim, which PREINSTALLS gcloud + python3 + git + ca-certificates so nothing is
# installed at runtime; the Python lives in standalone *.py helpers invoked with python3. This
# orchestrator pulls the exact DIGEST-pinned images declared in auto-suspend.tf and runs the
# in-container checks from the standalone probe (auto-suspend-image-probe.sh) — so a regression is
# caught here, not at 03:00 when the cluster silently fails to suspend. No script is inlined as a
# `sh -c` string: the container work lives in its own file. Run locally or in CI; needs docker +
# network. Exits non-zero on first miss.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tf="$(cd "$here/../terraform/envs/dev" && pwd)/auto-suspend.tf"
scripts_dir="$(cd "$here/../terraform/envs/dev/scripts" && pwd)"
probe="$here/auto-suspend-image-probe.sh"

# Read the digest-pinned image refs straight from the Terraform so this check can never drift
# from what the build actually runs.
cloud_sdk_image="$(sed -n 's/^[[:space:]]*cloud_sdk_image[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$tf")"
opentofu_image="$(sed -n 's/^[[:space:]]*opentofu_image[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$tf")"
if [ -z "$cloud_sdk_image" ] || [ -z "$opentofu_image" ]; then
  echo "could not read image refs from $tf"; exit 1
fi

echo "cloud-sdk image: $cloud_sdk_image"
echo "opentofu image:  $opentofu_image"

echo "== cloud-sdk(slim): deps preinstalled + step helpers byte-compile =="
# Mount the probe and the repo scripts read-only; bytecode goes to a writable cache outside them.
docker run --rm \
  -v "$probe":/probe.sh:ro \
  -v "$scripts_dir":/scripts:ro \
  -e PYTHONPYCACHEPREFIX=/tmp/pyc \
  "$cloud_sdk_image" sh /probe.sh

echo "== opentofu: tofu present (suspend step) =="
# The opentofu image's ENTRYPOINT is `tofu`, so the argument is passed straight to it.
docker run --rm "$opentofu_image" version >/dev/null && echo "tofu OK"

echo "ALL IMAGE CHECKS PASSED"
