# `infra/` — GCP + Terraform + Kubernetes для DevStash

Infrastructure-as-code та маніфести Kubernetes, що переносять DevStash з його
serverless/SaaS-стека на самостійно керований GCP. **Це навчальна збірка**
(підготовка до співбесіди з DevOps), але вона **повністю розгортається**: одна
команда `bash infra/gcp-run/run.sh up` піднімає весь стек на GKE Autopilot (а
`infra/k8s/local-run/run.sh` — локальний аналог на kind). Повні покрокові розбори,
шпаргалки для співбесіди та автоматизація деплою — у [`docs/`](docs/README.md)
(деплой: [`08-gcp-bootstrap.md`](docs/08-gcp-bootstrap.md) §9).

## Структура

```
infra/
├── k8s/
│   ├── base/              # Deployment, Service, Ingress, HPA, ConfigMap, Secret(template), PDB
│   ├── local-run/         # FULL local dev stack: postgres + redis + minio + mailpit + app (kind)
│   │                      #   → bash infra/k8s/local-run/run.sh up  (one-shot, batteries-included)
│   └── overlays/
│       ├── local/         # App-only overlay (bring your own DB/Redis): nginx, 1 replica, local secret
│       │                  #   Use when you already have external postgres/redis running
│       └── gcp/           # GKE: GCE ingress, managed TLS, Workload Identity, NEG, BackendConfig
├── terraform/
│   ├── modules/           # network · gke · cloudsql · memorystore · gcs · artifact-registry · iam
│   └── envs/dev/          # root module wiring the modules for the dev environment
└── docs/                  # навчальний трек (українською);
                           # CI/CD: ../.github/workflows/deploy-gke.yml (GitHub Actions — єдиний pipeline)

Dockerfile, .dockerignore  # repo root
```

## Швидка перевірка (без витрат на хмару)

```bash
# Kubernetes — render both overlays
kubectl kustomize infra/k8s/overlays/local    # 8 resources
kubectl kustomize infra/k8s/overlays/gcp      # 12 resources

# Terraform — offline validation (OpenTofu shown; `terraform` is identical)
cd infra/terraform/envs/dev
tofu init -backend=false && tofu validate      # Success! The configuration is valid.
tofu fmt -recursive -check

# CI YAML
npx --no-install js-yaml .github/workflows/deploy-gke.yml
```

Встановлення інструментів на macOS: [`docs/06-mac-setup.md`](docs/06-mac-setup.md).

## Запустити по-справжньому (необов’язково, коштує грошей)

Обидва шляхи автоматизовані одним скриптом — нічого з кроків нижче не треба робити руками:

```bash
# 1. Local Kubernetes (kind): Postgres + Redis + MinIO + Mailpit + app, з міграціями
bash infra/k8s/local-run/run.sh up

# 2. Real GCP (needs a project + `gcloud auth application-default login`):
#    bootstrap → tofu apply → External Secrets Operator → GitHub secrets → DNS-підказка
bash infra/gcp-run/run.sh up
bash infra/gcp-run/run.sh deploy     # після DNS/cert: build + migrate + rollout через CI
```

Розбивка кроків і ручні дії (DNS, Stripe webhook, OAuth redirect) — у
[`docs/08-gcp-bootstrap.md`](docs/08-gcp-bootstrap.md) §7–9.

## Що читати далі

Почніть з [`docs/README.md`](docs/README.md) — майстер-план, покрокові розбори
кожного шару та шпаргалки для співбесіди.
