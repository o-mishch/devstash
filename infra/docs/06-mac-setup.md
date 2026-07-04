# Налаштування Mac — встановлення набору інструментів

> Як встановити інструменти, які використовує цей трек, на macOS. Джерела звірено
> з актуальною офіційною документацією через Context7 (документація HashiCorp щодо
> встановлення Terraform; README kubernetes-sigs/kind), червень 2026.

Усе наведене нижче передбачає, що [Homebrew](https://brew.sh) уже встановлено:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> 🎓 **Як учити (швидко).** Це runbook встановлення. Кожен інструмент тут потрібен
> якомусь кроку `run.sh`: `gcloud/tofu/gh/kubectl/helm/jq/yq` звіряє preflight у
> [`infra/run/gcp/run.sh`](../run/gcp/run.sh); `docker/kind/kubectl` — основа
> [`infra/run/local/run.sh`](../run/local/run.sh).

## Terraform

**Важливо:** `brew install terraform` (Homebrew core) **не працює** —
HashiCorp перенесла Terraform до власного tap. Офіційний спосіб такий:

```bash
brew tap hashicorp/tap                      # додати репозиторій HashiCorp
brew install hashicorp/tap/terraform        # встановити Terraform із tap
terraform -help                             # перевірити
terraform version
```

### Альтернатива: OpenTofu (те, що використовував цей трек)

OpenTofu — це open-source форк-замінник (drop-in fork) Terraform (створений після зміни ліцензії
Terraform). HCL та CLI ідентичні — `tofu` замінює `terraform`. Він є в Homebrew
core, тож tap не потрібен:

```bash
brew install opentofu
tofu version
tofu init -backend=false && tofu validate   # ті самі команди, `tofu` замість `terraform`
```

> Ми перевірили `infra/terraform/` цього репозиторію за допомогою `tofu` — конфігурація
> на 100% сумісна з будь-яким із інструментів. Використовуйте той, який потрібен на
> вашій цільовій роботі; якщо в JD вказано «Terraform», встановлюйте версію з
> HashiCorp tap, наведену вище.

### Керування кількома версіями (необов'язково)

Якщо вам потрібно перемикати версії Terraform для різних проєктів:

```bash
brew install warrensbox/tap/tfswitch        # tfswitch
tfswitch                                     # інтерактивний вибір версії
```

## Kubernetes — набір інструментів (toolchain) для локального кластера (local cluster)

Вам потрібні три речі: **CLI** (`kubectl`), **локальний кластер** (`kind` або
`minikube`) та **Docker** (kind запускає Kubernetes *усередині* контейнерів Docker).

### Docker (передумова / prerequisite)

```bash
brew install --cask docker        # Docker Desktop (GUI)
# — або, легша версія, без Desktop:
brew install colima docker
colima start                      # запускає Docker-сумісну VM (віртуальну машину)
```

### kubectl (CLI для Kubernetes)

```bash
brew install kubernetes-cli       # пакет називається kubernetes-cli; бінарник — `kubectl`
kubectl version --client
```

### kind (Kubernetes IN Docker) — рекомендовано для цього треку

Легкий, швидкий, придатний для скриптів; саме його використовує документ Layer 2.

```bash
brew install kind
kind version

# Створити / використати кластер
kind create cluster --name devstash       # піднімає односайтовий кластер у Docker
kubectl cluster-info --context kind-devstash

# Завантажити локально зібраний образ (реєстр не потрібен) — використовується в Layer 2
docker build -t devstash:local .
kind load docker-image devstash:local --name devstash

# Знести
kind delete cluster --name devstash
```

### minikube (альтернативний локальний кластер)

Важчий за kind, але має вбудований дашборд і систему додатків. Підійде будь-який.

```bash
brew install minikube
minikube start                            # створює локальний кластер
minikube image load devstash:local        # еквівалент `kind load` у minikube
minikube dashboard                        # вебінтерфейс
minikube delete
```

### Kustomize (уже в комплекті)

`kubectl` постачається з вбудованим Kustomize (`kubectl kustomize <dir>` /
`kubectl apply -k <dir>`), і саме його використовує цей репозиторій — окреме
встановлення не потрібне. Існує і самостійний бінарник, якщо вам потрібна найновіша
версія:

```bash
brew install kustomize
```

## Helm (менеджер пакетів для Kubernetes)

Потрібен для встановлення **External Secrets Operator** (крок 7.0 у `run/gcp/run.sh`). Без
нього `run.sh eso` впаде на `need helm`.

```bash
brew install helm
helm version
```

## jq та yq (обробники JSON / YAML)

Обидва перевіряються preflight-функцією `run/gcp/run.sh`. `jq` для JSON-виводу gcloud/gh,
`yq` для маніпуляцій із YAML-маніфестами (інʼєкція PROJECT_ID, domain, imageTag у CI та
у run.sh):

```bash
brew install jq yq
jq --version
yq --version
```

## GitHub CLI (`gh`)

Потрібен для `run.sh secrets` (запис `GCP_PROJECT_ID` / `DEPLOYER_SA` / `WORKLOAD_IDENTITY_PROVIDER`
та `APP_DOMAIN` у GitHub Actions) і `run.sh deploy` (запуск CI-воркфлоу):

```bash
brew install gh
gh --version
gh auth login          # автентифікуйся в GitHub одразу
```

## gke-gcloud-auth-plugin (обов'язково для `kubectl` → GKE)

`kubectl` не може автентифікуватися у GKE-кластері без цього плагіна. Якщо його
немає, `tofu output -raw get_credentials_command` / `gcloud container clusters
get-credentials` успішно записує kubeconfig, але будь-яка команда `kubectl` падає з
помилкою:

```
CRITICAL: ACTION REQUIRED: gke-gcloud-auth-plugin, which is needed for continued
use of kubectl, was not found or is not executable.
```

Встановлення через gcloud components:

```bash
gcloud components install gke-gcloud-auth-plugin
gke-gcloud-auth-plugin --version   # перевірити
```

Після встановлення повторно отримати облікові дані кластера:

```bash
eval "$(tofu output -raw get_credentials_command)"
kubectl get nodes
```

---

## Одним махом: усе для цього треку

```bash
# Terraform (або пропустіть, якщо використовуєте tofu)
brew tap hashicorp/tap && brew install hashicorp/tap/terraform
# ...або OpenTofu:
brew install opentofu

# Локальний стек Kubernetes
brew install --cask docker        # або: brew install colima docker && colima start
brew install kubernetes-cli kind

# GCP-деплой: helm + утиліти CLI + GitHub CLI
brew install helm jq yq gh

# Необов'язково: GCP CLI (потрібен лише для реального `terraform plan/apply` проти GCP)
brew install --cask google-cloud-sdk

# Плагін автентифікації GKE (обов'язковий, якщо використовуєте kubectl проти GKE)
gcloud components install gke-gcloud-auth-plugin
```

## Перевірити весь набір інструментів

```bash
terraform version   # або: tofu version
kubectl version --client
kind version
docker version
helm version
jq --version
yq --version
gh --version
gcloud version      # якщо встановлено
gke-gcloud-auth-plugin --version   # якщо підключаєтесь до GKE
```

> ⚙️ **Автоматизація.** Замість звіряти руками — `preflight()` у
> [`infra/run/gcp/run.sh`](../run/gcp/run.sh) перевіряє наявність кожного CLI і падає
> з посиланням на встановлення, якщо чогось бракує. Будь-яка підкоманда (`up`,
> `bootstrap`, `apply`…) запускає його першою.

## Що встановлювати для співбесіди?

| Інструмент | Встановлення | Навіщо |
|------|---------|-----|
| **Terraform** | `brew tap hashicorp/tap && brew install hashicorp/tap/terraform` | Якщо в JD вказано «Terraform», використовуйте оригінал |
| **OpenTofu** | `brew install opentofu` | Заміна без змін (drop-in replacement); ідентичний HCL (те, що ми використовували тут) |
| **kubectl** | `brew install kubernetes-cli` | Потрібен для будь-якої роботи з K8s |
| **kind** | `brew install kind` | Швидкі локальні кластери; поєднується з Docker |
| **Docker** | `brew install --cask docker` | Потрібен для kind; також Layer 1 |
| **helm** | `brew install helm` | Встановлення External Secrets Operator (ESO) на GKE |
| **jq / yq** | `brew install jq yq` | JSON/YAML-обробка; preflight-перевірка `run/gcp/run.sh` |
| **gh** | `brew install gh` | Запис GitHub Actions secrets; запуск CI-деплою з run.sh |
| **gcloud** | `brew install --cask google-cloud-sdk` | Лише для реального plan/apply у GCP |
| **gke-gcloud-auth-plugin** | `gcloud components install gke-gcloud-auth-plugin` | Обов'язковий для `kubectl` проти GKE-кластерів |
