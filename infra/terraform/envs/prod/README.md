# `envs/prod` — production environment (Cloud Run + Firebase Hosting)

Root Terraform/OpenTofu module for DevStash **production**. Unlike `envs/dev` (a self-managed
GKE/Cloud SQL/Memorystore showcase) and `envs/local` (kind), prod is the real serverless stack:

- **Backend** (Go) on **Cloud Run** (`us-central1`), built + deployed by **Cloud Build** from
  GitHub (`backend/Dockerfile`).
- **Frontend** (React/Vite SPA) on **Firebase Hosting (classic)**, deployed by a GitHub Actions
  workflow (Frontend Track F0 — not built yet; this env provisions the cloud-side Hosting infra).

> ⚠️ **Shared project.** `dev` and `prod` are two environments in **one** GCP project
> (`project-39965ce5-4c4b-495e-8d4`, `us-central1`), not two projects. This env therefore
> **references** dev-owned shared resources instead of recreating them, and uses its **own**
> Artifact Registry repo so dev's suspend/resume never touches prod images. See _Design notes_.

## What this env manages

| Resource | Module | Notes |
|---|---|---|
| Cloud Run v2 service `devstash` | `modules/cloud-run` | `us-central1`, scale-to-zero (min 0 / max 20), env = plain `ENV`/`ALLOWED_ORIGINS`/`NEXT_PUBLIC_APP_URL`/`EMAIL_FROM` + one `APP_CONFIG` `secret_key_ref` to the consolidated `devstash-prod-config` secret. Image managed by Cloud Build (ignored by TF). |
| Cloud Run domain mapping `api.devstash.one` | `modules/cloud-run` | **Gated off by default** (`enable_domain_mapping = false`) — cutover step, see runbook. |
| Artifact Registry `devstash-prod` | `modules/artifact-registry` | Own repo (`us-central1`), always-on, `keep_count = 5`. |
| Cloud Build trigger | `modules/cloudbuild-trigger` | **Imported** (adopts the live console-created trigger); classic GitHub-App form. |
| Firebase project + Hosting site `devstash-beta` + custom domain `beta.devstash.one` | `modules/firebase-hosting` | Spark-tier `GROUPED` cert. `wait_dns_verification = false` until F0 ships. |
| Firebase deployer SA + WIF binding | `modules/firebase-hosting` | Binds to dev's **existing** `github-actions` WIF pool (no pool recreation). |

## Design notes

