# Public Exposure Checklist

Use this reference only for `cleanup public`.

Goal: find anything in this **public** GitHub repository — tracked files, untracked files, and full git history — that should never have been visible: credentials, tokens, private keys, connection strings, and real personal data (as opposed to fixture/seed data that only looks personal).

## How to read findings here

A public repo has no perimeter. Assume every commit ever pushed is already indexed by scrapers and bots — "we deleted it in a later commit" does **not** mean it is safe; the blob is still reachable via `git show <sha>:<path>` and via GitHub's own commit history UI. Treat "found in history but not in HEAD" as a live leak, not a lower-severity note — the fix (rotate the credential) is the same either way, only the file-removal step differs.

Do not downgrade a finding because the value "looks like a placeholder." Verify:

- Does it match a real provider's format (length, prefix, charset)? If yes, treat as real until the user confirms otherwise.
- Is it referenced as `process.env.X` / `.env.example` documentation / a code comment describing a pattern (e.g. `sk_live_...`)? That is not a leak — it is a name or a shape, not a value. Only the literal secret value is a finding.

## Secret Categories

### Tier 1 — Credentials and tokens (always Critical if found with a real-looking value)

- Cloud provider keys: AWS (`AKIA[0-9A-Z]{16}`, secret access keys), GCP service-account JSON (`"private_key"`), Azure connection strings.
- Stripe: `sk_live_`, `rk_live_` (never `sk_test_`/`pk_test_`/`pk_live_` — those are public-safe by Stripe's own design, see `stripe-best-practices` skill).
- Database connection strings with embedded credentials: `postgres://user:password@host`, Neon/Upstash URLs with a real token segment.
- OAuth client secrets (GitHub, Google) — the secret, not the public client ID.
- NextAuth `AUTH_SECRET` / `NEXTAUTH_SECRET` real values.
- Resend, Upstash Redis, S3 (`AWS_SECRET_ACCESS_KEY`), or any other provider API key referenced in `.env.example` as a name — flag only if a real value appears anywhere else.
- Private keys: `-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----`, `.pem`, `.pfx`, `.p12`, SSH `id_rsa`/`id_ed25519` (no `.pub`).
- Session tokens, JWTs with real (non-fixture) payloads, webhook signing secrets (`whsec_`).
- Personal access tokens: `ghp_`, `gho_`, `github_pat_`, `glpat-`.

### Tier 2 — Weak-signal secrets (flag, let the tool's entropy check and the user's read decide)

- High-entropy strings assigned to variables named `key`, `secret`, `token`, `password`, `credential` that don't match a known provider format.
- Hardcoded passwords in scripts, docker-compose, k8s manifests, or seed data that are not obviously fixture values (`password123`, `changeme`, `test` are fixture-safe; a random 16+ char string is not).

### Tier 3 — Real PII (distinct from Tier 1/2 — not a "secret" but still must not be public)

- Real email addresses, phone numbers, physical addresses, or names belonging to actual people (the user, contributors, real customers) — as opposed to obviously fake seed/fixture data (`test@example.com`, `Jane Doe`, `555-0100`).
- Screenshots or committed images that show real user data, real inboxes, or real dashboards from a paid provider account.
- Internal infrastructure details that are sensitive by exposure, not by secrecy of a single value: internal hostnames tied to a specific person/company, real GCP project IDs or AWS account IDs if the user considers them sensitive (ask — this repo's `infra/docs/08-gcp-bootstrap.md` and `CLAUDE.md` already document some IDs; confirm with the user whether project/account IDs count as sensitive here before flagging every occurrence).

## What is NOT a finding (do not flag)

- `.env.example` documenting a variable name with a placeholder value (`STRIPE_SECRET_KEY=sk_test_...`).
- Code, docs, or comments describing a secret's *shape/pattern* (e.g. a regex, a `grep` pattern, a written-out example like `sk_live_...`) with no real trailing characters.
- Seed/fixture/mock data clearly meant to be fake (`prisma/seed.ts`, `src/test/prisma-mock.ts`, anything under `**/fixtures/**`, `**/mocks/**`) unless it embeds a real-looking Tier 1 credential (fixtures should never contain a value that validates against a real provider — flag if unsure).
- Public, non-sensitive IDs: Stripe `pk_live_`/`pk_test_` publishable keys, OAuth client IDs (not secrets), public S3 bucket names already documented in `CLAUDE.md`/`infra/docs/`.
- Neon project/branch IDs and the GCP org ID/name are non-secret identifiers, not credentials — but this repo deliberately redacts them to placeholders in tracked docs (`<NEON_PROJECT_ID>`, `<NEON_DEV_BRANCH_ID>`, `<NEON_PROD_BRANCH_ID>`, `<ORG_ID>`, `<ORG_NAME>`). Treat a real literal value for any of these appearing in a tracked file as a finding to redact.

## Tooling

Run both, in this order, and merge results:

1. **secretlint** (npm devDependency, working tree + untracked files). Config: `.secretlintrc.json` at repo root.
2. **gitleaks**, only if already available on `PATH` (`command -v gitleaks`). If present, run its native git-history scan (`gitleaks git --log-opts="--all"`) for a second, higher-recall pass over every commit — it catches secrets that were committed and later removed, which secretlint's working-tree scan cannot see. If absent, fall back to the history-walk script (`scripts/scan-git-history.sh`), which reuses secretlint against each historical commit's snapshot. Note in the report which path ran.

Do not install gitleaks automatically (no brew/go install/binary download without asking) — the user already chose the npm-first, degrade-gracefully approach.

## Severity

- **Critical**: Tier 1 credential with a real-looking value, found anywhere (HEAD or history). Action: rotate immediately, then clean history.
- **Major**: Tier 2 weak-signal secret that a human confirms is real; or Tier 3 real PII exposed broadly (committed file, not just a name already public elsewhere).
- **Minor**: Tier 3 PII that is low-sensitivity or borderline (e.g. a real name in a git commit author field — normal and expected, not a finding by itself).

## Report, never fix automatically

This mode never edits, rotates, deletes, or rewrites history on its own. Every finding ends in a proposed remediation the user must approve — see `references/public-report.md` for the remediation menu (rotate credential, `git filter-repo`/BFG history rewrite, `.gitignore` addition, moving a value to `.env`).
