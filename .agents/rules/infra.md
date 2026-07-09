---
trigger: glob
globs:
  - infra/**/*.yaml
  - infra/**/*.yml
  - .github/workflows/**/*.yml
  - .github/workflows/**/*.yaml
paths:
  - "infra/**/*.yaml"
  - "infra/**/*.yml"
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
description: Infra YAML conventions for DevStash — keep shell logic out of manifests and workflows. Loads when editing Kubernetes manifests, GitHub Actions workflows, or other infra YAML.
---

# Infrastructure YAML

> This doc is YAML-only. The infra orchestration logic now lives in the `devstash-infra` Python CLI (`infra/cli/`); its conventions + strict test gate are covered in `infra-python.md`. GitHub Actions `run:` steps invoke that CLI (`uv run --project infra/cli devstash-infra …`); Kubernetes still mounts small shell via ConfigMaps.

## No inline scripts in YAML

**Rule:** Shell/command logic embedded in a YAML file must be **at most 2 lines**. Anything longer belongs in a standalone script file that the YAML calls by path.

Applies wherever YAML carries shell: Kubernetes `command`/`args` and lifecycle hooks, GitHub Actions `run:` steps, Cloud Run job commands, init containers, and any `sh -c "..."` block.

**Why:** Inline blobs are unreadable, untestable, un-lintable (shellcheck can't see them), and impossible to version meaningfully in a diff. A real file (or a typed CLI command) is reviewable, reusable, and testable. This repo keeps its orchestration in the `devstash-infra` CLI and its remaining shell in dedicated files (the Cloud Build shims under `infra/terraform/envs/dev/scripts/`) — follow that pattern; don't reverse it by inlining.

**Threshold:** 1–2 trivial lines (e.g. `command: ["sh", "-c", "exec app --flag"]`) stay inline. A third line, a loop, a conditional, a pipe chain, or any real branching → extract.

### How to extract

- **New script:** place it next to related scripts (`infra/ci/`, `infra/lib/`, or a script dir beside the manifest), make it `#!/usr/bin/env bash` with `set -euo pipefail`, and `chmod +x`.
- **Reference it by path** from the YAML — do not paste its contents back in.
- **Kubernetes:** when the script must live in-cluster, mount it via a ConfigMap volume and run the mounted path; do not inline a multi-line heredoc in `args`.
- **GitHub Actions:** a `run:` step over 2 lines calls the CLI (`run: uv run --project infra/cli devstash-infra ci <step>`) or a checked-in script, rather than growing an inline block.

```yaml
# ❌ wrong — multi-line logic inlined in the manifest
command:
  - sh
  - -c
  - |
    echo "waiting for db..."
    until pg_isready -h "$DB_HOST"; do sleep 2; done
    npx prisma migrate deploy
    exec node server.js
```

```yaml
# ✅ correct — logic in a checked-in script, called by path
command: ["/scripts/entrypoint.sh"]
# entrypoint.sh mounted via ConfigMap volume, or baked into the image
```

```yaml
# ✅ correct — GitHub Actions step delegates to the checked-in CLI
- name: Run migrations
  run: uv run --project infra/cli devstash-infra ci run-migrations
```

This mirrors the standing "no inline config in scripts" convention (keep config in its own file, reference by path) — same principle, applied to shell inside YAML.
