# Рівень 3 — Terraform (інфраструктура GCP як код (infrastructure as code))

> Усе, на чому працює застосунок — кластер, база даних, кеш, бакет, реєстр,
> мережа та ідентичність — спроваджене (provisioned) як код. Один `terraform apply` будує це
> все; `terraform destroy` усе зносить. Жодного клацання в консолі.

> 🎓 **Навчальний трек.** Концепти для співбесіди — у блоках 📚 «Ключові виписки з
> офіційних ресурсів» і «Тези для співбесіди» нижче. Блок ⚙️ **Автоматизація**
> вказує, яка команда `run.sh` інкапсулює крок: спершу прожени офлайн-валідацію
> руками, далі застосовуй проти GCP одним викликом. Передумови (проєкт, білінг,
> ADC, state-бакет, API) і покроковий `tofu apply` детально розписані в
> [08-gcp-bootstrap.md](08-gcp-bootstrap.md); тут — структура самого коду.

## Що ми будуємо (`infra/terraform/`)

```
envs/dev/                   # root module — wires the building blocks for "dev"
├── versions.tf             # required Terraform + provider versions
├── providers.tf            # google provider config (project, region)
├── backend.tf              # remote state in GCS (durable, locked, shared)
├── variables.tf            # inputs (project_id, region, sizes…)
├── locals.tf               # name prefix + common labels
├── main.tf                 # enables APIs, calls every module, wires outputs→inputs
├── outputs.tf              # cluster name, registry URL, SA emails, kubeconfig cmd
└── terraform.tfvars.example
modules/
├── network/                # VPC, subnet (+secondary ranges), PSA, Cloud NAT
├── gke/                    # regional cluster + autoscaling node pool + WI
├── cloudsql/               # private-IP Postgres 16 (replaces Neon)
├── memorystore/            # private-IP Redis 7 (replaces Upstash)
├── gcs/                    # uploads bucket (replaces S3)
├── artifact-registry/      # Docker image repo
└── iam/                    # Workload Identity, Secret Manager, CI deployer SA
```

→ файли: [`infra/terraform/`](../terraform/)

## Ключові виписки з офіційних ресурсів

