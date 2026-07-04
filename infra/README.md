# `infra/` — GCP + Terraform + Kubernetes для DevStash

Infrastructure-as-code та маніфести Kubernetes, що переносять DevStash з його
serverless/SaaS-стека на самостійно керований GCP. **Це навчальна збірка**
(підготовка до співбесіди з DevOps), але вона **повністю розгортається**: одна
команда `bash infra/run/gcp/run.sh up` піднімає весь стек на GKE Autopilot (а
`infra/run/local/run.sh` — локальний аналог на kind). Повні покрокові розбори,
шпаргалки для співбесіди та автоматизація деплою — у [`docs/`](docs/README.md)
(деплой: [`08-gcp-bootstrap.md`](docs/08-gcp-bootstrap.md) §9).

## Структура

```
infra/
├── run/                   # оркестратори (одна команда на кожен таргет)
│   ├── gcp/               #   run.sh (GKE) + tfstate-lifecycle.json
│   └── local/             #   run.sh (kind) + valkey-openssl.cnf + stripe-fake-webhook.ts
├── ci/                    # CI shell (build/sign/rollout/…) + .trivyignore.yaml
├── lib/common.sh          # спільний log/ok/warn/die + need() для обох run.sh і ci/
├── versions.env           # пін версій Helm-чартів (ESO, Reloader)
├── k8s/
│   ├── base/              # Deployment, Service, Ingress, HPA, ConfigMap, Secret(template), PDB
│   ├── local/             # kustomize-база бекенд-сервісів: postgres+redis+minio+mailpit+дашборди (kind)
│   │                      #   + kind-config.yaml; застосовує infra/run/local/run.sh
│   └── overlays/
│       ├── local/         # App overlay (kind): NodePort, 1 replica, local secret, MinIO-shim
│       └── gcp/           # GKE: GCE ingress, managed TLS, Workload Identity, NEG, BackendConfig
├── terraform/
│   ├── modules/           # network · gke · cloudsql · memorystore · gcs · artifact-registry · iam · kind
│   └── envs/              # dev/ (GKE) та local/ (kind) — root-модулі, що збирають modules/
└── docs/                  # навчальний трек (українською);
                           # CI/CD: ../.github/workflows/deploy-gke.yml (GitHub Actions — єдиний pipeline)

Dockerfile, .dockerignore  # repo root
```

## Швидка перевірка (без витрат на хмару)

```bash
# Kubernetes — render both app overlays + the local backing-services base
kubectl kustomize infra/k8s/overlays/local    # 10 resources
kubectl kustomize infra/k8s/overlays/gcp      # 15 resources
kubectl kustomize infra/k8s/local             # 21 resources (backing services + init ConfigMaps)

# Terraform — offline validation (OpenTofu shown; `terraform` is identical)
cd infra/terraform/envs/dev                    # or envs/local for the kind cluster
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
bash infra/run/local/run.sh up

# 2. Real GCP (needs a project + `gcloud auth application-default login`):
#    bootstrap → tofu apply → External Secrets Operator → GitHub secrets → DNS-підказка
bash infra/run/gcp/run.sh up
bash infra/run/gcp/run.sh deploy     # після DNS/cert: build + migrate + rollout через CI
```

Розбивка кроків і ручні дії (DNS, Stripe webhook, OAuth redirect) — у
[`docs/08-gcp-bootstrap.md`](docs/08-gcp-bootstrap.md) §7–9.

## Що читати далі

Почніть з [`docs/README.md`](docs/README.md) — майстер-план, покрокові розбори
кожного шару та шпаргалки для співбесіди.
