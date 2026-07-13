# `envs/prod` — production (Cloud Run + Firebase Hosting)

Terraform/OpenTofu for DevStash **production** on GCP (project `project-39965ce5-4c4b-495e-8d4`,
region `us-central1`):

- **Backend** — Go on **Cloud Run**, built + deployed by **Cloud Build** from `backend/Dockerfile`.
- **Frontend** — Vite SPA on **Firebase Hosting** (deployed by a future GitHub Actions workflow).

Shared GCP project with `dev`: this env **references** dev's `github-actions` WIF pool and uses its
**own** `devstash-prod` Artifact Registry repo (dev's is destroyed on suspend).

**Live:** `curl https://api.devstash.one/health` → `200`.

## Resources

| Resource | Notes |
|---|---|
| Cloud Run `devstash` | us-central1, scale-to-zero (min 0 / max 20), **public** (`allUsers` invoker — app does its own auth). Image + revision labels owned by Cloud Build (TF ignores them). |
| Artifact Registry `devstash-prod` | us-central1, cleanup keeps 5 newest. |
| Cloud Build trigger | On push to `feature/go-backend-vite-spa`: build `backend/Dockerfile` → push to `devstash-prod` → deploy to Cloud Run. |
| Secret `devstash-prod-config` | One JSON blob of every sensitive var, mounted as `APP_CONFIG`; the backend splits it into env vars at boot. One version = Secret Manager free tier. |
| Firebase Hosting `devstash-beta` (+ `beta.devstash.one`) | SPA host, Spark tier. Deployer SA is keyless via the shared WIF pool. |
| Domain mapping `api.devstash.one` | → Cloud Run. Off by default; set `enable_domain_mapping = true`. |

## Prerequisites

1. **State bucket** (out-of-band, already created):
   `gs://project-39965ce5-4c4b-495e-8d4-tfstate-prod`.
2. **`terraform.tfvars`** (gitignored) — copy `terraform.tfvars.example`, fill `project_number` and
   the `app_config` map (all backend secret values; written write-only into `devstash-prod-config`,
   never stored in state).

## Usage

```bash
cd infra/terraform/envs/prod

# offline check
tofu init -backend=false && tofu validate && tofu fmt -recursive -check

# real init + apply
tofu init -reconfigure -backend-config="bucket=project-39965ce5-4c4b-495e-8d4-tfstate-prod"
tofu plan
tofu apply
```

## Deploy the backend

Push to `feature/go-backend-vite-spa`; Cloud Build builds and deploys automatically. Or trigger it:

```bash
gcloud builds triggers run 9df333f5-0194-4213-bc85-d81fe3e0c64e \
  --branch=feature/go-backend-vite-spa --region=global \
  --project=project-39965ce5-4c4b-495e-8d4
curl -sf https://api.devstash.one/health
```

## $0 by design

All within free tiers — keep it that way (no always-on instances, no extra secret versions):
Cloud Run scale-to-zero (2M req/mo) · Secret Manager (3 active versions ≤ 6) · Artifact Registry
(~17 MB ≤ 500 MB) · Firebase Spark · Upstash/Neon free.

## Gotchas

- **Managed domain-mapping CLI is under `gcloud beta run domain-mappings`** — the GA group is
  Cloud-Run-for-Anthos only and rejects `--region`. To move the domain: create the new mapping,
  delete the old one to release the domain, then the cert provisions against the existing
  `CNAME api.devstash.one → ghs.googlehosted.com` (edge propagation ~minutes; brief HTTPS gap).
- **GitHub Actions secrets** (for the Firebase deploy workflow) — set via `gh`, not Terraform:
  `gh secret set GCP_PROJECT_ID / FIREBASE_DEPLOYER_SA / FIREBASE_WORKLOAD_IDENTITY_PROVIDER`
  from the matching `tofu output`s.
- **TODO:** move the Cloud Build deployer off the default Compute Engine SA to a dedicated SA.
