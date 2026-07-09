#!/bin/sh
# Cloud Build auto-suspend step shim (see auto-suspend.tf). The 6 steps (guard/prepare/dump/suspend/
# cleanup-builds/cleanup-negs) all run this one shim, dispatched by the per-step $_STEP env var, so
# there is no per-step script to drift. It does three things and nothing else:
#
#   1. Clone the repo ONCE into the shared /workspace/repo (idempotent — later steps reuse it).
#   2. Locate gcloud's BUNDLED python via `gcloud info`, NOT the image's system python3. This is
#      load-bearing: devstash_infra.shared.third_party finds gcloud's vendored libs (requests,
#      python-hcl2, jsonschema, kubernetes) by walking up from the bundled interpreter, so only the
#      bundled python resolves them — with zero install, preserving the digest-pin invariant.
#   3. Prepend /workspace/bin to PATH — where the extract-tofu step drops the digest-pinned static
#      tofu for the SUSPEND step. Harmless for the other steps (the dir is simply empty for them).
#
# The step's idle-sentinel gating (/workspace/SUSPEND) lives INSIDE the Python now: guard writes it,
# steps 2-6 no-op when it is absent — so the shim itself is unconditional.
set -eu
[ -d /workspace/repo ] || git clone --depth 1 --branch "$_REPO_BRANCH" "https://github.com/$_REPO_SLUG.git" /workspace/repo
PY="$(gcloud info --format='value(basic.python_location)')"
PYTHONPATH=/workspace/repo/infra/cli/src PATH="/workspace/bin:$PATH" exec "$PY" -m devstash_infra.cloudbuild "$_STEP"
