# `envs/prod` — production (Cloud Run + Firebase Hosting)

Terraform/OpenTofu for DevStash **production** on GCP (project `project-39965ce5-4c4b-495e-8d4`,
region `us-central1`):

- **Backend** — Go on **Cloud Run**, built + deployed by **Cloud Build** via **`ko`** (no Dockerfile
  at build time; `backend/.ko.yaml`).
- **Frontend** — Vite SPA on **Firebase Hosting**, built + deployed by a **second Cloud Build
  trigger** (same CI system as the backend — not GitHub Actions).

Shared GCP project with `dev`, but prod is self-contained: it uses its **own** `devstash-prod`
Artifact Registry repo (dev's is destroyed on suspend) and its **own** dedicated deployer service
accounts. It no longer references dev's `github-actions` WIF pool.

**Live:** `curl https://api.devstash.one/health` → `200`. SPA: `https://beta.devstash.one`.

## Resources

| Resource | Notes |
|---|---|
| Cloud Run `devstash` | us-central1, scale-to-zero (min 0 / max 20), **public** (`allUsers` invoker — app does its own auth). Image + revision labels owned by Cloud Build (TF ignores them). |
| Artifact Registry `devstash-prod` | us-central1, cleanup keeps 5 newest. |
| Domain mapping `api.devstash.one` | → the us-central1 `devstash` service. **ON** since the 2026-07-13 cutover (`enable_domain_mapping` default `true`). Cloud Run provisions the managed cert against `CNAME api → ghs.googlehosted.com`. |
| Cloud Build trigger (backend) | Imported (classic GitHub-App). On push to `feature/go-backend-vite-spa` touching **`backend/**`**: `ko build` (from `.ko.yaml`) → push to `devstash-prod` → `gcloud run services update`. Runs as `devstash-backend-deployer`. |
| Cloud Build trigger `devstash-web-firebase-deploy` (frontend) | On push touching **`web/**`**: `npm ci` + `npm run build` (Node 24 via `mirror.gcr.io`) → deploy via Google's official `firebase-cli` image to the `devstash-beta` site. Runs as `devstash-web-deployer` (auth = metadata-server ADC; no tokens/secrets). |
| Deployer SAs (`modules/cloudbuild-deployer-sa`) | `devstash-backend-deployer` (`run.developer` + repo-scoped `artifactregistry.writer` + `serviceAccountUser` on the runtime SA) and `devstash-web-deployer` (`firebasehosting.admin` + `serviceusage.apiKeysViewer`). Both get `logging.logWriter` + the Cloud Build service-agent `serviceAccountTokenCreator`. Least-privilege — replaced the legacy compute-default (Editor) SA. |
| Secret `devstash-prod-config` | One JSON blob of every sensitive var, mounted as `APP_CONFIG`; the backend splits it into env vars at boot. One version = Secret Manager free tier. Read by the compute-default SA (still the Cloud Run **runtime** identity). |
| Firebase Hosting `devstash-beta` (+ `beta.devstash.one`) | SPA host, Spark tier. `web/firebase.json` pins `site: devstash-beta` so deploys land here (not the project default site). |

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

## Deploy

Both tracks deploy on push to `feature/go-backend-vite-spa` (flip both triggers' branch filter to
`^main$` at merge). Each trigger is path-scoped, so a backend-only push doesn't redeploy the web
app and vice versa. To deploy without an app change, run a trigger manually:

```bash
# backend (ko → Cloud Run)
gcloud builds triggers run 9df333f5-0194-4213-bc85-d81fe3e0c64e \
  --branch=feature/go-backend-vite-spa --region=global \
  --project=project-39965ce5-4c4b-495e-8d4
curl -sf https://api.devstash.one/health

# frontend (Vite → Firebase Hosting)
gcloud builds triggers run devstash-web-firebase-deploy \
  --branch=feature/go-backend-vite-spa --region=global \
  --project=project-39965ce5-4c4b-495e-8d4
```

## $0 by design

All within free tiers — keep it that way (no always-on instances, no extra secret versions):
Cloud Run scale-to-zero (2M req/mo) · Secret Manager (3 active versions ≤ 6) · Artifact Registry
(~17 MB ≤ 500 MB) · Firebase Spark · Upstash/Neon free.

## Gotchas

- **`ko` build is unverified-then-verified.** The backend build migrated off `backend/Dockerfile`
  to `ko build` (same distroless/static:nonroot image, no Docker daemon). The Dockerfile is kept
  with a deprecation banner as a fallback — delete it once you're confident in ko. `ko@latest` is
  installed per-build in a `golang:1.26` image; pin it if you want reproducibility.
- **Managed domain-mapping CLI is under `gcloud beta run domain-mappings`** — the GA group is
  Cloud-Run-for-Anthos only and rejects `--region`. Recreating a mapping means a fresh managed cert
  (`CertificatePending` → ~15 min–few hours; HTTPS is down until it issues). Check status with
  `gcloud beta run domain-mappings describe --domain=api.devstash.one --region=us-central1`.
- **Firebase deploy target.** `web/firebase.json` must pin `"site": "devstash-beta"`; without it,
  `firebase deploy` pushes to the project's *default* Hosting site instead of the one the custom
  domain is attached to.
- **Cloud Build auth for Firebase is metadata-server ADC** (not `firebase login:ci` tokens, not
  WIF) — the trigger runs as `devstash-web-deployer` and firebase-tools picks up its ADC. No GitHub
  secrets to manage.
