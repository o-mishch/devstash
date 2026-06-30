# DevOps Re-Platform: GCP + Terraform + Kubernetes

> **Навіщо це існує:** навчальний трек для підготовки до технічної співбесіди з DevOps
> (GCP, Terraform, Kubernetes). Ми беремо реальний застосунок DevStash і будуємо *паралельний*
> шлях деплою на самокерованій інфраструктурі — протилежність його поточному
> serverless-стеку — щоб кожна концепція спиралася на реальний застосунок.

> 🎓 **Як читати трек.** Кожен шар — окремий документ: короткі 📚-концепти для
> співбесіди (з джерелами) + реальний runbook, інкапсульований у `run.sh`
> ([local](../k8s/local-run/run.sh) на kind, [gcp](../gcp-run/run.sh) на GKE). Спершу
> руками, далі одним викликом. Порядок читання — у таблиці «Порядок збірки» нижче.

## Відправна точка (поточний стек)

DevStash сьогодні працює як **serverless / повністю керований**:

| Аспект                      | Поточний (керований)                      |
| --------------------------- | ----------------------------------------- |
| Обчислення                  | Next.js на **Vercel** (serverless/edge)   |
| База даних (database)       | **Neon** (керований Postgres, WS-драйвер) |
| Кеш / rate                  | **Upstash Redis** (REST)                  |
| Зберігання файлів (storage) | **AWS S3**                                |
| Email                       | **Resend** (без змін — лишається SaaS)    |
| Білінг (billing)            | **Stripe** (без змін — лишається SaaS)    |

Цей стек навмисно *не* GCP/Terraform/Kubernetes. Тож ця вправа означає
**свідоме перенесення платформи (re-platforming) на інфраструктуру, яку ми самі провіжинимо й експлуатуємо** —
а саме це й перевіряє роль DevOps.

## Цільовий стек (що ми будуємо)

| Аспект                          | Поточний (керований) | Цільовий (самокерований на GCP)               |
| ------------------------------- | -------------------- | --------------------------------------------- |
| Обчислення                      | Vercel               | **GKE** (Kubernetes) із запущеним контейнером |
| База даних                      | Neon                 | **Cloud SQL** для PostgreSQL                  |
| Кеш / rate                      | Upstash Redis        | **Memorystore** для Redis                     |
| Зберігання файлів               | AWS S3               | **Cloud Storage (GCS)**                       |
| Реєстр образів (image registry) | —                    | **Artifact Registry**                         |
| Мережа (networking)             | (керує Vercel)       | **VPC + subnet + Ingress + Load Balancer**    |
| Ідентичність (identity)         | env-секрети          | **IAM + Workload Identity**                   |
| Провіжинінг (provisioning)      | дашборди             | **Terraform** (усе як код)                    |
| Доставка (delivery)             | git push у Vercel    | **GitHub Actions / Cloud Build → GKE**        |

## Рішення щодо обсягу та вартості (обране)

- **Режим: Local-first, cloud-deployable.** Kubernetes перевіряється через `kind`,
  а окремий GCP flow робить реальні `bootstrap → tofu apply → CI deploy`. Локальна
  валідація не доводить IAM, quota, DNS, certificate або provider API behavior;
  перед реальним запуском виконуй [`08-gcp-bootstrap.md`](08-gcp-bootstrap.md).
- **Фокус (усі чотири):** глибина Kubernetes · глибина Terraform · сервіси GCP · CI/CD.

### Якщо хочеш зробити реальний `tofu apply` (безкоштовно)

| Варіант                | Де взяти                         | Деталь                                                                |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------- |
| **$300 кредитів**      | Новий GCP-акаунт                 | 90 днів; достатньо для `apply` + `destroy` всього стеку               |
| **Google Cloud Shell** | console.cloud.google.com → Shell | `gcloud`, `kubectl`, `terraform` вже встановлені — нічого не потрібно |
| **GKE Autopilot**      | ✅ вже в `modules/gke/`           | Google керує вузлами; compute оплачується за Pod requests; $0.10/год cluster fee покривається місячним credit до $74.40 для одного Autopilot cluster |