### Terraform — основні команди та workflow
> Джерело: [developer.hashicorp.com/terraform/tutorials/gcp-get-started](https://developer.hashicorp.com/terraform/tutorials/gcp-get-started/google-cloud-platform-build)

| Команда | Призначення |
|---------|-------------|
| `terraform init` | завантажити провайдери, ініціалізувати backend |
| `terraform fmt` | автоформатування конфігурації |
| `terraform validate` | перевірка синтаксису та типів (без API-запитів) |
| `terraform plan` | показати diff: що буде створено / змінено / видалено |
| `terraform apply` | застосувати зміни (запитає підтвердження) |
| `terraform show` | показати поточний стан усіх ресурсів |
| `terraform destroy` | знести всю інфраструктуру зі state |

```bash
# Автентифікація до GCP через Application Default Credentials:
gcloud auth application-default login

# Офлайн-валідація (без GCS backend, без API):
cd infra/terraform/envs/dev
tofu init -backend=false
tofu validate && tofu fmt -recursive -check

# Три ключові блоки будь-якої конфігурації:
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_compute_network" "vpc" {
  name = "devstash-vpc"
}
```

> *«Infrastructure as Code — describe infrastructure in Terraform configuration files; Terraform maintains a state file tracking all managed resources.»*

---

### Terraform — структура модуля
> Джерело: [developer.hashicorp.com/terraform/language/modules/develop/structure](https://developer.hashicorp.com/terraform/language/modules/develop/structure)

> *«All variables and outputs should have one or two sentence descriptions that explain their purpose.»*

**Мінімальна структура модуля:**
```
modules/gke/
├── main.tf        # ресурси
├── variables.tf   # input variables (що приймає модуль)
├── outputs.tf     # output values (що повертає модуль)
└── versions.tf    # required_providers + версії
```

**Root module (env-специфічний):**
```
envs/dev/
├── main.tf        # викликає modules/*, пов'язує outputs→inputs
├── variables.tf   # inputs середовища (project_id, region, tier...)
├── outputs.tf     # виводить кінцеві значення (cluster name, URLs)
├── backend.tf     # remote state (GCS)
└── terraform.tfvars.example
```

**Виклик модуля та передача outputs:**
```hcl
module "network" {
  source      = "../../modules/network"
  name_prefix = local.name_prefix
  region      = var.region
}

module "gke" {
  source           = "../../modules/gke"
  network_self_link = module.network.network_self_link   # output → input
  subnet_self_link  = module.network.subnet_self_link
  depends_on        = [module.network]   # явна залежність коли неявна неможлива
}
```

Terraform будує **граф залежностей** автоматично з посилань між ресурсами.
`depends_on` тільки для «прихованих» залежностей (наприклад, VPC peering має існувати до Cloud SQL).

---

### Terraform — remote state та locking
> Джерело: [developer.hashicorp.com/terraform/language/state/remote](https://developer.hashicorp.com/terraform/language/state/remote)

> *«When working with Terraform in a team, use of a local file makes Terraform usage complicated because each user must make sure they always have the latest state data before running Terraform and make sure that nobody else runs Terraform at the same time.»*

```hcl
# backend.tf
terraform {
  backend "gcs" {
    bucket = "devstash-tfstate"
    prefix = "terraform/state/dev"
  }
}
```

**Що дає GCS backend:**
- **Спільне джерело правди** — всі члени команди бачать один state
- **Версіонування** — можна відкотити state при помилковому apply
- **State locking** — блокує паралельні `apply`, запобігає конфліктам

> State може містити чутливі дані (паролі, connection strings) → **ніколи не в git**. Зберігати тільки в зашифрованому GCS-бакеті з увімкненим versioning.

---

### Terraform — for_each vs count
> Джерело: [developer.hashicorp.com/terraform/language/meta-arguments/for_each](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)

```hcl
# ✅ for_each — стабільний при додаванні/видаленні (ключований за іменем)
resource "google_project_service" "apis" {
  for_each           = toset(["container.googleapis.com", "sqladmin.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

# ❌ count — переіндексовує при зміні → непотрібний destroy+create
resource "google_project_service" "apis" {
  count   = length(var.services)
  service = var.services[count.index]   # видалення елементу посередині = churn
}
```

**Підводний камінь `for_each`:** не приймає `sensitive` map — ключі стають адресами ресурсів і витечуть у plan output. Рішення:
```hcl
for_each = toset(keys(var.app_secrets))   # ітерувати ключі, шукати значення за ключем
value    = var.app_secrets[each.key]
```

---

### Terraform — Workload Identity (IAM)
> Джерело: [cloud.google.com/iam/docs/workload-identity-federation](https://cloud.google.com/iam/docs/workload-identity-federation)

```hcl
# Service account для застосунку
resource "google_service_account" "app" {
  account_id = "${local.name_prefix}-app"
}

# Прив'язка: K8s SA може імперсонувати Google SA (без JSON-ключів)
resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.workloadIdentityUser"
  member = "serviceAccount:${var.project_id}.svc.id.goog[devstash/devstash]"
  #                                                       ^ namespace / K8s SA name
}

# Дозвіл читати секрети з Secret Manager
resource "google_secret_manager_secret_iam_member" "app_reader" {
  for_each  = toset(keys(var.app_secrets))
  secret_id = google_secret_manager_secret.app[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}
```

## Базові концепції Terraform (і де вони тут трапляються)

- **Provider'и** (`providers.tf`) — плагіни, що спілкуються з API. Ми використовуємо `google`
  та `random`. Зафіксовані у `versions.tf`, щоб збірки були відтворюваними.
- **Resource'и** — по одному хмарному об'єкту кожен (`google_container_cluster`,
  `google_sql_database_instance`, …).
- **Module'і** — повторно використовувані, параметризовані групи ресурсів. У нас по одному на
  кожну сферу відповідальності; root module *компонує* їх. Це найважливіша
  структурна ідея: малі, сфокусовані, повторно використовувані module'і + тонкий root, що зв'язує їх.
- **State** (`backend.tf`) — запис Terraform про відповідність «конфігурація ↔ реальні ресурси». Зберігається
  в **GCS-бакеті**, а не на ноутбуці: довговічний (remote state), версіонований і **залоченний** (state locking), щоб два
  apply не перегонилися. State може містити секрети → ніколи не в git.
- **Inputs/outputs** — module'і виставляють `variables` (inputs) та `outputs`. Root
  передає output одного module'я на input іншого (наприклад, мережевий
  `subnet_self_link` → module GKE), і саме так Terraform виводить
  **граф залежностей (dependency graph)** та порядок.
- **`for_each` / `toset`** — створюють N ресурсів з колекції (ми використовуємо це для
  секретів Secret Manager та IAM-ролей деплоєра).

## Ланцюг залежностей (що будується і в якому порядку)

Terraform визначає порядок з посилань; важливий реальний порядок:

```
enable APIs
   └─ network (VPC, subnet, Private Services Access peering, NAT)
        ├─ gke         (cluster + node pool, VPC-native via secondary ranges)
        ├─ cloudsql    (private IP — REQUIRES the PSA peering first)
        └─ memorystore (private IP — REQUIRES the PSA peering first)
   ├─ gcs              (bucket)
   ├─ artifact-registry
   └─ iam  (Workload Identity binding + Secret Manager + bucket grants + CI SA)
            └─ pulls connection strings from cloudsql/memorystore/gcs into secrets
```

## Моменти, які варто зрозуміти (золото для співбесіди)

### Private-by-default мережа (`network/`)

**Кастомна VPC** (а не дозвільна `default`), де subnet несе два
**secondary range'и (secondary ranges)** для GKE pod'ів + service'ів (VPC-native / alias-IP мережа).
**Private Services Access** (peering-діапазон VPC) — це те, що дозволяє **Cloud SQL** та
**Memorystore** отримати **private IP в нашій VPC** — база даних ніколи не виставлена в
публічний інтернет. Private-ноди виходять в інтернет назовні (egress) через **Cloud
NAT**. Ця позиція «нічого публічного, якщо без цього не обійтися» — головна теза.

### GKE: cluster + окремий node pool (`gke/`)

Регіональний cluster (control plane реплікований по зонах = HA, high availability). Ми
`remove_default_node_pool` і приєднуємо **власний autoscaling node pool**, тож конфігурація нод
і control plane керуються незалежно. Два autoscaler'и накладаються:
**HPA** (Рівень 2) додає *pod'и*; **cluster autoscaler** тут додає *ноди*,
коли pod'и неможливо запланувати. **Workload Identity** увімкнено, тож pod'и отримують GCP-ідентичність
без ключів. Shielded-ноди + REGULAR release channel для авто-апгрейдів.
Приватні вузли + control plane **без публічного IP** (`enable_private_endpoint = true`):
зовнішній доступ (kubectl/CI) — лише через **DNS-based endpoint** (`control_plane_endpoints_config`),
авторизований через IAM, а не IP-allowlist (ротаційні IP runner'ів GitHub не вписати в allowlist).

### Ідентичність без статичних ключів (`iam/`)

Ланцюг, що замінює «API-ключі в env»:
1. Google SA `devstash-app` тримає ролі за принципом найменших привілеїв (least privilege) (читати свої секрети, користуватися
   бакетом).
2. **Workload Identity binding** дозволяє Kubernetes SA
   (`devstash/devstash`, з GCP-overlay Рівня 2) *імперсонувати* (impersonate) його.
3. Секрети застосунку живуть у **Secret Manager**; SA отримує `secretAccessor` на кожен.

Тож pod автентифікується в GCP **як ідентичність**, а не з експортованим JSON-ключем —
сучасний, аудитований (auditable), безротаційний патерн. Окремий SA `devstash-deployer`
отримує рівно дві ролі, потрібні CI (push образів, деплой у GKE).

> Зверніть увагу на баг, який Terraform за нас зловив: `for_each` не може ітерувати **sensitive**
> map (ключі стають адресами ресурсів і витекли б). Виправлення = ітерувати
> `toset(keys(...))` і шукати значення за ключем. Це справжній, поширений
> підводний камінь — добре вміти його пояснити.

## Нотатки про міграцію застосунку (керований SaaS → GCP)

Re-platforming — це не лише інфраструктура; частина коду застосунку теж змінюється. Будьте готові їх назвати:

| Звідки | Куди | Вплив на код застосунку |
|------|----|-----------------|
| Neon (`@neondatabase/serverless` WS-драйвер + `@prisma/adapter-neon`) | managed Cloud SQL for PostgreSQL | Без зміни коду: overlay вмикає `DB_LOCAL=1` → node-postgres адаптер (`createLocalDbAdapter()`); `DATABASE_URL` вказує на приватний IP Cloud SQL. Той самий SQL, ті самі міграції. |
| Upstash Redis (REST API) | Memorystore | Без зміни коду: app ходить нативно по TCP через `ioredis` прямо в Memorystore, увімкнено `REDIS_URL` (`src/lib/infra/redis-tcp.ts`). На Vercel `REDIS_URL` не задано → лишається `@upstash/redis` REST. |
| AWS S3 | GCS | Або лишити S3 SDK проти **S3-сумісного** ендпоінта GCS з HMAC-ключами, або перейти на GCS SDK. |
| секрети в env-змінних | Secret Manager + Workload Identity | Читати секрети за ідентичністю (CSI driver / External Secrets), а не з вшитого env. |

(Stripe, Resend та OAuth лишаються SaaS — без змін.)

## Локальна валідація (зроблено — без хмарних витрат)

Terraform/OpenTofu валідує всю конфігурацію **офлайн**, не торкаючись GCP:

```bash
cd infra/terraform/envs/dev
tofu init -backend=false     # download providers, skip the GCS backend
tofu validate                # ✅ "Success! The configuration is valid."
tofu fmt -recursive -check   # ✅ canonical formatting
```

> Ми використали **OpenTofu** (`tofu`) — open-source, drop-in форк Terraform;
> HCL ідентичний. Щоб зробити dry-run проти реального GCP без створення чогось:
> `gcloud auth application-default login`, потім `tofu plan` (лише читання; `apply` —
> це те, що коштувало б грошей — ми навмисно зупиняємось тут).

Що валідація вже зловила: фіксацію версій provider'ів, помилку з sensitive-`for_each`
та дрейф форматування — рівно той цикл зворотного зв'язку, на який ви спираєтесь у роботі.

> ⚙️ **Автоматизація.** Офлайн-валідація вище — ручна. Реальний цикл проти GCP
> (init з GCS-backend → plan → apply, плюс отримання kubeconfig) інкапсульовано в
> [`infra/gcp-run/run.sh`](../gcp-run/run.sh):
> ```bash
> bash infra/gcp-run/run.sh bootstrap   # передумови ДО init: проєкт/білінг/ADC/state-бакет/API
> bash infra/gcp-run/run.sh apply       # tofu init -backend-config=… → plan → apply → get-credentials
> bash infra/gcp-run/run.sh down        # tofu destroy (deletion_protection треба зняти першим)
> ```
> `apply` завжди планує у файл і застосовує **саме цей plan** — нуль дрейфу між
> рев'ю diff і реальною мутацією GCP. Покрокові передумови та повний порядок
> bootstrap→deploy — у [08-gcp-bootstrap.md](08-gcp-bootstrap.md) §1–6, §9.

## Тези для співбесіди

- **«Чому remote state? Чому locking?»** Довговічність + спільне джерело правди (single source of truth) +
  запобігання тому, щоб одночасні apply пошкодили state. GCS робить версіонування + локи.
- **«Звідки Terraform знає порядок?»** Граф ресурсів, побудований з
  посилань між ресурсами/module'ями; `depends_on` для прихованого порядку (PSA).
- **«Module'і — навіщо?»** Повторне використання (reuse), інкапсуляція (encapsulation), тестованість; тонкий root їх компонує.
  Root'и для кожного середовища (`envs/dev`, `envs/prod`) повторно використовують ті самі module'і з різними змінними.
- **«Як pod'и безпечно отримують хмарні дозволи?»** Workload Identity — K8s SA
  імперсонує Google SA; жодних статичних ключів, IAM-аудит, без тягаря ротації (key rotation).
- **«Як ви тримаєте БД приватною?»** Private IP через Private Services Access (VPC-
  peering); `ipv4_enabled = false`; SSL примусово.
- **«`count` чи `for_each`?»** `for_each` по map/set стабільний при
  додаванні/видаленні (ключований за іменем); `count` переіндексовує і може спричинити непотрібну метушню.
- **«Як запобігти випадковому видаленню?»** `deletion_protection`,
  lifecycle `prevent_destroy`, рев'ю plan у CI перед apply.

## Чекліст

- [x] Remote state (GCS) + фіксація версій provider'ів
- [x] network: VPC + subnet + secondary range'и + PSA + NAT
- [x] gke: регіональний cluster + autoscaling node pool + Workload Identity
- [x] cloudsql: private-IP Postgres 16
- [x] memorystore: private-IP Redis 7
- [x] gcs + artifact-registry
- [x] iam: Workload Identity + Secret Manager + CI deployer SA
- [x] `tofu validate` проходить + `tofu fmt` чистий
- [ ] (опційно) `tofu plan` проти реального GCP-проєкту