- **Secrets — one consolidated blob for literal $0.** ALL sensitive backend vars (`DATABASE_URL`,
  `REDIS_URL`, `AUTH_*`, `RESEND_API_KEY`) live JSON-encoded in a **single** Terraform-managed
  secret `devstash-prod-config` ([secrets.tf](secrets.tf)) — one active version, so the billing
  account stays inside Secret Manager's 6-free-version tier (**$0**, vs ~$0.24/mo for one secret
  per var). Cloud Run mounts it as the single `APP_CONFIG` env var; the Go backend's
  `config.hydrateFromAppConfig` ([backend/internal/config/config.go](../../../../backend/internal/config/config.go))
  splits it back into individual env vars at boot — Cloud Run, unlike dev's GKE + External Secrets
  Operator, can't split a secret itself. Values are **write-only** (`secret_data_wo`): never in
  Terraform state, supplied via `var.app_config` in the gitignored `terraform.tfvars`. Non-secret
  env (`ENV`, `ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `EMAIL_FROM`) is plain in `variables.tf`.
  This is the full set the Phase-1 backend needs to boot at `ENV=production`.
- **WIF pool reuse** — dev's `iam` module owns the single `github-actions` pool in this project.
  `modules/firebase-hosting` references it by name (`projects/<number>/.../github-actions`) and only
  adds prod's own `devstash-firebase-deployer` SA + a principalSet binding. Recreating the pool
  would collide (`ALREADY_EXISTS`) across the two states.
- **Own AR repo** — dev's `devstash` repo is `create = environment_active` (destroyed on every dev
  suspend), so prod cannot share it; hence `devstash-prod`.
- **No suspend/resume machinery** — prod stays up permanently; Cloud Run's `min-instances=0` is the
  cost lever. None of dev's `environment_active`/auto-suspend/lifecycle-SA apparatus is here.

## Prerequisites

1. **State bucket** — **not** managed by Terraform (chicken-and-egg: the GCS backend bucket must
   exist *before* `tofu init` can store state in it, so it can't be created by the Terraform that
   uses it). Created out-of-band via `gcloud`, same as `dev` — already done:
   ```bash
   gcloud storage buckets create gs://project-39965ce5-4c4b-495e-8d4-tfstate-prod \
     --project=project-39965ce5-4c4b-495e-8d4 --location=us-central1 \
     --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://project-39965ce5-4c4b-495e-8d4-tfstate-prod --versioning
   gcloud storage buckets update gs://project-39965ce5-4c4b-495e-8d4-tfstate-prod \
     --lifecycle-file=infra/data/tfstate-lifecycle.json
   ```
2. **`terraform.tfvars`** (gitignored) — copy `terraform.tfvars.example` and fill `project_number`
   plus the **`app_config`** map (all backend secret values). These are the only place the values
   live on disk; they're write-only into `devstash-prod-config` (never in state). Terraform creates
   that secret + grants the Cloud Run SA `secretAccessor` — **no manual `gcloud secrets create`**.
   The old individual secrets (`devstash-database-url`, `devstash-auth-*`) are superseded and get
   deleted after cutover (see the runbook) to reclaim their versions → $0.

## Commands

```bash
cd infra/terraform/envs/prod

# Offline validation (no cloud calls)
tofu init -backend=false && tofu validate && tofu fmt -recursive -check

# Real init against the state bucket
tofu init -reconfigure -backend-config="bucket=project-39965ce5-4c4b-495e-8d4-tfstate-prod"

tofu plan     # 1 to import, 20 to add, 1 to change, 0 to destroy (before any apply)
tofu apply    # only with explicit review — see cutover runbook below
```

## Region-cutover runbook (staged — NOT one apply)

Prod runs in `us-central1`; the live service is still `europe-west1`, and `api.devstash.one` maps
to only one service at a time. Run the stages **in order** — plain `tofu apply` alone is not enough,
because stage 3 needs a live-verified new service and the old domain mapping deleted first.

All commands assume these shell vars:

```bash
export PROJECT=project-39965ce5-4c4b-495e-8d4
export TRIGGER=9df333f5-0194-4213-bc85-d81fe3e0c64e   # the imported Cloud Build trigger id
cd infra/terraform/envs/prod
tofu init -reconfigure -backend-config="bucket=${PROJECT}-tfstate-prod"
```

### Stage 1 — stand up us-central1 (no domain cutover yet)

`enable_domain_mapping` is `false` by default, so this creates the service + `devstash-prod` repo +
Firebase infra and adopts/updates the trigger, without touching `api.devstash.one`.

```bash
tofu plan     # expect: 1 to import, 20 to add, 1 to change, 0 to destroy
tofu apply    # review, then approve

# imports.tf has done its job — remove it (import blocks are one-shot; the trigger now lives in
# state as a normal resource). Use `git rm` instead if it's already committed.
rm imports.tf
tofu plan     # expect: No changes. (import block gone, resource stays in state)
```

### Stage 2 — deploy the real image + verify

The trigger now builds `backend/Dockerfile` → pushes to `devstash-prod` → deploys to the us-central1
service, on push to `feature/go-backend-vite-spa` (the rewrite ships on that branch for the whole
strangler period; main still serves the Vercel Next.js app). That branch must contain `backend/Dockerfile`.

```bash
# either push to feature/go-backend-vite-spa, or run the trigger manually:
gcloud builds triggers run "$TRIGGER" --branch=feature/go-backend-vite-spa --region=global --project="$PROJECT"

# watch the build, then verify the new service serves /health on its *.run.app URL:
URL=$(gcloud run services describe devstash --region=us-central1 --project="$PROJECT" \
  --format='value(status.url)')
curl -sf "$URL/health" && echo "  <- us-central1 service healthy"
```

### Stage 3 — cut `api.devstash.one` over to us-central1

Only after stage 2 is green. A domain maps to one service at a time, so delete the old mapping
first, then let Terraform create the new one.

```bash
# 1. delete the old europe-west1 mapping
gcloud run domain-mappings delete --domain=api.devstash.one \
  --region=europe-west1 --platform=managed --project="$PROJECT" --quiet

# 2. create the us-central1 mapping via Terraform
tofu apply -var enable_domain_mapping=true    # expect: 1 to add (the domain mapping)

# 3. check the DNS records the new mapping wants
gcloud run domain-mappings describe --domain=api.devstash.one \
  --region=us-central1 --platform=managed --project="$PROJECT" \
  --format='value(status.resourceRecords)'
```

> DNS is almost certainly **unchanged**: Cloud Run subdomain mappings use a region-agnostic
> `CNAME api.devstash.one → ghs.googlehosted.com`, so the existing Spaceship record keeps working
> across the region move. Only update Spaceship if step 3 reports a record you don't already have.
> To make `enable_domain_mapping = true` the persisted default (not a per-apply `-var`), set it in
> `terraform.tfvars` instead.

### Stage 4 — decommission the old europe-west1 stack (outside Terraform — never imported)

Once `curl https://api.devstash.one/health` serves from us-central1:

```bash
gcloud run services delete devstash --region=europe-west1 --platform=managed \
  --project="$PROJECT" --quiet

# optional: the old auto-created repo (superseded by devstash-prod)
gcloud artifacts repositories delete cloud-run-source-deploy \
  --location=europe-southwest1 --project="$PROJECT" --quiet

# reclaim Secret Manager versions → literal $0: the individual secrets are now superseded by the
# consolidated devstash-prod-config blob (nothing references them once the old service is gone).
for s in devstash-database-url devstash-auth-secret devstash-auth-github-id \
         devstash-auth-github-secret devstash-auth-google-id devstash-auth-google-secret; do
  gcloud secrets delete "$s" --project="$PROJECT" --quiet
done
```

## Deferred follow-ups

- `imports.tf` is temporary — delete it after the trigger import is applied and confirmed.
- Move the Cloud Build deployer off the default Compute Engine SA to a dedicated least-privilege SA.
- Delete the superseded individual secrets after cutover (in the Stage 4 runbook) to reach literal
  $0 on Secret Manager. Until then both the blob and the old individuals exist (a few cents/mo).

## GitHub Actions secrets (after apply)

Set **out-of-band via `gh`, not Terraform** (same as `dev`): Terraform-managing them would need the
`integrations/github` provider + a long-lived GitHub PAT — the kind of standing credential the
keyless WIF setup exists to avoid. (These three values are non-sensitive identifiers anyway — SA
email, WIF provider path, project id — so they could equally be repo *variables*.) For the future
Firebase Hosting deploy workflow:
```bash
gh secret set GCP_PROJECT_ID --body "$(tofu output -raw gcp_project_id)"
gh secret set FIREBASE_DEPLOYER_SA --body "$(tofu output -raw firebase_deployer_service_account_email)"
gh secret set FIREBASE_WORKLOAD_IDENTITY_PROVIDER --body "$(tofu output -raw firebase_wif_provider)"
```