> Для навчання: [Google Cloud Skills Boost](https://www.cloudskillsboost.google) надає тимчасові sandbox-середовища GCP без власного акаунта.

### Що покриває Google Cloud Free Program ([cloud.google.com/free](https://cloud.google.com/free))
> Джерело: [cloud.google.com/free/docs/free-cloud-features](https://cloud.google.com/free/docs/free-cloud-features)

**$300 trial (нові акаунти) — 90 днів:**
- Покриває всі сервіси цього стеку: GKE, Cloud SQL, Memorystore, GCS, Artifact Registry
- Достатньо для `tofu apply` + повноцінного тестування + `tofu destroy`
- Обмеження: без GPU, без Gemini API, без Marketplace, без збільшення квот

**Always-Free Tier (постійно, без trial):**

| Сервіс                  | Безкоштовний ліміт              | Для цього стеку                                                            |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| **GKE**                 | $74.40 credit/місяць на billing account | Покриває management fee одного Autopilot cluster; Pod compute не покриває |
| **Cloud Storage (GCS)** | 5 GB-місяць у `us-west1`, `us-central1`, `us-east1` сукупно | ✅ uploads, доки не перевищено storage/operation limits |
| **Artifact Registry**   | Обмежена free quota | Два images + mutable tags/cache швидко її перевищують; налаштуй cleanup policy |
| **Cloud SQL**           | Немає Always Free quota для цього instance | ⚠️ Платний після вичерпання trial credits |
| **Memorystore (Redis)** | Немає Always Free quota | ⚠️ Платний після вичерпання trial credits |

**Ключовий висновок:**
- GKE нараховує management fee, а free-tier credit компенсує до $74.40/місяць
  для Autopilot/zonal clusters. Autopilot Pod CPU/RAM/ephemeral storage оплачуються окремо.
- Cloud SQL і Memorystore — **поза always-free**. Для навчання: $300 trial покриє все, або `tofu destroy` одразу після тестування.
- Щоб мінімізувати витрати: не завищуй Pod requests/HPA replicas; використовуй
  `db-f1-micro` Cloud SQL + мінімальний Memorystore (`BASIC`, 1 GB) лише для dev.

**Стратегія нульової вартості для навчання:**
```bash
# Опція 1: $300 trial — apply → тест → destroy
tofu apply && kubectl apply -k infra/k8s/overlays/gcp
# ... перевірити ...
tofu destroy   # повністю прибрати всі ресурси

# Опція 2: Cloud Shell (без локального tax)
# cloud.google.com → Cloud Shell → git clone → tofu apply
# gcloud, kubectl, terraform вже встановлені, авторизація автоматична

# Опція 3: Skills Boost sandbox (без власного акаунта)
# cloudskillsboost.google → "Kubernetes Engine" quest → тимчасовий GCP-проєкт
```

> **Перед першим `tofu apply`** на власному акаунті потрібен ручний bootstrap GCP
> (проєкт, білінг, ADC, state-бакет, `terraform.tfvars`) — повний по-кроковий чекліст:
> [08-gcp-bootstrap.md](08-gcp-bootstrap.md) (детальні команди).

## Архітектура (цільова)

```
                    ┌─────────────────────────────────────────────┐
   Internet ──────► │  GCP Load Balancer  ◄── Ingress              │
                    │            │                                  │
                    │   ┌────────▼─────────┐   GKE cluster (VPC)    │
                    │   │  Service (CIP)   │                        │
                    │   └────────┬─────────┘                        │
                    │   ┌────────▼─────────┐  Deployment + HPA      │
                    │   │  Next.js Pods    │  (standalone container)│
                    │   └──┬─────┬─────┬───┘                        │
                    └──────┼─────┼─────┼────────────────────────────┘
                           │     │     │  (private IP / VPC peering)
              ┌────────────▼─┐ ┌─▼────────┐ ┌▼──────────┐
              │  Cloud SQL   │ │Memorystore│ │   GCS     │
              │ (Postgres)   │ │  (Redis)  │ │ (bucket)  │
              └──────────────┘ └───────────┘ └───────────┘

   External SaaS (unchanged): Stripe · Resend · OAuth providers
   Images: Artifact Registry  ·  Identity: IAM + Workload Identity
```

## Порядок збірки (кожен шар = один документ + артефакти)

1. **Docker** — контейнеризуємо застосунок (передумова для K8s). → [01-docker.md](01-docker.md)
2. **Kubernetes** — деплоїмо контейнер, валідуємо на локальному `kind`. → [02-kubernetes.md](02-kubernetes.md)
3. **Terraform** — провіжинимо допоміжні сервіси GCP як код. → [03-terraform.md](03-terraform.md)
4. **CI/CD** — пайплайн (pipeline) build → push → deploy. → [04-cicd.md](04-cicd.md)
5. **Навчальний посібник** — огляд архітектури + шпаргалки з питаннями для співбесіди. → [05-study-guide.md](05-study-guide.md)
6. **Ручний bootstrap GCP** — зовнішні передумови (проєкт, білінг, секрети, DNS) перед `tofu apply`. → [08-gcp-bootstrap.md](08-gcp-bootstrap.md)

## Структура репозиторію (що буде створено)

```
infra/
├── docker/            # Dockerfile lives at repo root (build context); notes here
├── k8s/
│   ├── base/          # Deployment, Service, Ingress, HPA, ConfigMap, Secret, kustomization
│   └── overlays/
│       ├── local/     # kind overlay (NodePort, no cloud Ingress)
│       └── gcp/       # GKE overlay (GCE Ingress, real hostnames)
├── terraform/
│   ├── modules/       # network, gke, cloudsql, memorystore, gcs, artifact-registry, iam
│   └── envs/dev/      # root module wiring the modules together
└── docs/              # this learning track (Ukrainian);
                       # CI/CD: .github/workflows/deploy-gke.yml at repo root (GitHub Actions, the only pipeline)

Dockerfile, .dockerignore   # repo root
```

## Безпека / зона ураження (blast radius)

Це додаткове навчальне риштування. Воно **не** змінює живий шлях Vercel/Neon.
Єдині зміни в коді застосунку — це дві безпечні, адитивні зміни:
- `next.config.ts`: додати `output: 'standalone'` (потрібно для невеликого образу контейнера (container image)).
- `src/app/api/health/route.ts`: новий health-ендпоінт (health endpoint) (використовується probe-ами K8s; також корисний загалом).

## Межа Vercel ↔ GCP/Local (isolation contract)

Застосунок підтримує **три середовища** через одну кодову базу без змін у Vercel:

| Середовище | DB | Redis | S3 | Email |
|---|---|---|---|---|
| **Vercel** | Neon (WS-драйвер) | Upstash REST | AWS S3 | Resend |
| **GKE** | Cloud SQL (node-postgres) | Memorystore (ioredis, TLS) | GCS (S3-interop HMAC) | Resend |
| **Local kind** | postgres pod | redis-stack pod | MinIO pod | Mailpit (SMTP) |

**Механізм ізоляції — три шари:**

1. **`optionalDependencies` у `package.json`** — GKE/Local-специфічні пакети (`ioredis`, `nodemailer`, `@prisma/adapter-pg`, `pg`) є optional. Vercel виконує `npm ci` (без `--omit=optional`), але ці пакети не інсталюються, якщо вони відсутні в production mid-tier.  
   _Насправді Vercel теж їх ставить — але `serverExternalPackages` не бандлить їх у чанки._

2. **`serverExternalPackages` у `next.config.ts`** — перераховані пакети не потрапляють у webpack-бандл і резолвяться через рідний `require()` у runtime. На Vercel вони просто не викликаються (div. нижче).

3. **Env-ворота з lazy `require()`** — код `src/lib/infra/` перевіряє env-змінні перед тим, як доторкнутись до GKE-пакетів:
   - `DB_LOCAL=1` → `require('@prisma/adapter-pg')` у [`src/lib/infra/db-local.ts`](../../src/lib/infra/db-local.ts)
   - `REDIS_URL` → `require('ioredis')` у [`src/lib/infra/redis.ts`](../../src/lib/infra/redis.ts)
   - `SMTP_HOST` → `import('nodemailer')` (Mailpit SMTP) у [`src/lib/infra/email-local.ts`](../../src/lib/infra/email-local.ts)
   - `AWS_ENDPOINT_URL_S3` → `forcePathStyle` для MinIO/GCS у [`src/lib/storage/s3-local.ts`](../../src/lib/storage/s3-local.ts)

Жодного окремого `S3_LOCAL`/`EMAIL_LOCAL` прапорця — кожна гілка вмикається наявністю
самої connection-конфігурації, яку вона й так потребує. На Vercel жодна з цих змінних не
виставлена → GKE-гілки коду не досягаються → пакети не завантажуються.

**Що не можна зламати:** Vercel-деплой не залежить від `infra/` взагалі. DNS apex `devstash.one` + `www` вказують на Vercel і не змінюються. GKE живе на піддомені `gke.devstash.one`.

## Прогрес

- [x] Шар 1 — Docker (зібрано; чистий lint)
- [x] Шар 2 — Kubernetes (обидва overlay рендеряться: local 8 / gcp 12 ресурсів)
- [x] Шар 3 — Terraform (`tofu validate` + `fmt` проходять; виявлено реальний баг із sensitive-`for_each`)
- [x] Шар 4 — CI/CD (GitHub Actions + Cloud Build; YAML провалідовано)
- [x] Навчальний посібник + шпаргалки для співбесіди
- [x] Посібник з налаштування для Mac (перевірено через Context7)
- [x] GCP Free Tier / cost analysis (цей файл)
- [x] Deploy readiness — усі код/інфра-блокери закриті; зовнішні передумови в 08-gcp-bootstrap.md

**Статус валідації:** усе провалідовано локально / офлайн (нульові витрати на хмару (cloud)).
Не застосовано до живого GCP — див. нотатки "run it for real" у документі кожного шару.
