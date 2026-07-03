#!/usr/bin/env python3
"""Assemble the auto-suspend secrets tfvars blob (third_party_secrets + spaceship_*).

Invoked by auto-suspend-prepare.sh (Cloud Build step 2) via the cloned-repo path, e.g.
  python3 repo/infra/terraform/envs/dev/scripts/build-secrets-tfvars.py "$_SECRET_KEYS" \
    > repo/infra/terraform/envs/dev/zz-secrets.auto.tfvars.json

Kept as a standalone, independently lintable/testable file rather than an inline heredoc so
the JSON-assembly logic is not embedded in the shell step (same rationale as tfstate-lifecycle.json).

App credentials are now ONE consolidated secret (devstash-app-config); the prepare step
wrote its JSON to /workspace/sec/app-config.json. This reads that blob, extracts the
third_party_secrets subset named in argv, and prints a single JSON object to stdout for
redirection into a tofu-autoloaded *.auto.tfvars.json. Extracting only the user keys (not
the TF-minted database-*/redis-*/s3-* properties) matches what var.third_party_secrets
expects — Terraform re-derives the infra keys itself on the suspend apply.

Argv: space-separated app secret keys (the third_party_secrets names). The Spaceship creds
are optional — folded in only if the consolidated ops blob (ops-config.json) is present on
disk (a project without DNS creds omits it).
"""

import json
import os
import sys

SEC_DIR = "/workspace/sec"

keys = sys.argv[1].split()
with open(os.path.join(SEC_DIR, "app-config.json")) as fh:
    app_config = json.load(fh)
# KeyError here is intentional: a required third_party_secrets key missing from the blob is
# a real misconfiguration that must fail the build, not silently drop the key.
out = {"third_party_secrets": {k: app_config[k] for k in keys}}
# Ops creds are one consolidated JSON blob (devstash-ops-config) with spaceship-api-key /
# spaceship-api-secret properties — split them back into the two tofu variables. Absent blob →
# a project without DNS automation; simply omit both vars (their tofu default is "").
ops_path = os.path.join(SEC_DIR, "ops-config.json")
if os.path.exists(ops_path):
    with open(ops_path) as fh:
        ops_config = json.load(fh)
    for var, prop in (("spaceship_api_key", "spaceship-api-key"), ("spaceship_api_secret", "spaceship-api-secret")):
        if ops_config.get(prop):
            out[var] = ops_config[prop]
print(json.dumps(out))
