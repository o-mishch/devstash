# Шар 8 — Ручний bootstrap GCP (cloud.google.com/free) перед Terraform

> **Навіщо цей документ:** Terraform і CI закривають усе, що можна закрити кодом.
> Але кілька речей **за визначенням не комітяться**
> в репозиторій — вони залежать від реального акаунта GCP. Цей файл — точний, по-кроковий
> чекліст того, що треба **руками** підготувати на [cloud.google.com/free](https://cloud.google.com/free),
> **перш ніж** запускати `tofu init`.
>
> Після цих кроків деплой стає майже push-button: `tofu apply` → залити 3 секрети → `git push`.

> 🎓 **Як читати цей документ (навчальний трек для співбесіди DevOps).** Кожен крок
> дає **точну команду** + пояснення, *що саме* вона робить. Три повторювані блоки:
> - 📚 **Для співбесіди** — концепт, який стоїть за кроком (ADC, remote state,
>   WIF, ієрархія ресурсів…) і який питають на технічних інтерв'ю, з посиланнями
>   на першоджерела.
> - ⚙️ **Автоматизація** — яка команда [`run.sh`](../run/gcp/run.sh) інкапсулює цей
>   крок, щоб після того, як зрозумів механіку руками, відтворити її одним викликом.
> - 🔒 **Тільки вручну** — крок виконується в зовнішньому дашборді або потребує
>   значень, відомих лише тобі; `run.sh` не може його автоматизувати.
>
> Тобто: спершу прожени кроки вручну (щоб розуміти механіку), далі покладайся на
> `run.sh`. Повний перелік підкоманд скрипта — у §9.

---

> Детальний аналіз вартості та стратегії мінімізації витрат — у
> [`00-master-plan.md`](./00-master-plan.md) (розділ «Рішення щодо обсягу та вартості»).

## 0. Передумова: який саме «free» ти використовуєш

| Варіант                       | Вартість      | Чого вистачає                                                                                                                 | Обмеження                                                                                                     |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **$300 trial** (новий акаунт) | $0 на 90 днів | Увесь стек: Autopilot Pods + Cloud SQL + Memorystore + GCS + Artifact Registry. `apply → тест → destroy`.                     | Без GPU/Gemini/Marketplace; не підвищити квоти                                                                |
| **Always-Free** (постійно)    | частково $0   | $74.40 GKE credit/місяць покриває management fee одного Autopilot cluster; GCS 5 GB сукупно в `us-west1/us-central1/us-east1` | Autopilot Pod compute, Cloud SQL і Memorystore — платні; Artifact Registry/cache теж може вийти за free quota |
| **Cloud Shell**               | $0            | `gcloud`/`kubectl`/`tofu` вже встановлені, авторизація автоматична                                                            | Ефемерний диск; довгі apply краще з локалі                                                                    |

**Висновок для цього репо:** стек тепер повністю керований — **Cloud SQL** (БД) +
**Memorystore** (Redis, нативний node-redis) + GCS + Artifact Registry. Cloud SQL і
Memorystore **поза** always-free, тож тримайся **$300 trial** (90 днів покривають усе)
і роби `tofu destroy` одразу після перевірки. Always-free сам по собі їх не покриває.

> Усі дії нижче робляться **один раз** і **поза Terraform** (chicken-and-egg: state-бакет
> і ADC мають існувати ще до `tofu init`).

---

## 1. Акаунт, проєкт, білінг

> ⚠️ Для нового акаунта GCP (ще без білінгу): спочатку активуй $300-trial через
> [cloud.google.com/free](https://cloud.google.com/free) → **Get started for free** →
> вкажи країну, прийми умови, додай карту (верифікація; не списує без явного апгрейду).
> Це створить білінг-акаунт. Повертайся сюди після реєстрації.

```bash
# 1.1 Залогінитись у gcloud (відкриє браузер)
gcloud auth login

# 1.2 Створити проєкт. ID має бути глобально унікальний — додай суфікс.
gcloud projects create project-39965ce5-4c4b-495e-8d4 --name="DevStash"

# 1.3 Зробити його активним за замовчуванням
gcloud config set project project-39965ce5-4c4b-495e-8d4

# 1.4 Знайти свій billing account і прив'язати (без білінгу більшість API не вмикаються,
#     навіть на $300 trial — кредит застосовується до прив'язаного білінгу)
gcloud billing accounts list
gcloud billing projects link project-39965ce5-4c4b-495e-8d4 --billing-account=015202-D54745-ABDDC9
```

> 📚 **Для співбесіди — ієрархія ресурсів GCP.** Усе в GCP живе в дереві
> **Organization → Folders (опційно) → Projects → Resources**. IAM-ролі й
> organization policies, призначені вище, **успадковуються вниз** — це головний
> механізм керування доступом у масштабі. **Project** — нижній рівень, що тримає
> реальні ресурси (VM, бакети, БД); `project_id` **глобально унікальний і
> незмінний** після створення. **Білінг-акаунт — поза цим деревом**: він
> *прив'язується* до проєктів і оплачує їх; один білінг може покривати багато
> проєктів. Тому два окремі кроки: `projects create` (вузол дерева) і
> `billing projects link` (платіжний зв'язок). Без прив'язаного білінгу більшість
> API не вмикаються — навіть $300-кредит застосовується саме до прив'язаного
> білінг-акаунта. Джерела: [Resource hierarchy](https://docs.cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy),
> [Cloud Billing onboarding](https://cloud.google.com/billing/docs/onboarding-checklist).

> ⚙️ **Автоматизація:** кроки 1.1–1.4 — блоки «gcloud auth login», «project create + set»,
> «billing link» у `bootstrap()`. Кожен ідемпотентний: `auth list` / `projects describe` /
> `billing projects describe` перевіряє перед діє.
> ```bash
> bash infra/run/gcp/run.sh bootstrap   # містить розділи 1–4
> # Білінг-акаунт явно: BILLING_ACCOUNT=015202-D54745-ABDDC9 bash infra/run/gcp/run.sh bootstrap
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `bootstrap()`, блоки «gcloud auth login» / «project create + set» / «billing link».

---

## 2. Application Default Credentials (ADC)

Terraform-провайдер google автентифікується через ADC. Без них `tofu plan/apply` впаде.

```bash
gcloud auth application-default login
# (Cloud Shell: пропусти — ADC уже налаштовані)
```

> 📚 **Для співбесіди — `auth login` vs `application-default login`.** Це **два
> різні гаманці креденшелів**, і їх постійно плутають:
> - **`gcloud auth login`** автентифікує **сам CLI** — креди для команд `gcloud`/`gsutil`.
> - **`gcloud auth application-default login`** налаштовує **ADC** — окремі креди,
>   які читають *бібліотеки/SDK і Terraform* (а не CLI). Лежать у
>   [`~/.config/gcloud/application_default_credentials.json`](file:///Users/amishchenko/.config/gcloud/application_default_credentials.json).
>
> Сенс ADC — **єдиний стандартний спосіб знайти креди незалежно від середовища**:
> той самий код працює локально (твої ADC), у Cloud Run (приєднаний SA), у GKE
> (Workload Identity), на VM (instance SA) — нічого не переписуєш. Terraform
> google-провайдер шукає саме ADC, тому одного `auth login` йому **недостатньо**.
> Джерела: [gcloud ADC docs](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/login),
> [best-practice gcloud auth + ADC](https://dev.to/jajera/best-practice-set-up-gcloud-auth-and-application-default-credentials-adc-3dhk).

> ⚙️ **Автоматизація:** перевіряє `gcloud auth application-default print-access-token` і
> запускає логін лише якщо токена немає (ідемпотентно; у Cloud Shell пропускається).
> ```bash
> bash infra/run/gcp/run.sh bootstrap   # містить крок ADC
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `bootstrap()`, блок «Application Default Credentials».

---

## 3. Bucket для Terraform state (chicken-and-egg)

Backend оголошено в [`envs/dev/backend.tf`](../terraform/envs/dev/backend.tf) як
`gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev` (prefix `gke/dev`). Бакет **мусить існувати до**
`tofu init`; project ID makes the globally scoped bucket name collision-safe.

```bash
# Приклад: project-39965ce5-4c4b-495e-8d4-tfstate-dev
gcloud storage buckets create gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev \
  --location=US --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev --versioning
```

> Якщо береш іншу назву бакета — синхронізуй її в `backend.tf` (`bucket = "..."`).
> Versioning обов'язковий: дає відкат після зіпсованого apply.

> 📚 **Для співбесіди — навіщо remote state у GCS.** Terraform **state** — це
> мапа «конфіг ↔ реальні ресурси». Локальний `terraform.tfstate` не годиться для
> команди й CI: його не видно іншим і легко перезаписати. Винесення в GCS дає три
> речі:
> - **Спільний доступ** — CI й люди читають той самий state.
> - **Locking** — GCS-backend блокує state **за замовчуванням** (lock-файл
>   `<prefix>/<workspace>.tflock` у тому ж бакеті), тож два паралельних `apply` не
>   зіпсують стан. На відміну від AWS S3, **окрема таблиця-локер (DynamoDB) не
>   потрібна**.
> - **Versioning** — кожна версія state зберігається; після зіпсованого `apply`
>   або випадкового видалення можна відкотитись. Тому крок 3 вмикає
>   `--versioning`.
>
> `--uniform-bucket-level-access` + `--public-access-prevention` критичні, бо
> **state містить секрети у відкритому вигляді** (паролі БД тощо) — доступ лише
> через IAM, ніякого публічного читання. **Chicken-and-egg:** бакет мусить
> існувати **до** `tofu init`, тому його створює bootstrap, а не сам Terraform.
> Джерела: [GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs),
> [state locking & versioning](https://www.firefly.ai/academy/understanding-state-locking-and-versioning-in-terraform).

> ⚙️ **Автоматизація:** `buckets describe` (skip якщо є) → `create` → завжди
> реконсайлить безпеку (`--uniform-bucket-level-access --public-access-prevention --versioning`).
> Ім'я бакета виводиться з `project_id`: `${PROJECT_ID}-tfstate-${ENVIRONMENT}`.
> ```bash
> bash infra/run/gcp/run.sh bootstrap   # містить крок state bucket
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `bootstrap()`, блок «Terraform state bucket».

---

## 4. (Опційно) Увімкнути API заздалегідь

Terraform сам вмикає потрібні API (`google_project_service` в [`envs/dev/main.tf`](../terraform/envs/dev/main.tf):
compute, container, redis, servicenetworking, secretmanager, artifactregistry, **iam,
iamcredentials, sts, sqladmin, cloudresourcemanager, orgpolicy, binaryauthorization,
containeranalysis, cloudkms, billingbudgets, cloudquotas**). Вмикати руками не обов'язково, але перший `apply` буде швидший,
якщо зробити це наперед:

```bash
gcloud services enable \
  compute.googleapis.com container.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  servicenetworking.googleapis.com redis.googleapis.com \
  orgpolicy.googleapis.com \
  binaryauthorization.googleapis.com \
  containeranalysis.googleapis.com \
  cloudkms.googleapis.com \
  billingbudgets.googleapis.com \
  cloudquotas.googleapis.com \
  cloudresourcemanager.googleapis.com
```

> **API notes:**
>
> `cloudresourcemanager.googleapis.com` — потрібен Terraform-ресурсу
> `google_project_organization_policy` (v1 ресурс, який використовує Org Policy через
> Cloud Resource Manager API). Без нього Terraform отримує `403 accessNotConfigured`
> при спробі встановити project-level override. Зазвичай увімкнений за замовчуванням,
> але при першому apply на свіжому проєкті може не бути.
>
> `orgpolicy.googleapis.com` — потрібен для v2-ресурсу `google_org_policy_policy`.
> В поточній конфігурації використовується v1 (`google_project_organization_policy`)
> через provider bug [#18281](https://github.com/hashicorp/terraform-provider-google/issues/18281):
> v2-ресурс не надсилає `X-Goog-User-Project` з user ADC, що дає `403 SERVICE_DISABLED`.
> API лишається у списку як підготовка до переходу на v2, коли bug буде виправлено.
> Якщо apply переривається до того, як Terraform сам увімкне цей API — наступний apply
> падає з оманливим повідомленням про quota project (справжня причина: `SERVICE_DISABLED`).
>
> `binaryauthorization.googleapis.com` — потрібен для Policy API, яку GKE читає при
> `evaluation_mode = PROJECT_SINGLETON_POLICY_ENFORCE`.
>
> `containeranalysis.googleapis.com` — потрібен для зберігання SLSA-приміток і відповідей,
> які CI заливає через `actions/attest-build-provenance`. Без цих API `tofu apply` падає
> з помилкою `403 API not enabled`.
>
> `cloudkms.googleapis.com` — потрібен для KMS-ключа підпису attestor-а Binary Authorization
> (gated-блок `binauthz_enabled` у [`modules/gke`](../terraform/modules/gke)). У dev
> `binauthz_enabled=false` за замовчуванням, тож keyring/ключ **не створюються** (KMS не має
> free tier), але API лишається у списку для паритету з prod, де enforcement увімкнено.
>
> `billingbudgets.googleapis.com` — потрібен для Cloud Billing budget + порогових алертів
> (50/90/100%) у [`budget.tf`](../terraform/envs/dev/budget.tf). Бюджет лише **алертить**, не
> зупиняє витрати — реальний $0-контроль дає event-driven auto-suspend.
>
> `cloudquotas.googleapis.com` — потрібен Terraform-ресурсу `google_cloud_quotas_quota_preference`
> у [`quotas.tf`](../terraform/envs/dev/quotas.tf), який кодифікує підвищення регіональної квоти
> `SSD_TOTAL_GB` (500 → 1500 GB). Boot-диски вузлів Autopilot біжать проти цієї квоти (~400 GB у
> steady-state); дефолтних 500 GB замало для surge, коли пересоздання node pool або auto-upgrade
> створює нові вузли **до** видалення старих → `QUOTA_EXCEEDED`, поди без місця, NEG порожніє,
> ingress віддає 502, поки старі вузли не звільняться. Підняття ліміту **безкоштовне** (біллінг за
> usage, не за ліміт; deep-suspend → $0).

> 📚 **Для співбесіди — чому API треба «вмикати».** У GCP кожен сервіс — це окремий
> **API**, **вимкнений за замовчуванням** у новому проєкті (модель найменших
> привілеїв + контроль вартості). Поки `service.googleapis.com` не enabled, будь-який
> виклик до нього повертає `403`. Terraform уміє вмикати їх сам через
> `google_project_service`, але робить це **послідовно з очікуванням готовності
> кожного API**, що сповільнює перший `apply`. Пре-енейбл одним пакетним викликом
> прибирає це очікування. Головне правило: **список тут мусить збігатися** зі
> списком `google_project_service` у [`envs/dev/main.tf`](../terraform/envs/dev/main.tf),
> інакше Terraform однаково чекатиме на відсутній API.

> ⚙️ **Автоматизація:** викликає `gcloud services enable` з явним `--project` (бо
> `gcloud config` мутабельний між терміналами). Ідемпотентно — повторний enable безпечний.
> ```bash
> bash infra/run/gcp/run.sh bootstrap   # завершується enable APIs
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `bootstrap()`, блок «Enable APIs».

---

## 5. Дані для `terraform.tfvars`

Скопіюй приклад і заповни. Файл **gitignored** — реальні значення не комітяться.

```bash
cd infra/terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars
```

| Змінна              | Звідки взяти                                                                                                       | Приклад                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `project_id`        | з кроку 1.2                                                                                                        | `project-39965ce5-4c4b-495e-8d4` |
| `region`            | Має збігатися з CI; GCS Always Free — лише `us-west1`, `us-central1`, `us-east1`                                   | `us-central1`                    |
| `github_repository` | `owner/repo` твого форку                                                                                           | `o-mishch/devstash`              |
| `github_owner_id`   | **числовий** ID власника (immutable — пінить WIF-умову): `curl -s https://api.github.com/users/o-mishch \| jq .id` | `5354532`                        |
| `app_domain`        | домен, яким володієш (для DNS + managed cert)                                                                      | `gke.devstash.one`               |

> `github_owner_id` — це не назва, а число. Саме воно захищає WIF від репозиторія-двійника
> з такою ж назвою (WIF-умова пінить immutable `repository_owner_id`, а не лише назву репо).

Після заповнення базових полів файл матиме таку структуру (деталі ключів `third_party_secrets` — у §7b):

```hcl
project_id        = "project-39965ce5-4c4b-495e-8d4"
region            = "us-central1"
environment       = "dev"
github_repository = "o-mishch/devstash"
github_owner_id   = "5354532"
app_domain        = "gke.devstash.one"
email_from        = "DevStash <noreply@gke.devstash.one>"

third_party_secrets = {
  "auth-secret"           = "..."   # openssl rand -base64 32
  "auth-github-secret"    = "..."
  "auth-google-secret"    = "GOCSPX-..."
  "resend-api-key"        = "re_..."
  "stripe-secret-key"     = "sk_test_..."
  "stripe-webhook-secret" = "whsec_..."
  "openai-api-key"        = "sk-svcacct-..."
  # НЕ секрети — тому НЕ тут. Живуть у ConfigMap devstash-config (settings.yaml →
  # kustomize replacement), щоб у Secret Manager лишалися лише справжні секрети:
  #   "email-from"                          → var.email_from → EMAIL_FROM
  #   "auth-github-id" / "auth-google-id"   → OAuth CLIENT ID (публічні, у redirect)
  #   "stripe-publishable-key"              → публічний за задумом Stripe (pk_...)
  #   "stripe-price-id-monthly" / "-yearly" → несекретні ідентифікатори (price_...)
  # Задай їх у settings.yaml (закомічено) або перекрий через GitHub Actions repo vars
  # AUTH_GITHUB_ID / AUTH_GOOGLE_ID / STRIPE_PUBLISHABLE_KEY / STRIPE_PRICE_ID_MONTHLY /
  # STRIPE_PRICE_ID_YEARLY (.github/workflows/deploy-gke.yml → "Inject environment values").
  # НЕ додавай: database-url / direct-url — їх генерує Terraform (Cloud SQL)
  # НЕ додавай: redis-url / redis-ca-cert — їх генерує Terraform (Memorystore)
}
```

> ⚠️ `run/gcp/run.sh` перевіряє наявність плейсхолдерів (`sk_...`, `whsec_...`, `re_...`,
> `openssl rand`) і **зупиниться** до `tofu apply`, якщо їх знайде. Заповни реальні значення.

> 📚 **Для співбесіди — Workload Identity Federation (keyless CI).** `github_owner_id`
> існує заради WIF — способу деплоїти **без довгоживучого JSON-ключа SA** (який
> легко злити). Як це працює:
> 1. Job із `permissions: id-token: write` змушує GitHub видати **короткоживучий
>    OIDC-JWT** із claim-ами про workflow (`repository`, `repository_owner`, `ref`,
>    складений `sub`).
> 2. Google **STS** перевіряє цей токен проти issuer-а GitHub **і проти
>    attribute-condition** твого WIF-pool, тоді обмінює його на **короткоживучий
>    Google-креденшел (експайр ~1 год)**. Жодного статичного ключа.
>
> Чому **числовий** `repository_owner_id`, а не назва: умова пінить *immutable*
> числовий ID. Назви (`owner`/`repo`) можна звільнити (видалив org/repo — хтось
> інший займає ту саму назву) → ризик **typosquatting/cybersquatting**. Числові
> `*_id` незмінні й переживають перейменування. Джерела:
> [Keyless auth from GitHub Actions](https://cloud.google.com/blog/products/identity-security/enabling-keyless-authentication-from-github-actions),
> [WIF з deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).

> ⚙️ **Автоматизація:** `ensure_tfvars()` перевіряє, що `terraform.tfvars` існує
> (копіює з `.example` якщо ні, і зупиняється), та попереджає про незаповнені
> плейсхолдери в `third_party_secrets`. Запускається автоматично перед кожним `apply`.
> ```bash
> bash infra/run/gcp/run.sh apply   # ensure_tfvars() → tofu init/plan/apply (§6)
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `ensure_tfvars()`.

---

## 6. Terraform: `tofu init` → `tofu plan` → `tofu apply`

> ⚠️ **Перед першим `apply`:** Terraform створює ресурс `google_org_policy_policy`
> (override `constraints/iam.disableServiceAccountKeyCreation` на рівні проєкту), щоб
> можна було смінтити GCS S3-interop HMAC-ключ для app SA. Для цього потрібна роль
> `roles/orgpolicy.policyAdmin` — вона **призначається лише на рівні організації**
> (на проєкті GCP відхиляє її з `INVALID_ARGUMENT`). Видай собі роль один раз:
>
> ```bash
> # Знайти org ID (числовий):
> gcloud organizations list
> # → nastrsoft-org  395045689813
>
> # Призначити роль на рівні організації:
> gcloud organizations add-iam-policy-binding 395045689813 \
>   --member=user:nastrsoft@gmail.com \
>   --role=roles/orgpolicy.policyAdmin
> ```
>
> Перевірити, що роль видана:
> `gcloud organizations get-iam-policy 395045689813 --flatten="bindings[].members" --filter="bindings.members:nastrsoft@gmail.com" --format="table(bindings.role)"`

```bash
cd infra/terraform/envs/dev

# Ініціалізація — завантажує провайдери (~150 MB) і прив'язує GCS backend.
# bucket — ім'я state-бакета зі §3; prefix фіксований у backend.tf (gke/dev).
tofu init -backend-config="bucket=project-39965ce5-4c4b-495e-8d4-tfstate-dev"

# Перегляд плану: список ресурсів, що будуть створені. Зберігаємо в файл,
# щоб apply виконав рівно той план, який ми переглянули (без повторного refresh).
tofu plan -out=devstash.tfplan

# Застосувати. Перший раз займає 10–20 хв (GKE Autopilot + Cloud SQL + Memorystore).
tofu apply devstash.tfplan

# Переглянути план у читабельному JSON (бінарний .tfplan людиною не читається):
tofu show -json devstash.tfplan | jq .
# Лише ресурси зі змінами:
tofu show -json devstash.tfplan | jq '[.resource_changes[] | select(.change.actions != ["no-op"])]'
```

> Типовий час: `init` — 1–2 хв (завантаження провайдера Google ~150 MB), `plan` — 30–60 с,
> `apply` (перший) — **10–20 хв**. GKE Autopilot мовчить 5–7 хв під час provision control
> plane — це нормально, не переривай.

Після `apply` Terraform створює:

- VPC + subnet + Cloud NAT + PSA peering ([modules/network](../terraform/modules/network))
- **Статичну IP для Ingress** (`devstash-dev-ip`)
- **WIF pool/provider + binding deployer-SA**
- GKE Autopilot-кластер, Artifact Registry, GCS-бакет, **Cloud SQL** (БД), **Memorystore** (Redis)
- App-SA + deployer-SA + IAM-ролі + секрети `third_party_secrets` в Secret Manager

```bash
# Після apply — прив'яжи kubeconfig до нового кластера:
eval "$(tofu output -raw get_credentials_command)"
kubectl get nodes   # має показати вузли кластера
```

**Переглянути все в GCP Console** ([console.cloud.google.com](https://console.cloud.google.com) → проєкт `project-39965ce5-4c4b-495e-8d4`):

| Що створив Terraform        | Розділ Console                                 |
| --------------------------- | ---------------------------------------------- |
| GKE кластер                 | **Kubernetes Engine → Clusters**               |
| Cloud SQL                   | **SQL**                                        |
| Memorystore (Redis)         | **Memorystore → Redis**                        |
| VPC, subnet, Cloud NAT      | **VPC network → VPC networks**                 |
| Статична IP (Ingress)       | **VPC network → IP addresses**                 |
| Artifact Registry           | **Artifact Registry → Repositories**           |
| GCS bucket (uploads)        | **Cloud Storage → Buckets**                    |
| Secret Manager секрети      | **Security → Secret Manager**                  |
| Service Accounts            | **IAM & Admin → Service accounts**             |
| IAM ролі                    | **IAM & Admin → IAM**                          |
| Workload Identity pool      | **IAM & Admin → Workload Identity Federation** |
| Binary Authorization policy | **Security → Binary Authorization**            |
| Org policy override         | **IAM & Admin → Organization policies**        |
| Увімкнені API               | **APIs & Services → Enabled APIs**             |

> Всі ресурси одразу — **Cloud Asset Inventory** (пошук у Console): фільтруй по типу і бачиш весь проєкт в одному місці.

> ⚙️ **Автоматизація:** `apply()` у `run.sh` виконує `tofu init/plan/apply`, після чого
> прив'язує kubeconfig (`get_credentials_command`) і встановлює ESO + Reloader.
> ```bash
> bash infra/run/gcp/run.sh apply   # tofu init → plan → apply → get-credentials → ESO
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `apply()`.

---

## 7. Після `tofu apply`: External Secrets Operator + 3 GitHub-секрети (+ 1 змінна) + DNS

> **Де виконувати — локальний ноутбук.** Усі команди нижче (`helm`, `kubectl`, `gh`,
> `tofu output`) запускаються з твого Mac, не всередині кластера.
>
> **Як `helm` і `kubectl` потрапляють на віддалений кластер:**
> `tofu output -raw get_credentials_command` (або `gcloud container clusters
> get-credentials`) записує **kubeconfig** у `~/.kube/config`. Після цього `kubectl` і
> `helm` підписують кожен запит твоїми ADC-кредами і надсилають його на
> **DNS-ендпоінт control plane** кластера (`*.gke.goog`) через публічний інтернет
> (дозволено завдяки `allow_external_traffic = true` у `dns_endpoint_config`). GCP
> авторизує запит через IAM (`container.developer`) — без IP-allowlist, без VPN.
>
> ```bash
> # Отримати kubeconfig (один раз після apply, або після будь-якого eval вище)
> eval "$(tofu output -raw get_credentials_command)"
> kubectl get nodes   # перевірка зв'язку з кластером
>
> # Перевірити autoscaling-профіль (Autopilot встановлює OPTIMIZE_UTILIZATION автоматично,
> # ці поля не з'являються в modules/gke/main.tf — вони керовані GCP, не Terraform):
> gcloud container clusters describe devstash-dev-gke \
>   --region=us-central1 \
>   --project=project-39965ce5-4c4b-495e-8d4 \
>   --format="yaml(autoscaling)"
> ```

> ⚠️ **Autopilot: `kubectl get nodes` повертає «No resources found» після свіжого `tofu apply`.**
>
> Це нормальна поведінка GKE Autopilot. Вузли **не існують** одразу після створення кластера —
> Autopilot провізіонує їх **лише у відповідь на user-навантаження** (поди з ресурсними запитами).
> Системні поди в `kube-system` (`kube-dns`, `konnectivity-agent` тощо) мають статус `Pending`,
> але Autopilot **не провізіонує вузли тільки для них** — це задокументована поведінка
> (автоскейлер реагує на user-поди, не на системні).
>
> **Вирішення:** задеплой будь-який user-под із ресурсними запитами — це розблоковує автоскейлер:
>
> ```bash
> # ⚠️ WARNING: Standard `kubectl run` without overrides will FAIL on GKE Autopilot
> # due to the "restricted" PodSecurity Admission profile (v1.31+).
> # The securityContext settings below are strictly required to satisfy:
> #   - runAsNonRoot: true -> Pod must not run as root.
> #   - runAsUser/Group/fsGroup: 1001 -> Standard non-root user/group for DevStash containers. Explicitly declared
> #     to avoid reliance on container image defaults which GKE admission webhooks may not resolve.
> #   - seccompProfile: RuntimeDefault -> Restricts system calls using default profile.
> #   - allowPrivilegeEscalation: false -> Prevents container processes from gaining privileges.
> #   - capabilities.drop: ["ALL"] -> Minimizes attack surface by dropping all capabilities.
> # DO NOT simplify or remove these overrides!
> kubectl run trigger-node \
>   --image=gcr.io/google-containers/pause:3.9 \
>   --restart=Never \
>   --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":1001,"runAsGroup":1001,"fsGroup":1001,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"trigger-node","image":"gcr.io/google-containers/pause:3.9","resources":{"requests":{"cpu":"100m","memory":"128Mi"}},"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"seccompProfile":{"type":"RuntimeDefault"}}}]}}' \
>   -n default
>
> # Спостерігай за провізіонуванням (~2–5 хв):
> kubectl get events -n default --watch   # шукай "TriggeredScaleUp"
> kubectl get nodes --watch
>
> # Після появи вузла — прибери trigger-под (він більше не потрібен):
> kubectl delete pod trigger-node -n default
> ```
>
> Після появи першого вузла всі kube-system поди переходять у `Running` протягом ~1 хвилини.
> Далі `helm upgrade --install external-secrets …` та наступні кроки можна виконувати одразу.
>
> **Чому так працює:** Autopilot-кластер без жодного навантаження не тримає вузлів —
> за це відповідає автоскейлер з профілем `OPTIMIZE_UTILIZATION`. Перший деплой ESO (крок 7.0)
> запустить свої поди, і з того моменту вузли будуть присутні постійно. Поки ESO не задеплоєно,
> потрібен саме цей trigger-pod. Докладніше: R7 у [`09-gcp-audit.md`](09-gcp-audit.md).

Це теж «ручні» кроки, але вже **після** Terraform (значення дає `tofu output`):

```bash
# 7.0 External Secrets Operator + Stakater Reloader — ОДИН раз на кластер,
#     ПЕРЕД першим `kubectl apply -k`.
#     Без ESO overlay-CR SecretStore/ExternalSecret не мають CRD → apply падає
#     ("no matches for kind SecretStore"), і pod ніколи не отримає секрети.
#     Без Reloader зміни в Secret Manager не застосовуються до подів автоматично.
helm repo add external-secrets https://charts.external-secrets.io
helm repo add stakater https://stakater.github.io/stakater-charts
helm repo update

# ESO: ставить CRD SecretStore/ExternalSecret
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait --timeout 5m --atomic \
  --set resources.requests.cpu=50m --set resources.requests.memory=128Mi \
  --set certController.resources.requests.cpu=50m --set certController.resources.requests.memory=128Mi \
  --set webhook.resources.requests.cpu=50m --set webhook.resources.requests.memory=128Mi
# Дочекатись webhook (CR-admission потребує живого webhook до першого kubectl apply -k)
kubectl -n external-secrets rollout status deploy/external-secrets-webhook --timeout=3m

# Stakater Reloader: автоматичний rolling restart при оновленні devstash-secrets
helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m --atomic \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi

# 7.1 GitHub Actions — 3 секрети + 4 змінні (значення з tofu output)
gh secret set GCP_PROJECT_ID --body "$(tofu output -raw gcp_project_id)"
gh secret set DEPLOYER_SA --body "$(tofu output -raw deployer_service_account_email)"
gh secret set WORKLOAD_IDENTITY_PROVIDER --body "$(tofu output -raw wif_provider)"
gh variable set APP_DOMAIN --body "$(tofu output -raw app_domain)"
# Binary Authorization attestor/KMS — non-secret resource names read by the
# "Sign images for Binary Authorization" CI step (deploy-gke.yml). ТІЛЬКИ якщо
# binauthz_enabled=true (у dev за замовчуванням FALSE → ці outputs null і `-raw` впаде;
# CI-крок сам себе пропускає). Простіше: `run.sh set-repo-secrets` робить це умовно.
if [ -n "$(tofu output -raw binauthz_attestor_name 2>/dev/null)" ]; then
  gh variable set BINAUTHZ_ATTESTOR --body "$(tofu output -raw binauthz_attestor_name)"
  gh variable set BINAUTHZ_KMS_KEYRING --body "$(tofu output -raw binauthz_kms_keyring)"
  gh variable set BINAUTHZ_KMS_KEY --body "$(tofu output -raw binauthz_kms_key)"
fi

# 7.2 DNS: A-запис для app_domain → IP Ingress (managed cert провіжиниться лише після резолву)
tofu output -raw ingress_ip_address
```

**Перевірка після §7.1** — переконайся, що секрети записані коректно:

```bash
gh secret list | grep -E 'GCP_PROJECT_ID|DEPLOYER_SA|WORKLOAD_IDENTITY_PROVIDER'
gh variable get APP_DOMAIN
gh variable get BINAUTHZ_ATTESTOR
# Очікувано: статус "set" і значення для кожного
```

> 📚 **Для співбесіди — навіщо External Secrets Operator (ESO).** Секрети живуть у
> **Google Secret Manager** (поза кластером), а под потребує їх як K8s `Secret`.
> ESO — це **контролер**, що ставить CRD `SecretStore`/`ExternalSecret` і
> безперервно **синхронізує** зовнішнє сховище в нативний K8s `Secret`
> (`devstash-secrets`). Переваги перед «закомітити Secret у git»: секрети **ніколи
> не лежать у репозиторії чи в state**, ротуються в одному місці (Secret Manager),
> а ESO сам тягне оновлення (≤1 год). Сам ESO автентифікується до Secret Manager
> через **Workload Identity** (KSA↔GSA), тобто **без статичного ключа** — той самий
> keyless-принцип, що й WIF для CI. ESO ставимо **раз на кластер ДО** першого
> `kubectl apply -k`, інакше overlay з `SecretStore` впаде з
> `no matches for kind "SecretStore"`. Джерело:
> [external-secrets.io](https://external-secrets.io/latest/).

> ⚙️ **Автоматизація:** усі кроки 7.0–7.1 покриває скрипт. `eso` ставить ESO
> (`helm … --wait --atomic`) **і** Stakater Reloader; `secrets` заливає 3 GitHub-секрети
> + `APP_DOMAIN`; `dns_hint` друкує готовий рядок A-запису.
> ```bash
> bash infra/run/gcp/run.sh eso       # ESO + Reloader (раз на кластер, розділ 7.0)
> bash infra/run/gcp/run.sh secrets   # gh-секрети з tofu output (розділ 7.1)
> ```
> Код: [`infra/run/gcp/run.sh`](../run/gcp/run.sh) → `eso()`, `secrets()`, `dns_hint()`.

---

## 7a. DNS: піддомен на Spaceship.com (де живе devstash.one)

> ⚠️ **Не чіпай apex `devstash.one` і `www`** — вони вказують на **Vercel** (прод).
> A-запис резолвиться в одне місце; якщо перенаправити apex на GKE-IP, прод на Vercel
> ляже. GKE-деплой живе на **окремому піддомені** — `gke.devstash.one`
> (`app_domain` у tfvars). Так Vercel і GKE працюють паралельно, не конфліктуючи.

Домен `devstash.one` зареєстровано на **Spaceship.com**. Щоб додати піддомен для GKE,
треба створити **один A-запис** у DNS-зоні Spaceship, який вказує на статичну IP Ingress.

**Крок 1 — взяти IP (після `tofu apply`):**
```bash
tofu -chdir=infra/terraform/envs/dev output -raw ingress_ip_address
# 8.232.44.235
```

**Крок 2 — додати A-запис у Spaceship:**
1. Увійди на [spaceship.com](https://www.spaceship.com) → **Manage** біля `devstash.one`.
2. Відкрий вкладку **Advanced DNS** (або **DNS / Nameservers → Manage DNS**).
   - Якщо домен використовує **Spaceship nameservers** — записи редагуються тут.
   - Якщо nameservers делеговані деінде (напр. на Vercel/Cloudflare) — A-запис треба
     додавати **там**, де зараз обслуговується зона. Перевір: `dig NS devstash.one +short`.
3. Натисни **Add Record** і заповни:

   | Поле                | Значення                                               |
   | ------------------- | ------------------------------------------------------ |
   | **Type**            | `A`                                                    |
   | **Host** (Name)     | `gke`  ← лише піддомен, не `gke.devstash.one` і не `@` |
   | **Value / Address** | `8.232.44.235` (статична IP Ingress з Terraform)       |
   | **TTL**             | `5 min` (на час налаштування; потім можна збільшити)   |

4. **Save**. `@` (apex) і `www` лиши без змін — вони ведуть на Vercel.

> Поле **Host** на Spaceship приймає лише ліву частину: введи `gke`, а не повний FQDN —
> Spaceship сам додасть `.devstash.one`. Введення повного імені дасть
> `gke.devstash.one.devstash.one`.

**Крок 3 — перевірити, що резолвиться, перш ніж чекати cert:**
```bash
dig +short gke.devstash.one          # має повернути IP Ingress
# або
nslookup gke.devstash.one
```

**Крок 4 — дочекатися Google-managed cert** (провіжиниться лише ПІСЛЯ того, як DNS
резолвиться на IP; зазвичай 15–60 хв):
```bash
kubectl -n devstash get managedcertificate devstash-cert -o wide
# STATUS: Provisioning → Active
```

> Якщо команда повертає `Error from server (NotFound): managedcertificates … "devstash-cert" not found` —
> GCP overlay ще не застосовано до кластера. Застосуй його (потрібен реальний digest образу та заповнені
> `settings.yaml` / GitHub-секрети з кроків 6–7.1, інакше поди не підніметься):
> ```bash
> kubectl apply -k infra/k8s/overlays/gcp
> ```

> Якщо cert завис у `Provisioning` довше години — майже завжди DNS ще не резолвиться
> глобально (перевір `dig`), або A-запис веде не на ту IP. HTTPS-LB і cert на GKE
> вимагають саме коректного публічного A-запису.

> 🔒 **Тільки вручну** — A-запис вноситься у дашборді реєстратора (Spaceship або той, де
> обслуговується зона); `run.sh` лише друкує готовий рядок (`dns_hint`), але записати його
> може лише власник домену.

---

## 7b. Сторонні секрети (3rd-party) у Secret Manager — обов'язково перед деплоєм

> ⚠️ **Це найлегше пропустити.** Pod читає всі env-змінні з K8s-секрета
> `devstash-secrets`, який **External Secrets Operator (ESO)** збирає з Google Secret
> Manager (див. [`external-secrets.yaml`](../k8s/overlays/gcp/external-secrets.yaml)).
> Terraform створює лише **інфраструктурні** креди (Cloud SQL, Memorystore, GCS
> S3-interop). Реальні **сторонні** креди (Stripe, Resend, OAuth, OpenAI, auth-secret)
> Terraform **не знає** — їх
> треба покласти в Secret Manager **руками** (або через tfvars, Спосіб А). Без них ESO не зможе матеріалізувати
> `devstash-secrets`, і pod не підніметься (`CreateContainerConfigError`).

**Згенеровані Terraform (НЕ додавай руками)** — для керованих сховищ:
`devstash-database-url` / `devstash-direct-url` (приватний IP керованого Cloud SQL),
`devstash-redis-url` (`rediss://…@memorystore`, нативний node-redis; AUTH + in-transit
TLS) і `devstash-redis-ca-cert` (server CA для перевірки сертифіката). Усе це
`random_password`/похідні модулів `cloudsql`/`memorystore` у
[`main.tf`](../terraform/envs/dev/main.tf) — у tfvars їх **немає**. `DB_DRIVER=pg`
(вибір node-postgres адаптера) — не секрет, у ConfigMap.

> **Один консолідований секрет.** Усі креди застосунку тепер лежать як **властивості
> (properties) ОДНОГО секрета `devstash-app-config`** — JSON-обʼєкт, який будує Terraform
> (`modules/iam`, `jsonencode`). ESO розбирає його назад на окремі ключі через
> `remoteRef.property` (див. `external-secrets.yaml`). Навіщо: у deep-suspend лишається **1
> активна версія секрета** замість ~9 — усередині безкоштовного ліміту Secret Manager (6
> версій), тобто **$0** у простої. Стовпець нижче — це **імена властивостей** усередині
> `devstash-app-config` (без префікса `devstash-`).

ESO очікує саме такі імена властивостей (`remoteRef.property` в `devstash-app-config`) —
**це лише сторонні креди, які Terraform не може вивести**:

| Властивість у `devstash-app-config`  | Env-змінна в app         | Звідки взяти              |
| ------------------------------------ | ------------------------ | ------------------------- |
| `auth-secret`                        | `AUTH_SECRET`            | `openssl rand -base64 32` |
| `auth-github-secret`                 | `AUTH_GITHUB_SECRET`     | GitHub OAuth App          |
| `auth-google-secret`                 | `AUTH_GOOGLE_SECRET`     | Google OAuth Client       |
| `resend-api-key`                     | `RESEND_API_KEY`         | Resend                    |
| `stripe-secret-key` / `-webhook-secret` | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe |
| `openai-api-key`                     | `OPENAI_API_KEY`         | OpenAI                    |

> **Несекретна конфігурація — НЕ в Secret Manager.** `AUTH_GITHUB_ID`, `AUTH_GOOGLE_ID`
> (OAuth client ID — публічні), `STRIPE_PUBLISHABLE_KEY` (публічний `pk_...`) та
> `STRIPE_PRICE_ID_MONTHLY` / `_YEARLY` (несекретні `price_...`) живуть у ConfigMap
> `devstash-config` (`settings.yaml` → kustomize replacement), а не тут — щоб Secret
> Manager тримав лише справжні секрети (менший idle-кошт + вужчий RBAC blast radius).

**Два способи їх додати:**

**Спосіб А (рекомендований) — через Terraform `var.third_party_secrets`.** Додай їх у
`terraform.tfvars` (файл gitignored), і Terraform створить і секрет, **і** binding
`secretAccessor` за тебе — нічого не доведеться зв'язувати руками:

```hcl
# terraform.tfvars (НЕ комітиться)
third_party_secrets = {
  "auth-secret"              = "..."
  "resend-api-key"           = "re_..."
  "stripe-secret-key"        = "sk_live_..."
  # ... решта ключів з таблиці вище (без префікса devstash-).
  # database-url / direct-url НЕ додавай — їх генерує Terraform (Cloud SQL).
}
```

Ключ `auth-secret` у `third_party_secrets` → властивість `auth-secret` у секреті
`devstash-app-config` → ESO `remoteRef: { key: devstash-app-config, property: auth-secret }`.
Terraform складає всі ключі в один JSON-blob.

**Спосіб Б — руками через `gcloud`** (якщо не хочеш тримати креди у tfvars). Оскільки все
консолідовано в один секрет, тут потрібно **правити властивість усередині
`devstash-app-config`** (read-modify-write), а не створювати окремий `devstash-<key>` —
окремий секрет ESO більше не читає. Найпростіше — командою `run.sh`:

```bash
# Оновлює одну властивість у devstash-app-config і форсить ESO-синк:
bash infra/run/gcp/run.sh rotate-secret resend-api-key   # значення — з прихованого prompt

# Або вручну через jq (read-modify-write однієї властивості):
blob="$(gcloud secrets versions access latest --secret=devstash-app-config)"
printf '%s' "$blob" | jq --arg k resend-api-key --arg v "re_..." '.[$k]=$v' \
  | gcloud secrets versions add devstash-app-config --data-file=-
# app-SA вже має secretAccessor на devstash-app-config (Terraform) — окремий binding не потрібен.
```

> Перевірити, що ESO підтягнув усе: `kubectl -n devstash get externalsecret
> devstash-secrets` → `STATUS: SecretSynced`. Якщо `SecretSyncedError` — глянь
> `kubectl -n devstash describe externalsecret devstash-secrets` (зазвичай бракує
> якогось `devstash-*` секрета або binding-у `secretAccessor`).

---

## 7c. Stripe webhook endpoint — зареєструвати після того, як DNS+cert піднялись

> ⚠️ Білінг не звірятиметься, поки Stripe не зможе достукатись до застосунку.
> `stripe-webhook-secret` у Secret Manager (крок 7b) **мусить збігатися** з секретом
> саме того endpoint, що вказує на GKE-хост. Це окремий від Vercel-прода endpoint —
> у Stripe може бути кілька endpoint-ів на один акаунт.

Маршрут у застосунку: [`src/app/api/webhooks/stripe/route.ts`](../../src/app/api/webhooks/stripe/route.ts)
→ повний URL: `https://gke.devstash.one/api/webhooks/stripe` (тобто
`https://<app_domain>/api/webhooks/stripe`).

```bash
# Створити endpoint саме на GKE-хост (НЕ чіпаючи прод-endpoint Vercel).
# Підпиши на ті події, що обробляє route.ts (checkout + subscription + invoice).
stripe webhook_endpoints create \
  --url "https://gke.devstash.one/api/webhooks/stripe" \
  --enabled-events checkout.session.completed \
  --enabled-events customer.subscription.created \
  --enabled-events customer.subscription.updated \
  --enabled-events customer.subscription.deleted \
  --enabled-events invoice.paid \
  --enabled-events invoice.payment_failed

# Взяти signing secret (whsec_…) цього endpoint і покласти його в Secret Manager
# під тим самим ключем, який очікує ESO (крок 7b):
stripe webhook_endpoints list   # знайти id (we_…) щойно створеного endpoint
# whsec показується лише при створенні в дашборді; через CLI — retrieve:
#   Dashboard → Developers → Webhooks → <endpoint> → "Signing secret" → Reveal
printf %s "whsec_…" | gcloud secrets versions add devstash-stripe-webhook-secret --data-file=-
```

> Якщо `stripe-webhook-secret` уже лежить у `third_party_secrets` (Спосіб А) зі
> значенням Vercel-endpoint — після створення GKE-endpoint додай **нову версію**
> секрета зі значенням GKE-endpoint (команда вище). ESO підтягне її на наступному
> refresh (≤1 год) або після `kubectl -n devstash delete secret devstash-secrets`
> (ESO перестворить одразу). Перевір підпис: Stripe Dashboard → Webhooks →
> endpoint → остання доставка має бути `200`, не `400 signature verification failed`.

> 🔒 **Тільки вручну** — endpoint створюється в Stripe Dashboard або Stripe CLI, прив'язаний
> до твого акаунта; `whsec_…` отримують лише там. `run.sh` не може цього автоматизувати.

## 7d. OAuth redirect URIs — додати GKE-хост у GitHub + Google

> ⚠️ Так само легко пропустити, як Stripe webhook. NextAuth callback живе на
> `https://<app_domain>/api/auth/callback/<provider>`. Якщо нового GKE-хосту немає
> у списку дозволених redirect URI провайдера — вхід через OAuth падає з
> `redirect_uri_mismatch`. Прод-URL Vercel **не чіпаємо** — додаємо GKE як ще **один
> додатковий** URI. **Ніколи не видаляй наявні Vercel-URIs** (`https://devstash.one/…`,
> `https://www.devstash.one/…`) — видалення одразу зламає OAuth-вхід у виробничому
> додатку на Vercel.

| Провайдер  | Де додати                                                                                                                                  | Значення                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **GitHub** | OAuth App → *Authorization callback URL* (можна додати лише один; для GKE створи **окремий** OAuth App або GitHub App з кількома callback) | `https://gke.devstash.one/api/auth/callback/github` |
| **Google** | Cloud Console → APIs & Services → Credentials → OAuth client → *Authorized redirect URIs* (підтримує кілька)                               | `https://gke.devstash.one/api/auth/callback/google` |

> Google дозволяє кілька redirect URI на один client — просто додай GKE-URL поряд з
> Vercel. GitHub OAuth App має лише **один** callback; якщо прод на Vercel вже його
> зайняв, заведи окремий OAuth App для GKE: `client_secret` → `devstash-auth-github-secret`
> (крок 7b), а `client_id` (несекретний) → `settings.yaml` `authGithubId`. Перевір: відкрий
> `https://gke.devstash.one/sign-in` → увійди через GitHub/Google → має повернути в апку,
> а не показати `redirect_uri_mismatch`.

> 🔒 **Тільки вручну** — redirect URI вносяться в GitHub OAuth App та Google Cloud Console;
> вони прив'язані до твоїх OAuth-застосунків і не можуть бути додані скриптом із цього репо.

---

## Повний порядок (bootstrap → deploy)

```bash
# ── Ручний bootstrap (цей документ) ──────────────────────────────────────
gcloud auth login
gcloud projects create project-39965ce5-4c4b-495e-8d4 --name="DevStash"
gcloud config set project project-39965ce5-4c4b-495e-8d4
gcloud billing projects link project-39965ce5-4c4b-495e-8d4 --billing-account=015202-D54745-ABDDC9
gcloud auth application-default login
gcloud storage buckets create gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev --location=US \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev --versioning

# ── Terraform ────────────────────────────────────────────────────────────
cd infra/terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars   # заповнити 5 змінних (крок 5)
tofu init -backend-config="bucket=project-39965ce5-4c4b-495e-8d4-tfstate-dev"
tofu plan -out=devstash.tfplan
tofu apply devstash.tfplan
eval "$(tofu output -raw get_credentials_command)"   # прив'язати kubeconfig
kubectl get nodes
# Перевірити autoscaling-профіль кластера (Autopilot встановлює автоматично):
gcloud container clusters describe devstash-dev-gke --region=us-central1 --project=project-39965ce5-4c4b-495e-8d4 --format="yaml(autoscaling)"

# ── 3rd-party креди в Secret Manager (крок 7b) — БЕЗ них pod не підніметься ──
#   Усі креди — властивості ОДНОГО секрета devstash-app-config (консолідовано для $0 idle).
#   Спосіб А: поклади їх у third_party_secrets у terraform.tfvars ще ДО apply (вище).
#   Спосіб Б: run.sh rotate-secret <key> (править властивість у devstash-app-config; розділ 7b).

# ── ESO + Reloader (крок 7.0) ────────────────────────────────────────────
helm repo add external-secrets https://charts.external-secrets.io
helm repo add stakater https://stakater.github.io/stakater-charts
helm repo update
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait --timeout 5m --atomic \
  --set resources.requests.cpu=50m --set resources.requests.memory=128Mi \
  --set certController.resources.requests.cpu=50m --set certController.resources.requests.memory=128Mi \
  --set webhook.resources.requests.cpu=50m --set webhook.resources.requests.memory=128Mi
kubectl -n external-secrets rollout status deploy/external-secrets-webhook --timeout=3m
helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m --atomic \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi

# ── GitHub secrets + DNS (крок 7.1–7.2) ─────────────────────────────────
gh secret set GCP_PROJECT_ID --body "$(tofu output -raw gcp_project_id)"
gh secret set DEPLOYER_SA --body "$(tofu output -raw deployer_service_account_email)"
gh secret set WORKLOAD_IDENTITY_PROVIDER --body "$(tofu output -raw wif_provider)"
gh variable set APP_DOMAIN --body "$(tofu output -raw app_domain)"
# BINAUTHZ_* — лише якщо binauthz_enabled=true (у dev FALSE за замовч.). run.sh робить умовно:
if [ -n "$(tofu output -raw binauthz_attestor_name 2>/dev/null)" ]; then
  gh variable set BINAUTHZ_ATTESTOR --body "$(tofu output -raw binauthz_attestor_name)"
  gh variable set BINAUTHZ_KMS_KEYRING --body "$(tofu output -raw binauthz_kms_keyring)"
  gh variable set BINAUTHZ_KMS_KEY --body "$(tofu output -raw binauthz_kms_key)"
fi
# DNS на Spaceship: A-запис host=gke → $(tofu output -raw ingress_ip_address)
#   (apex devstash.one + www лишаються на Vercel — див. розділ 7a)

# ── Stripe webhook (крок 7c) — після того, як DNS+cert піднялись ───────────
#   stripe webhook_endpoints create --url https://gke.devstash.one/api/webhooks/stripe ...
#   → новий whsec_… у devstash-stripe-webhook-secret (див. розділ 7c)

# ── Deploy ───────────────────────────────────────────────────────────────
git push origin main
#   → CI: verify → build (web + migrate) → push → inject env → apply -k →
#        wait ESO → MIGRATE Job (migrate deploy + seed item_types) → rollout

# ── Прибрати (дві фази через deletion protection) ───────────────────────
# 1. У terraform.tfvars: deletion_protection = false
# 2. Застосувати лише цю зміну:
tofu plan -out=rm-dp.tfplan && tofu apply rm-dp.tfplan
# 3. Знести всю інфру:
tofu destroy
```

> Не забудь `tofu destroy` після тесту на trial — інакше Autopilot Pods і керовані сервіси
> з'їдатимуть кредит (або гроші після його закінчення).

---

## 8. Підключення до Memorystore (Redis) — web UI / CLI

Memorystore for **Valkey** **не має публічного IP** — він живе лише на приватному
VPC-діапазоні (PSC-ендпоінт), до того ж з **IAM AUTH + TLS** (`SERVER_AUTHENTICATION`).
Статичного пароля більше немає: клієнт автентифікується **короткоживучим IAM-токеном**
(OAuth2 access token, TTL ~1 год), який видає Workload Identity. Тож із ноутбука напряму
не під'єднаєшся: треба «місток» **усередині VPC**. Спосіб А під'єднується сам (мінтить
токен у поді); спосіб В публікує UI за публічним URL через IAP.

**Дані для під'єднання (host/port + CA; пароль — це IAM-токен, не з Secret):**

```bash
# Повний URL — БЕЗ креденшелів (rediss://host:6379):
kubectl -n devstash get secret devstash-secrets -o jsonpath='{.data.REDIS_URL}' | base64 -d; echo
# Server CA (для перевірки TLS-сертифіката):
kubectl -n devstash get secret devstash-secrets -o jsonpath='{.data.REDIS_CA_CERT}' | base64 -d > /tmp/memorystore-ca.pem
# Пароль = свіжий IAM-токен принципала з roles/memorystore.dbConnectionUser. Цю роль має
# ЛИШЕ devstash-app@, і мінтить її токен лише Workload Identity ВСЕРЕДИНІ кластера (KSA
# devstash) — тому з ноутбука валідний токен так просто не видобути. Способи А і Б мінтять
# його самі в поді. З ноутбука — тільки якщо тобі окремо видали доступ:
#   • roles/memorystore.dbConnectionUser на твій акаунт → `gcloud auth print-access-token`;
#   • АБО roles/iam.serviceAccountTokenCreator на devstash-app@ → додай прапорець нижче:
#     gcloud auth print-access-token \
#       --impersonate-service-account=devstash-app@project-39965ce5-4c4b-495e-8d4.iam.gserviceaccount.com
```

### Спосіб А — RedisInsight (web UI)

In-cluster RedisInsight бачить Valkey по VPC; UI прокидаємо на ноутбук через
`port-forward`. Пакет — [`overlays/gcp/redisinsight/`](../k8s/overlays/gcp/redisinsight/)
(власний kustomize-пакет, навмисно **поза** оверлеєм — застосовуй за потребою).

**Під'єднується автоматично** — жодного ручного «Add database». Под стартує під SA
`devstash` (Workload-Identity → `devstash-app@`, має `roles/memorystore.dbConnectionUser`),
[`entrypoint.sh`](../k8s/overlays/gcp/redisinsight/entrypoint.sh) мінтить свіжий IAM-токен
з metadata-сервера, бере host/port з живого `REDIS_URL` і CA з `REDIS_CA_CERT`, і
предконфігурує TLS-з'єднання. Нічого не захардкоджено.

```bash
kubectl apply -k infra/k8s/overlays/gcp/redisinsight/   # -k (не -f): kustomize генерує ConfigMap зі скриптом
kubectl -n devstash rollout status deploy/redisinsight
kubectl -n devstash port-forward svc/redisinsight 5540:5540
open http://localhost:5540   # база "devstash-dev (Valkey)" вже там і під'єднана
# Токен читається лише на старті (TTL ~1 год; з'єднання живе ~12 год). Оновити токен:
#   kubectl -n devstash rollout restart deploy/redisinsight
# Прибрати:  kubectl delete -k infra/k8s/overlays/gcp/redisinsight/
```

### Спосіб Б — redis-cli з ефемерного пода (швидка перевірка)

Швидкий `PING` без web UI. Под стартує під SA `devstash` (Workload Identity →
`devstash-app@` з `roles/memorystore.dbConnectionUser`) і **сам мінтить IAM-токен** з
metadata-сервера — з ноутбука валідний токен не видобути (див. блок «Дані для
під'єднання» вище). Overrides для пода —
[`redis-cli-probe.json`](../k8s/overlays/gcp/redisinsight/redis-cli-probe.json): host з
живого `REDIS_URL` (secretKeyRef), PSA-restricted securityContext, а токен мінтиться прямо
в `args` (`wget` до metadata → `redis-cli --user default --pass <token>`).

```bash
kubectl -n devstash run redis-cli --image=redis:7-alpine \
  --overrides="$(cat infra/k8s/overlays/gcp/redisinsight/redis-cli-probe.json)"
kubectl -n devstash wait --for=jsonpath='{.status.phase}'=Succeeded pod/redis-cli --timeout=40s
kubectl -n devstash logs pod/redis-cli    # → PONG
kubectl -n devstash delete pod redis-cli
```

> `--insecure` у probe пропускає перевірку CA для разової перевірки; для повної —
> змонтуй `REDIS_CA_CERT` у под і додай `--cacert /certs/ca.pem`.
>
> Потрібна **інтерактивна** консоль redis-cli? Візьми вбудований CLI в RedisInsight зі
> Способу А — він уже під'єднаний до Valkey (свіжий токен + TLS), мінтити нічого не треба.

### Спосіб В — публічний web UI за IAP (без `kubectl`)

Якщо UI має бути доступний за **публічним URL** (наприклад, демо для портфоліо) без
`port-forward` — публікуємо RedisInsight за Google Cloud HTTPS LB + **Identity-Aware
Proxy**. Сам Memorystore лишається приватним; пускає лише дозволені Google-акаунти.
GCP **не має власного data-браузера** для Memorystore, тому UI — це наш RedisInsight.

> Дорожче й «світліше» за Спосіб А: окремий LB (~$18/міс), статичний IP, managed
> cert, под працює постійно. Для щоденного дебагу бери Спосіб А (port-forward).

Маніфест — [`overlays/gcp/redisinsight-public.yaml`](../k8s/overlays/gcp/redisinsight-public.yaml)
(теж **поза** kustomization). Хост за замовчуванням `redis-ui.gke.devstash.one`
(піддомен — не конфліктує ні з застосунком, ні з Vercel-apex). Використовуємо
**Google-managed OAuth** (`iap.enabled` без `oauthclientCredentials`) — IAP сам
створює OAuth-клієнт, тож руками не треба ні brand/client, ні Secret з креденшелами.
Одноразове налаштування (статичний IP, DNS A-record, OAuth-консент, IAM-грант
`roles/iap.httpsResourceAccessor`) розписане покроково в шапці маніфесту. Далі:

```bash
kubectl apply -f infra/k8s/overlays/gcp/redisinsight-public.yaml
kubectl -n devstash describe managedcertificate redisinsight-cert   # дочекайсь Active
open https://redis-ui.gke.devstash.one
```

---

## 9. Скрипт «у одну команду»: `infra/run/gcp/run.sh`

Усе з розділів 1–7 (окрім того, що фізично робиться в чужих дашбордах — DNS, Stripe,
OAuth) автоматизовано в одному ідемпотентному скрипті — хмарний аналог локального
[`infra/run/local/run.sh`](../run/local/run.sh). Кожен крок перевіряє існування
перед створенням, тож повторний запуск безпечний.

```bash
bash infra/run/gcp/run.sh up             # preflight → bootstrap → tofu apply → ESO+Reloader → gh-секрети → DNS-підказка
bash infra/run/gcp/run.sh bootstrap      # лише project/billing/ADC/state-bucket/APIs (розділи 1–4)
bash infra/run/gcp/run.sh apply          # лише tofu init/plan/apply (+ get-credentials, + ESO+Reloader)
bash infra/run/gcp/run.sh eso            # встановити ESO + Stakater Reloader (раз на кластер, розділ 7.0)
bash infra/run/gcp/run.sh reloader       # лише встановити Stakater Reloader окремо (раз на кластер)
bash infra/run/gcp/run.sh secrets        # лише gh secret/variable set із tofu output (розділ 7)
bash infra/run/gcp/run.sh verify-secrets # перевірити, що всі очікувані Secret Manager секрети існують
bash infra/run/gcp/run.sh deploy         # запустити CI deploy-gke (build web+migrate → migrate Job → rollout)
bash infra/run/gcp/run.sh smoke          # дочекатись CI + перевірити health endpoint
bash infra/run/gcp/run.sh status         # кластер / Ingress IP / стан cert / поди
bash infra/run/gcp/run.sh logs           # хвіст логів app-подів (останні 100 рядків, усі поди)
bash infra/run/gcp/run.sh down           # tofu destroy (з підтвердженням)
```

### 9.1. Що скрипт автоматизує (повністю)

Кожен крок ідемпотентний — `describe`/`list` перед `create`, тож повторний запуск нічого
не дублює й не ламає.

| #   | Крок скрипта                 | Що робить                                                                                                                                                                                                                                                                                                                       | Аналог розділу |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | **preflight**                | Перевіряє, що встановлені `gcloud`, `tofu`, `gh`, `kubectl`, `helm`, `jq`; інакше падає з посиланням на встановлення.                                                                                                                                                                                                           | —              |
| 2   | **ensure_tfvars**            | Якщо `terraform.tfvars` немає — копіює з `.example` і зупиняється (щоб ти вписав реальні значення). Якщо є — читає `project_id`/`region`/`app_domain` і попереджає про плейсхолдери в `third_party_secrets`.                                                                                                                    | 5, 7b          |
| 3   | **gcloud auth login**        | Якщо немає активного акаунта — відкриває браузер для входу.                                                                                                                                                                                                                                                                     | 1.1            |
| 4   | **project create + set**     | Створює проєкт (якщо ще не існує) і робить активним.                                                                                                                                                                                                                                                                            | 1.2–1.3        |
| 5   | **billing link**             | Прив'язує білінг: бере `BILLING_ACCOUNT` або перший відкритий акаунт.                                                                                                                                                                                                                                                           | 1.4            |
| 6   | **ADC login**                | Якщо немає Application Default Credentials — відкриває браузер (їх читає Terraform-провайдер).                                                                                                                                                                                                                                  | 2              |
| 7   | **state bucket**             | Створює `gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev` + PAP, uniform access і versioning (chicken-and-egg перед `tofu init`).                                                                                                                                                                                               | 3              |
| 8   | **enable APIs**              | Вмикає 14 потрібних API (compute, container, sqladmin, redis, secretmanager, iam, orgpolicy, cloudresourcemanager, binaryauthorization, containeranalysis, …).                                                                                                                                                                  | 4              |
| 9   | **tofu init + plan + apply** | Піднімає всю інфру: VPC, GKE Autopilot, Memorystore, IAM+WIF, Artifact Registry, GCS, статичну Ingress-IP, Secret Manager. Питає підтвердження перед платним apply.                                                                                                                                                             | 6              |
| 10  | **get-credentials**          | Прописує kubeconfig на новий кластер.                                                                                                                                                                                                                                                                                           | —              |
| 10a | **eso**                      | `helm upgrade --install` External Secrets Operator (`-n external-secrets`, `--wait`) + чекає webhook — ставить CRD SecretStore/ExternalSecret ще ДО першого `kubectl apply -k`. Також встановлює **Stakater Reloader** (`-n reloader`) — автоматичний rolling restart при зміні Secret/ConfigMap. Раз на кластер, ідемпотентно. | 7.0            |
| 11  | **gh secrets**               | Заливає `GCP_PROJECT_ID`, `DEPLOYER_SA`, `WORKLOAD_IDENTITY_PROVIDER` + `APP_DOMAIN`/`EMAIL_FROM`/`ENABLE_GITHUB_ATTESTATIONS`/`BINAUTHZ_*` з `tofu output`.                                                                                                                                                                    | 7              |
| 12  | **dns_hint**                 | Друкує IP Ingress + готовий рядок A-запису й нагадує про Stripe/OAuth.                                                                                                                                                                                                                                                          | 7a             |
| 13  | **deploy**                   | `gh workflow run deploy-gke.yml` → CI збирає web+migrate, проганяє migrate Job (`migrate deploy` + seed item_types) і викочує застосунок.                                                                                                                                                                                       | «Deploy»       |
| 13a | **smoke**                    | `gh run watch --exit-status` (чекає CI) + `curl /api/health?deep=1` (перевіряє live health). Підтверджує успішний end-to-end деплой.                                                                                                                                                                                            | —              |
| 13b | **verify-secrets**           | Порівнює всі очікувані `devstash-*` ключі в Secret Manager зі списком; попереджає про відсутні. Зручно після першого bootstrap або при `CreateContainerConfigError`.                                                                                                                                                            | 7b             |
| 14  | **logs**                     | `kubectl -n devstash logs -l app…=devstash --tail=100 --prefix` — хвіст логів усіх app-подів; зручно одразу після деплою або при дебазі.                                                                                                                                                                                        | —              |

> `third_party_secrets`, які ти вписав у `terraform.tfvars`, Terraform сам кладе в Secret
> Manager і дає app-SA доступ (Спосіб А з 7b) — тобто крок 7b теж покритий, **якщо**
> заповнити tfvars. Руками класти секрети (Спосіб Б) не треба.

### 9.2. Що НЕ можна автоматизувати — ручні кроки (по черзі)

Це дії в **чужих дашбордах / у твоєму редакторі секретів** — їх неможливо зробити з
CLI цього репо. Роби їх у такому порядку:

**Крок A — заповнити `terraform.tfvars` (до першого `apply`).**
Після того як перший `up` створив файл з прикладу, відкрий
[`infra/terraform/envs/dev/terraform.tfvars`](../terraform/envs/dev/terraform.tfvars) і впиши:
1. `project_id` — глобально унікальний (приклад: `project-39965ce5-4c4b-495e-8d4`).
2. `github_repository` — `owner/repo` твого форку (приклад: `o-mishch/devstash`).
3. `github_owner_id` — числовий ID: `curl -s https://api.github.com/users/o-mishch | jq .id` → `5354532`.
4. `app_domain` — піддомен, яким володієш (приклад: `gke.devstash.one`).
5. `email_from` — несекретна адреса відправника (напр. `DevStash <noreply@gke.devstash.one>`).
   Це окрема змінна, не секрет: зберігається в ConfigMap, не в Secret Manager.
6. `third_party_secrets` — реальні креди (детальна таблиця ключів у **7b**):
   - `auth-secret` = `openssl rand -base64 32`
   - `auth-github-secret`, `auth-google-secret` — OAuth client SECRETS (див. крок D)
   - `resend-api-key`
   - `stripe-secret-key`/`-webhook-secret`
   - `openai-api-key`
   - ⚠️ `email-from` НЕ вписуй у `third_party_secrets` — це `email_from` (крок 5 вище).
   - ⚠️ `auth-github-id`/`auth-google-id` (OAuth client ID), `stripe-publishable-key`,
     `stripe-price-id-monthly`/`-yearly` НЕ вписуй — це несекретна конфігурація у
     ConfigMap `devstash-config` (`settings.yaml`), не в Secret Manager (див. **7b**).
   - ⚠️ `database-url`/`direct-url` НЕ вписуй — їх генерує Terraform (Cloud SQL).

**Крок B — DNS A-запис (після `apply`, деталі в 7a).**
1. Візьми IP: `tofu -chdir=infra/terraform/envs/dev output -raw ingress_ip_address`.
2. У дашборді реєстратора (Spaceship для `devstash.one`) додай **A-запис**: Host=`gke`,
   Value=IP, TTL=5 хв. **Apex і `www` не чіпай** — вони на Vercel.
3. Перевір: `dig +short gke.devstash.one` має повернути цю IP.
4. Дочекайся cert: `kubectl -n devstash get managedcertificate devstash-cert -o wide`
   (Provisioning → Active, зазвичай 15–60 хв після резолву DNS).

**Крок C — Stripe webhook (після того, як DNS+cert піднялись, деталі в 7c).**
1. Створи endpoint саме на GKE-хост:
   `stripe webhook_endpoints create --url https://gke.devstash.one/api/webhooks/stripe …`
   (події checkout + subscription + invoice — повний список у 7c).
2. Візьми його `whsec_…` (Dashboard → Webhooks → endpoint → Signing secret → Reveal).
3. Поклади новою версією секрета:
   `printf %s "whsec_…" | gcloud secrets versions add devstash-stripe-webhook-secret --data-file=-`
   (або одразу правильне значення в `third_party_secrets` до `apply`).

**Крок D — OAuth redirect URIs (деталі в 7d).**
1. **GitHub** OAuth App → *Authorization callback URL* =
   `https://gke.devstash.one/api/auth/callback/github` (один callback на застосунок — для GKE
   заведи окремий OAuth App, якщо прод уже зайняв свій).
2. **Google** Cloud Console → Credentials → OAuth client → *Authorized redirect URIs* — додай
   `https://gke.devstash.one/api/auth/callback/google` (Google дозволяє кілька, не чіпай Vercel).
3. Перевір: `https://gke.devstash.one/sign-in` → вхід через GitHub/Google має повернути в апку,
   а не `redirect_uri_mismatch`.

**Крок E — Binary Authorization attestor (для повного enforcement, після першого деплою).**

Terraform створює `defaultAdmissionRule = ALWAYS_DENY` (це валідний API enum) і
`clusterAdmissionRule = ALWAYS_ALLOW` для всього кластера. Cluster rule не фільтрує
за registry, тому поточний bootstrap-режим дозволяє і Artifact Registry, і сторонні
образи. GitHub/Sigstore OCI provenance — окрема система довіри й не задовольняє
Binary Authorization `REQUIRE_ATTESTATION`. Для повного enforcement потрібен
Container Analysis attestor і окрема BinAuthz-атестація кожного digest:

```bash
# 1. Створити note (сховище для метаданих атестацій)
gcloud container binauthz attestors create devstash-slsa \
  --project=project-39965ce5-4c4b-495e-8d4 \
  --attestation-authority-note=projects/project-39965ce5-4c4b-495e-8d4/notes/devstash-slsa \
  --attestation-authority-note-description="SLSA provenance from GitHub Actions"

# 2. Додати ключ attestor-а та навчити CI створювати Binary Authorization
#    attestation для кожного web/migrate image digest.
# 3. Лише після успішної перевірки змінити clusterAdmissionRule на
#    REQUIRE_ATTESTATION + require_attestations_by.
```

> Опційна GitHub artifact attestation перевіряється через `gh attestation verify`;
> вона корисна для provenance, але не є вхідними даними GKE BinAuthz.

> **Чому саме ці кроки не автоматизуються:** A (значення секретів) — їх знаєш лише ти; B (DNS) —
> у реєстраторі, де хоститься зона; C/D (Stripe + OAuth) — у дашбордах третіх сторін, прив'язані
> до твоїх акаунтів; E (attestor) — потребує першого підписаного образу в реєстрі та ручного
> зв'язування ключа. Решта (1–13 у 9.1) — повністю в руках скрипта.

> Перший запуск `up` створить `terraform.tfvars` з прикладу й зупиниться (Крок A).
> Після заповнення — `up` знову доведе bootstrap+apply до кінця. `tofu apply`/`destroy`
> питають підтвердження (обійти — `AUTO_APPROVE=1`); білінг-акаунт підхопиться автоматично
> або задай `BILLING_ACCOUNT=…`.

---

## 10. Очікувані часові рамки

Деякі кроки тривалі — щоб не думати, що щось зависло:

| Крок                            | Типовий час  | Що відбувається                                                                  |
| ------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `tofu init`                     | 1–2 хв       | Завантаження провайдерів Google (~150 MB)                                        |
| `tofu plan`                     | 30–60 с      | API GCP читає стан ресурсів                                                      |
| `tofu apply` (перший раз)       | **10–20 хв** | GKE Autopilot + Cloud SQL + Memorystore — усі три повільні при першому створенні |
| `helm install` ESO              | 1–3 хв       | Завантаження чарту + чекання готовності webhook                                  |
| `gh workflow run` → CI          | 5–10 хв      | docker build (multi-stage) + push + migrate Job + rollout                        |
| DNS-поширення A-запису          | 0–30 хв      | Залежить від TTL реєстратора і кешу резолверів                                   |
| Google-managed cert             | **15–60 хв** | ACME-challenge через Google; вимагає, щоб DNS вже резолвився                     |
| Перший rollout (pod cold start) | 2–5 хв       | Завантаження образу + startup probe (до 60 с)                                    |

> Якщо `tofu apply` завис і нема жодного виводу — перевір `gcloud container clusters list`.
> GKE Autopilot іноді мовчить 5–7 хв під час provision control plane. Це нормально.

---

## 11. Типові помилки та усунення

### `Kubernetes cluster unreachable` / `Error 403 (Forbidden)!!1` — DNS-ендпоінт відхиляє запит

> **Статус:** вирішено (commit `a051ad7`). Першопричина — **IAM-condition на біндингу
> deployer-а**, а **не** зовнішній трафік. `allow_external_traffic = true` уже було
> ввімкнено і причиною НЕ було.

Деплой (CI або локальний) падає на **першому виклику `helm`/`kubectl`**, хоча
`get-gke-credentials` / `gcloud … get-credentials` відпрацював **успішно**:

```
Error: Kubernetes cluster unreachable: <!DOCTYPE html> … Error 403 (Forbidden)!!1
… That's an error. … That's all we know.
```

**Першопричина (підтверджена):** ця **загальна Google-HTML сторінка 403** — це Google
Front End DNS-ендпоінта (`*.gke.goog`), що відхиляє запит. Біндинг deployer-а мав
**IAM-condition**, який прив'язував `resource.name` до шляху кластера
(`projects/…/clusters/…`). Через DNS-ендпоінт дозвіл `container.clusters.connect`
перевіряється на **ресурсі DNS-ендпоінта, а не на шляху кластера**, тому умова ніколи не
збігалася і GFE повертав цю сторінку (а **не** іменовану помилку дозволу). Крок креди
працює, бо читає кластер через завжди-доступний регіональний API
`container.googleapis.com`, а **не** через DNS-ендпоінт — тож зелений крок креди + 403 на
першому API-виклику і є ознакою.

**Рішення (commit `a051ad7`):** прибрано IAM-condition з
`google_project_iam_member.deployer_gke` (`modules/iam/main.tf`). Перевірено: CI після
цього доходить до `helm`/`kubectl`. **Не** додавати знову condition з `resource.name` на
кластер — DNS-ендпоінт не може його задовольнити. `allow_external_traffic = true` тримати
як окрему передумову:

```bash
# Перевірити, що зовнішній трафік увімкнено на живому кластері (окрема передумова, очікувано True):
gcloud container clusters describe devstash-dev-gke --region us-central1 \
  --format='value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)'

# Узгодити будь-який дрейф (авторитетно — застосовує конфіг):
tofu apply        # з infra/terraform/envs/dev
```

CI має fail-fast крок **`Verify control plane reachable (DNS endpoint)`** у `deploy-gke.yml`,
який ловить цей підпис 403 і друкує **обидва** можливі шлюзи (IAM-condition та
`allow_external_traffic`) замість оманливої помилки Helm.

### `helm upgrade external-secrets` падає: `cannot patch ClusterRole … requires container.clusterRoles.update`

> **Статус:** вирішено. deployer-у потрібна роль **`roles/container.admin`** (не
> `container.developer` і не `container.clusterAdmin`) для керування RBAC-обʼєктами кластера.

Після усунення 403 (вище) CI доходить до `helm upgrade --install external-secrets`, але той
падає:

```
cannot patch "external-secrets-controller" with kind ClusterRole … is forbidden:
requires one of ["container.clusterRoles.update"] permission(s) in Cloud IAM …
```

(аналогічно для `ClusterRoleBinding`, `Role`, `RoleBinding`, `ValidatingWebhookConfiguration`).

**Першопричина:** системні Helm-чарти (external-secrets, reloader) створюють/патчать
**RBAC-обʼєкти рівня кластера** та webhook-конфіги. `roles/container.developer` дає на них
лише `get`/`list`, без `create`/`update`/`delete`. Перевірено через
`gcloud iam roles describe`: і `container.developer`, і `container.clusterAdmin` **не**
мають `container.clusterRoles.update` тощо; має лише **`roles/container.admin`** (а також
`customResourceDefinitions.*`).

**Рішення:** підвищено `google_project_iam_member.deployer_gke` до **`roles/container.admin`**
(`modules/iam/main.tf`) — найвужча **передвизначена** роль, що керує RBAC у кластері. **Не**
«знижувати до `clusterAdmin` заради least-privilege» — у неї немає RBAC-дозволів і вона
мовчки знову зламає цей крок. SA призначений лише для деплоїв одного репо (WIF лише з
`refs/heads/main`), тож проєктна `container.admin` — прийнятний обсяг.

### `ImagePullBackOff` на migrate/web Job — нода не може тягнути образ з Artifact Registry (403)

> **Статус:** вирішено. Нодовому SA (Compute Engine default SA) потрібна роль
> **`roles/artifactregistry.reader`** на репозиторії — без неї kubelet отримує 403 при
> запиті pull-токена.

Після усунення RBAC (вище) CI доходить до кроку `Run DB migrations`, створює Job, але под
зависає у `ImagePullBackOff`. Це **не** повільна міграція — образ просто не тягнеться:

```
Failed to pull image "us-central1-docker.pkg.dev/<project>/devstash/migrate@sha256:…":
failed to authorize: failed to fetch oauth token: … 403 Forbidden
```

**Першопричина:** Autopilot-ноди працюють як **Compute Engine default SA**
(`{project_number}-compute@developer.gserviceaccount.com`), і саме цим SA kubelet тягне
образи. `roles/container.defaultNodeServiceAccount` дає реєстрацію ноди + logging/monitoring,
але **жодних** дозволів Artifact Registry. А цей проєкт примусово вмикає org-policy
`iam.automaticIamGrantsForDefaultServiceAccounts`, тож default SA стартує взагалі без ролей
(та сама причина, чому біндинг `defaultNodeServiceAccount` доводиться давати явно). Системні
чарти (external-secrets, reloader) тягнуться з Docker Hub/quay — без GCP-авторизації — тому
падають **лише** in-project AR-образи (migrate, web).

**Рішення:** додано `google_artifact_registry_repository_iam_member.node_artifact_registry_reader`
у `modules/iam/main.tf` — **`roles/artifactregistry.reader`**, обмежений цим репозиторієм
(least-privilege, дзеркало writer-біндингу deployer-а), для default Compute SA. Джерело:
Google «Troubleshoot image pulls».

### Seed падає: `unable to verify the first certificate` (`P1011` / `TlsConnectionError`)

> **Статус:** вирішено. Seed-скрипт має передавати явний `ssl`-обʼєкт у `@prisma/adapter-pg`,
> через спільний `resolveDbSsl()` з `src/lib/utils/db-ssl.ts` (той самий, який імпортує й
> рантайм-адаптер `src/lib/infra/db-local.ts`). Без нього Prisma 7 трактує `sslmode=require`
> як `verify-full` і TLS-рукостискання падає.

Коли Job нарешті тягне образ (вище), **крок 1 `prisma migrate deploy` застосовує всі міграції
успішно**, а далі **крок 2 `prisma/seed.ts` падає** з:

```
SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
…
Error opening a TLS connection: unable to verify the first certificate
code: 'P1011', DriverAdapterError: TlsConnectionError
```

**Першопричина:** Prisma 7 тягне `pg` 8.22 / `pg-connection-string`, які тепер підвищують
`sslmode=require/prefer/verify-ca` до **`verify-full`** (перевірка ланцюга CA **і** збігу
хостнейму) — `prisma/prisma#29060`. `DIRECT_URL` використовує `sslmode=require` до
**приватного IP** Cloud SQL, тож `verify-full` не має CA для звірки та провалює перевірку
хостнейму. `prisma migrate deploy` (крок 1) не зачеплено — CLI на Rust-конекторі трактує
`require` як «лише шифрування»; **падає тільки seed** (крок 2, node-postgres). Ознака:
міграції проходять, seed падає на TLS. Рантайм-адаптер застосунку (`db-local.ts`) цієї вади
не мав — він уже передає явний `ssl`; seed просто не повторював цю логіку.

**Рішення:** у `prisma/seed.ts` `createAdapter()` передаємо явний `ssl` через спільний
`resolveDbSsl()`: `DATABASE_CA_CERT` заданий (Cloud SQL) → `{ ca, rejectUnauthorized: true,
checkServerIdentity: () => undefined }` (verify-CA: звіряємо ланцюг із серверним CA Google,
пропускаємо хостнейм, бо конект по приватному IP); не заданий (локальний kind) → `undefined`
(шануємо `sslmode=disable` з URL). Явний `ssl` **перекриває** `sslmode` з URL і повністю
обходить підвищення до `verify-full`. Резолвер живе у спільному клієнт-безпечному
`src/lib/utils/db-ssl.ts`, який імпортують **і** seed, **і** `db-local.ts` — сам `db-local.ts`
має `import 'server-only'` і не вантажиться в seed-скрипт, але чиста функція вантажиться, тож
джерело істини одне, без копії. Деталі — аудит R12.

### `orgpolicy.googleapis.com` — `403 SERVICE_DISABLED` / quota project not set

> **Статус:** ця помилка більше не виникає в поточній конфігурації. Terraform-ресурс
> змінено з v2 (`google_org_policy_policy`) на v1 (`google_project_organization_policy`),
> який використовує `cloudresourcemanager.googleapis.com` замість `orgpolicy.googleapis.com`
> і коректно працює з user ADC. Секція залишена для розуміння першопричини.

```
Error: Error creating Policy: googleapi: Error 403: Your application is authenticating
by using local Application Default Credentials. The orgpolicy.googleapis.com API requires
a quota project, which is not set by default.
Details: "reason": "SERVICE_DISABLED"
```

**Першопричина (provider bug [#18281](https://github.com/hashicorp/terraform-provider-google/issues/18281)):**
v2-ресурс `google_org_policy_policy` викликає `orgpolicy.googleapis.com` без заголовка
`X-Goog-User-Project` при автентифікації через user ADC (`authorized_user` type). GCP
не може визначити quota project → повертає `403 SERVICE_DISABLED`. Помилка оманлива:
вона говорить про quota project, але справжня причина — відсутній `X-Goog-User-Project`
header (не вирішується через `user_project_override = true` або `billing_project` у
providers.tf). `"consumer": "projects/764086051850"` у details — **це внутрішній проєкт
Google**, не твій.

**Рішення, яке використовується зараз:**
`google_project_organization_policy` (v1 ресурс) — використовує `cloudresourcemanager.googleapis.com`,
який коректно включає quota project header. Ресурс збережено в поточній конфігурації.

**Якщо помилка виникає через переривання apply (API не ввімкнений):**

```bash
# Вмикаємо обидва API, що може знадобитися при переривання apply
gcloud services enable orgpolicy.googleapis.com cloudresourcemanager.googleapis.com \
  --project=project-39965ce5-4c4b-495e-8d4
# Перевіряємо
gcloud services list --enabled --project=project-39965ce5-4c4b-495e-8d4 \
  --filter="name:orgpolicy OR name:cloudresourcemanager"
# Повторюємо apply (plan-файл залишається актуальним)
cd infra/terraform/envs/dev && tofu apply devstash.tfplan
```

> Якщо quota project справді не виставлений: `gcloud auth application-default set-quota-project project-39965ce5-4c4b-495e-8d4`.
> Але з v1-ресурсом це не потрібно.

---

### `no matches for kind "SecretStore"` при `kubectl apply -k`

ESO ще не встановлено або CRD не піднялися:

```bash
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait --timeout 5m --atomic \
  --set resources.requests.cpu=50m --set resources.requests.memory=128Mi \
  --set certController.resources.requests.cpu=50m --set certController.resources.requests.memory=128Mi \
  --set webhook.resources.requests.cpu=50m --set webhook.resources.requests.memory=128Mi
kubectl -n external-secrets rollout status deploy/external-secrets-webhook --timeout=3m
helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m --atomic \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi
kubectl -n external-secrets get pods   # мають бути Running
```

### `Request violates constraint 'constraints/iam.disableServiceAccountKeyCreation'` — conditionNotMet

```
Error: Error creating HmacKey: googleapi: Error 412: Request violates constraint
'constraints/iam.disableServiceAccountKeyCreation', conditionNotMet
```

**Причина:** GCP org policy changes propagate eventually — може пройти кілька хвилин між
тим, як Terraform застосував project-level override (`enforce = false` через
`google_project_organization_policy`), і тим, як цей override починає діяти. Якщо
`module.iam.google_storage_hmac_key.uploads` запускається до того, як propagation завершена
— отримуємо цей `412`.

**`depends_on` не вирішує проблему propagation**: воно гарантує порядок apply, але не
добавляє затримку між ресурсами.

**Рішення:** просто перезапусти apply через ~2-3 хвилини:

```bash
cd infra/terraform/envs/dev
tofu plan -out=devstash.tfplan    # новий план (старий застарів після часткового apply)
tofu apply devstash.tfplan
```

Повторний apply ідемпотентний: вже створені ресурси (org policy, WI binding тощо) пропускаються,
тільки HMAC-ключ і залишкові ресурси продовжуються. На цей момент propagation вже завершена.

---

### Pod у стані `CreateContainerConfigError`

ESO не зміг матеріалізувати `devstash-secrets` — бракує якогось секрета в Secret Manager:

```bash
kubectl -n devstash describe externalsecret devstash-secrets
# Шукай "SecretSyncedError" і назву ключа, якого не вистачає
# Потім: gcloud secrets list --project=project-39965ce5-4c4b-495e-8d4 | grep devstash
```

Найчастіше: не заповнені `third_party_secrets` у tfvars, або `tofu apply` не виконувався після зміни.

### Ingress застряг у `Provisioning` / немає IP

Статична IP ще не прив'язана або `ingressIpName` не збігається:

```bash
kubectl -n devstash get ingress devstash-web -o wide
gcloud compute addresses list --filter="name:devstash-dev-ip"
tofu -chdir=infra/terraform/envs/dev output -raw ingress_ip_address
```

### ManagedCertificate застрягла в `Provisioning` більше години

Майже завжди DNS ще не резолвиться або A-запис веде не на ту IP:

```bash
dig +short gke.devstash.one          # має повернути Ingress IP
kubectl -n devstash describe managedcertificate devstash-cert
# Поле "Domain Status" покаже конкретну причину
```

### CI падає на `gcloud container clusters get-credentials`

WIF або kubeconfig не налаштований:

```bash
# Перевір, що секрети є в GitHub:
gh secret list | grep -E 'GCP_PROJECT_ID|DEPLOYER_SA|WORKLOAD_IDENTITY_PROVIDER'
# Перевір, що кластер існує:
gcloud container clusters list --project=project-39965ce5-4c4b-495e-8d4
```

### Rollout не проходить за 300 с (`kubectl rollout status --timeout=300s`)

Pod не стає Ready; подивись на причину:

```bash
kubectl -n devstash get pods
kubectl -n devstash describe pod <pod-name>   # Events покажуть ImagePullBackOff, OOMKill тощо
kubectl -n devstash logs <pod-name> --previous   # якщо pod перезапустився
# Після успішної міграції НЕ роби blind rollback старого image.
# Зберіть fix-forward commit; старі pods лишаються через maxUnavailable: 0.
```

### Міграції — advisory locking і безпечні зміни схеми

`prisma migrate deploy` використовує **advisory lock** PostgreSQL (timeout 10 с). Це
означає:
- Два паралельних запуски (наприклад, CI та ручний Job) не зіпсують схему — другий
  вичекає 10 с і впаде з помилкою; після цього його треба перезапустити вручну.
- Concurrency guard у CI (`cancel-in-progress: false`) серіалізує push-и й не
  перериває зовнішній Job. Ручний конфлікт (CI + Job вручну) усе ще можливий.

**Безпечні (additive) зміни** — завжди сумісні з поточними подами під час rolling update:
нова таблиця, нова колонка з `DEFAULT` або nullable, новий індекс `CONCURRENTLY`.

**Небезпечні зміни** (можуть зламати старі поди під час оновлення):
`DROP COLUMN`, `ALTER COLUMN … NOT NULL` без дефолту, перейменування — вимагають
**expand-contract** (два окремих деплої):
1. Деплой 1 — additive: додати нову колонку/таблицю, app читає обидві.
2. Деплой 2 — cleanup: видалити стару колонку/таблицю, app читає лише нову.

CI (крок `verify`) запускає `@flvmnt/pgfence analyze --max-risk medium` проти усіх
`migration.sql` — якщо знаходить небезпечний SQL, pipeline падає **до** збірки образу.
Виправ міграцію або розбий на два деплої до мержу.

---

### Ротація секретів — Stakater Reloader робить rolling restart автоматично

ESO синхронізує секрети щогодини. **Stakater Reloader** (встановлений через `run.sh eso`
або CI) стежить за `devstash-secrets` і автоматично виконує rolling restart web Deployment,
щойно Secret змінюється — анотація `secret.reloader.stakater.com/reload: "devstash-secrets"`
на Deployment активує цю поведінку. Ручна команда `kubectl rollout restart` **більше не потрібна**.

Якщо потрібно застосувати секрет **одразу** (не чекати до 1 год):

```bash
# Без видалення live Secret: додай нову версію, форсуй ESO sync, дочекайся Reloader.
bash infra/run/gcp/run.sh rotate-secret <name-suffix>   # hidden prompt; value not in shell history
kubectl -n devstash rollout status deploy/devstash-web
```

Якщо Reloader не встановлений (кластер піднято без CI і без `run.sh eso`):

```bash
helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m --atomic \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi
# Перевірити: helm list -n reloader
```

### Де взяти пароль до Cloud SQL (для Cloud SQL Studio / psql)

Terraform генерує пароль для `devstash_app` через `random_password.db` і кладе його у Secret Manager як частину `DATABASE_URL`. Найпростіший спосіб — витягнути з уже синхронізованого секрета:

```bash
# Варіант А — з Secret Manager (рекомендований):
gcloud secrets versions access latest \
  --secret=devstash-database-url \
  --project=project-39965ce5-4c4b-495e-8d4
# Виводить: postgres://devstash_app:<PASSWORD>@<host>/<db>?sslmode=require&sslrootcert=...
# Пароль — між devstash_app: та @

# Варіант Б — безпосередньо зі стану Terraform:
cd infra/terraform/envs/dev
tofu state show 'random_password.db' | grep result
```

> У Cloud SQL Studio: Database=`devstash`, User=`devstash_app`, Authentication=Built-in, Password = значення вище.

---

### Pod відхилений — `Forbidden by policy`

Binary Authorization відхилила образ. Кластер налаштовано на
`PROJECT_SINGLETON_POLICY_ENFORCE`, і поточна policy блокує цей образ:

```bash
# Подивись на Events пода — там буде повідомлення від binauthz:
kubectl -n devstash describe pod <pod-name>
# Перевір стан policy:
gcloud container binauthz policy export --project=project-39965ce5-4c4b-495e-8d4
# Подивись на audit log (якщо pod тільки в audit-mode):
gcloud logging read 'resource.type="k8s_cluster" protoPayload.methodName="io.k8s.core.v1.pods.create"' \
  --limit=20 --project=project-39965ce5-4c4b-495e-8d4 --format=json | jq '.[].protoPayload.response.message'
```

Типові причини:
- **`clusterAdmissionRule` не збігається** — Terraform/API вимагають
  `<location>.<cluster-name>` (крапка, напр. `us-central1.devstash-dev-gke`) і для
  регіональних, і для зональних кластерів. Slash-нотація неправильна; тоді
  застосовується `defaultAdmissionRule = ALWAYS_DENY`.
  Якщо `name_prefix` або `region` у Terraform змінились — треба `tofu apply`, щоб оновити rule.
- **Перший deploy після вмикання enforcement** — тимчасово перевір policy у GCP Console
  (Binary Authorization → Policy) і переконайся, що `clusterAdmissionRule` є і вказує
  `ALWAYS_ALLOW` (поточний режим) або що attestor прив'язаний (якщо перейшов на повний enforcement).

---

## 12. Прибирання після `tofu destroy`

Після `tofu destroy` GKE, Cloud SQL і Memorystore видалені.
Uploads GCS bucket не видалиться, доки містить об'єкти (`force_destroy=false`).
Але зовнішні записи, що вказували на GKE, треба прибрати вручну:

**DNS** — прибрати A-запис `gke` у реєстратора (Spaceship → Advanced DNS → видалити рядок `gke → <IP>`).
Apex `devstash.one` і `www` **не чіпай** — вони залишаються на Vercel.

```bash
dig +short gke.devstash.one   # після видалення має повернути пусто або NXDOMAIN
```

**Stripe** — видалити GKE-endpoint:

```bash
stripe webhook_endpoints list   # знайти id (we_…) GKE-endpoint
stripe webhook_endpoints delete we_...
```

**OAuth redirect URIs** — прибрати GKE-URL з налаштувань провайдерів:
- **GitHub** OAuth App → Authorization callback URL: видалити `https://gke.devstash.one/api/auth/callback/github` (або повністю видалити окремий OAuth App, якщо він був для GKE).
- **Google** Cloud Console → Credentials → OAuth client → Authorized redirect URIs: прибрати `https://gke.devstash.one/api/auth/callback/google`.

**State bucket та проєкт** залишаються — `tofu destroy` їх не видаляє навмисно (стан потрібен для recovery або перевипуску). Прибери вручну, якщо більше не потрібні:

```bash
gcloud storage buckets delete gs://project-39965ce5-4c4b-495e-8d4-tfstate-dev   # незворотно
gcloud projects delete project-39965ce5-4c4b-495e-8d4                            # незворотно
```

---

## 13. Ротація секретів (runbook)

Env-змінні читаються один раз при старті пода — тому після будь-якого оновлення значення
в Secret Manager потрібно:

1. **Оновити версію секрета в Secret Manager** (нова версія активується автоматично):

   ```bash
   # Приклад — ротація auth-secret:
   printf %s "$(openssl rand -base64 32)" | \
     gcloud secrets versions add devstash-auth-secret \
       --project=project-39965ce5-4c4b-495e-8d4 --data-file=-
   ```

2. **Дочекайся автоматичного rollout** (Stakater Reloader стежить за `devstash-secrets`
   і запускає rolling restart Deployment, щойно ESO оновив значення — зазвичай ≤1 год
   після зміни в Secret Manager):

   ```bash
   # Перевір, що Reloader спрацював:
   kubectl -n devstash rollout status deploy/devstash-web
   ```

   **Форс-варіант** (не чекати ESO refresh cycle):

   ```bash
   # Форс-sync ESO (ESO перестворить Secret одразу):
   kubectl -n devstash delete secret devstash-secrets
   kubectl -n devstash get externalsecret devstash-secrets   # → SecretSynced
   # Reloader помітить зміну Secret і запустить rollout автоматично (~10 с)
   kubectl -n devstash rollout status deploy/devstash-web
   ```

> Для `database-url` / `redis-url` — вони генеруються Terraform і рідко ротуються вручну.
> Якщо Cloud SQL пароль скомпрометовано: `tofu apply` (змінить `random_password.db` +
> оновить Secret Manager) → крок 2 вище (Reloader підхопить автоматично).
>
> Для ротації Stripe/OAuth/Resend ключів — лише крок 1 (оновити в Secret Manager);
> Reloader зробить rollout без ручного втручання.
