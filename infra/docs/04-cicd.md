# Рівень 4 — CI/CD

> Pipeline (пайплайн), що перетворює `git push` на запущений deployment (розгортання): gate (ворота якості) на тестах,
> build образу, push до Artifact Registry і rollout (викочування) у GKE — безпечно
> та автоматично.

> 🎓 **Навчальний трек.** Концепти для співбесіди — у блоках 📚 «Ключові виписки з
> офіційних ресурсів» і «Тези для співбесіди» нижче. Блок ⚙️ **Автоматизація**
> вказує, яка команда `run.sh` запускає й перевіряє pipeline. Передумови WIF
> (pool/provider, gh-секрети) розписані в [08-gcp-bootstrap.md](08-gcp-bootstrap.md)
> §5 (як працює keyless-auth) та §7 (як залити секрети в GitHub).

## Що ми будуємо

| Файл | Призначення |
|------|---------|
| `.github/workflows/deploy-gke.yml` | Pipeline на GitHub Actions (єдиний підтримуваний) |

GitHub Actions — **єдиний реалізований і підтримуваний** pipeline. Cloud Build
розглядаємо нижче **концептуально** (GCP-нативна альтернатива) як тему для
співбесіди — окремого файлу `cloudbuild.yaml` свідомо не тримаємо, щоб не було
другого, дублюючого й легко застаріваючого джерела істини.

## Форма pipeline (обидві реалізації)

```
push to main
   └─ verify     : npm ci → lint → test:run                (GATE — fail here, ship nothing)
   └─ build      : docker build, tag :<sha> + :latest
   └─ attest     : optional GitHub/Sigstore provenance (plan-dependent; not BinAuthz)
   └─ push       : push web + migrate images to Artifact Registry
   └─ migrate    : apply Job; poll Complete + Failed conditions (GATE)
   └─ deploy     : server-side apply digest-pinned Deployment
   └─ rollout    : kubectl rollout status --timeout=300s    (GATE — fix forward on failure)
```

Три **gate** роблять процес безпечним:
- тести мають пройти до того, як щось будується;
- міграція має завершитись до того, як нові pods отримають трафік;
- rollout має стати healthy за 300 с. Автовідкату немає: після успішної міграції
  старий image може бути несумісним із новою схемою, тому pipeline вимагає fix-forward.

→ файл: [`.github/workflows/deploy-gke.yml`](../../.github/workflows/deploy-gke.yml)

## Ключові виписки з офіційних ресурсів

### GitHub Actions — Workload Identity Federation з GCP (keyless auth)
> Джерело: [docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-google-cloud-platform](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-google-cloud-platform)

> *«OIDC allows your GitHub Actions workflows to access resources in Google Cloud Platform without needing to store the GCP credentials as long-lived GitHub secrets.»*

**Чому WIF замість JSON-ключа:**
- JSON-ключі довгоживучі (роками), потребують ручної ротації, можуть витекти
- WIF-токени живуть хвилини, видаються динамічно, прив'язані до конкретного репозиторію

**Налаштування на стороні GCP (робиться одноразово через Terraform):**
1. Створити Workload Identity Pool
2. Додати GitHub як OIDC-провайдера з Issuer URL: `https://token.actions.githubusercontent.com`
3. Налаштувати умови (claims): `repository == "org/repo"` — щоб тільки цей репозиторій міг отримати токен
4. Прив'язати pool до service account через `roles/iam.workloadIdentityUser`

**Workflow (сторона GitHub Actions):**
```yaml
permissions:
  contents: read
  id-token: write   # ОБОВ'ЯЗКОВО: дозволяє job запросити OIDC-токен від GitHub
                    # НЕ дає прав на зміну ресурсів — тільки отримати токен

jobs:
  deploy:
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.DEPLOYER_SA }}
          # GitHub OIDC-токен → короткоживучі GCP credentials
          # Жодного JSON-ключа у secrets
```

> *«`id-token: write` allows the workflow to request (fetch) and use (set) an OIDC token for authentication — it does NOT grant resource modification rights.»*

---

### GitHub Actions — структура CI/CD workflow
> Джерело: [docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch: {}   # кнопка ручного запуску в GitHub UI

# Deploy-и серіалізовані, але активний deploy не скасовується: зовнішній migration
# Job продовжує працювати навіть після cancellation GitHub runner-а.
concurrency:
  group: deploy-gke-${{ github.ref }}
  cancel-in-progress: false

jobs:
  # GATE 1: якщо тести не пройшли — нічого не збирається і не деплоїться
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm          # кешує node_modules між runs
      - run: npm ci
      - run: npm run lint
      - run: npm run test:run

  build-deploy:
    needs: verify             # запускається ТІЛЬКИ якщо verify ✅

    steps:
      # Keyless auth (WIF)
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.DEPLOYER_SA }}

      # Налаштувати Docker на Artifact Registry
      - run: gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

      # SHA/latest публікуються для навігації; deploy використовує registry digest.
      - run: |
          docker build \
            -t "${REGISTRY}/${IMAGE}:${GITHUB_SHA}" \
            -t "${REGISTRY}/${IMAGE}:latest" .
          docker push "${REGISTRY}/${IMAGE}:${GITHUB_SHA}"
          docker push "${REGISTRY}/${IMAGE}:latest"

      # Отримати kubeconfig для GKE
      - uses: google-github-actions/get-gke-credentials@v2
        with:
          cluster_name: ${{ env.CLUSTER }}
          location: ${{ env.REGION }}

      # Реальний workflow рендерить digest у Kustomize, запускає migration Job,
      # а Deployment застосовує тільки після успішної міграції.
      - run: |
          kubectl kustomize infra/k8s/overlays/gcp > /tmp/rendered.yaml
          # Див. deploy-gke.yml: split apply → migration gate → Deployment apply.

      # GATE 2: впасти якщо pod-и не стали healthy
      - run: kubectl -n devstash rollout status deployment/devstash-web --timeout=300s
```

**Деплой registry digest, а не `latest` чи лише SHA-тег.** Digest є content-addressed
і не може бути перепризначений повторним запуском workflow.

---

### Cloud Build — GCP-нативна альтернатива (концептуально)
> Джерело: [cloud.google.com/build/docs/configuring-builds/create-basic-configuration](https://cloud.google.com/build/docs/configuring-builds/create-basic-configuration)

> ⚠️ Це **ілюстративний ескіз**, а не підтримуваний файл у репозиторії. Реальний
> pipeline — лише `deploy-gke.yml` (повний gate migrate→rollout, ESO, ін'єкція
> `settings.yaml`). Якщо колись знадобиться Cloud Build, його треба довести до тієї
> ж поведінки, а не копіювати спрощений ескіз нижче.

```yaml
# Ескіз: послідовні кроки в GCP (НЕ повний еквівалент deploy-gke.yml)
steps:
  - name: node:22-alpine
    entrypoint: sh
    args: ['-c', 'npm ci && npm run lint && npm run test:run']

  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -t
      - ${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/web:$SHORT_SHA
      - .

  - name: gcr.io/cloud-builders/kubectl
    args: [apply, -k, infra/k8s/overlays/gcp]
    env:
      - CLOUDSDK_COMPUTE_REGION=${_REGION}
      - CLOUDSDK_CONTAINER_CLUSTER=${_CLUSTER}

substitutions:
  _REGION: us-central1   # збігатися з region у terraform.tfvars (Artifact Registry, GCS free tier)
  _CLUSTER: devstash-dev-gke
  _REPO: devstash
```

Cloud Build виконується **всередині GCP** і автентифікується як власний service account Cloud Build — не потрібен зовнішній OIDC-handshake (це вже GCP-ідентичність).

## Розбір GitHub Actions (`deploy-gke.yml`)

- **`on: push: branches: [main]`** + `workflow_dispatch` — deploy при merge (злиття) у main,
  плюс кнопка ручного trigger (тригер).
- **`concurrency` + `cancel-in-progress: false`** — deploy-и серіалізовані, але
  активний migration Job не переривається cancellation-ом runner-а.
- **`permissions: id-token: write`** — ключовий рядок. Він дозволяє job запросити
  **OIDC token** від GitHub, який є основою keyless auth — автентифікації без ключів (див. нижче).
- **job `verify`** — `npm ci && npm run lint && npm run test:run`. Job `build-deploy`
  має `needs: verify`, тож він запускається лише за зеленого gate.
- **job `build-deploy`**:
  - **`google-github-actions/auth@v2`** з `workload_identity_provider` +
    `service_account` — **Workload Identity Federation**: OIDC token від GitHub
    обмінюється на короткоживучі облікові дані GCP. **Жодний JSON-ключ
    service account ніколи не зберігається в GitHub.** Це сучасний, рекомендований
    патерн; зберігання довгоживучого ключа SA у секреті — антипатерн, якого слід
    уникати.
  - Build публікує `$GITHUB_SHA` і `latest`, але rollout pin-иться на registry
    **digest**, отриманий від BuildKit.
  - `get-gke-credentials` → render once → apply infra → migration gate →
    server-side apply Deployment → `rollout status --timeout=300s`.

## Розбір Cloud Build (концептуально)

Ті самі кроки, нативно для GCP. Відмінності, які варто назвати:
- Виконується **всередині GCP** і автентифікується як **service account Cloud Build** —
  не потрібен зовнішній OIDC-handshake (це вже GCP-ідентичність).
- Використовує `$PROJECT_ID`, `$SHORT_SHA` і `substitutions` для конфігурації.
- Запускається **тригером (trigger) Cloud Build**, прив'язаним до репозиторію, а не файлом
  workflow, який виконує хост репозиторію.

## GitHub Actions проти Cloud Build (співбесіда)

| | GitHub Actions | Cloud Build |
|---|---|---|
| Виконується на | runner'ах від GitHub | GCP |
| Auth до GCP | Workload Identity Federation (OIDC, keyless) | нативний service account CB |
| Найкраще, коли | репозиторій на GitHub, multi-cloud, багатий marketplace | усе на GCP, потрібна тісна інтеграція IAM/VPC |
| Конфігурація | `.github/workflows/*.yml` | `cloudbuild.yaml` + тригер |

Обидва варіанти валідні; вибирайте за тим, де живе організація. Історія про
keyless auth — це та частина, яку найбільше хочуть почути.

## Міграції (migrations) бази даних у CI (реалізовано)

Міграції Prisma (`npm run db:deploy` → `prisma migrate deploy`) виконуються
**до того**, як новий образ почне обслуговувати трафік — як короткоживучий
**Kubernetes Job**, gated перед rollout. Реалізація:

- **Окремий образ `migrate`** — Dockerfile-стадія `--target migrator` (standalone
  runtime-образ не має ні Prisma CLI, ні `tsx`, ні `prisma/`, тож мігрувати ним
  неможливо). Тримає повний toolchain + `prisma.config.ts` (звідки береться
  `DIRECT_URL`) + `prisma/seed.ts`.
- **Job** — [`overlays/gcp/migrate-job.yaml`](../k8s/overlays/gcp/migrate-job.yaml).
  Свідомо **не** в `kustomization.yaml resources`: pod-template Job-а immutable,
  тож повторний `apply -k` на наявний Job впав би. CI робить delete-then-apply із
  digest-pinned образом і **чекає завершення** як gate.
- **Порядок у [`deploy-gke.yml`](../../.github/workflows/deploy-gke.yml):**
  `apply -k` (довгоживучі ресурси) → чекати ESO (`externalsecret` Ready, бо Job
  читає `DATABASE_URL`/`DIRECT_URL` із того ж `devstash-secrets`) → **migrate Job**
  (`migrate deploy` + seed) → server-side apply digest-pinned web → `rollout status`.
- **Seed системних `item_types`** — той самий Job після міграцій запускає
  `SEED_ITEM_TYPES_ONLY=1 DB_LOCAL=1 tsx prisma/seed.ts` (idempotent): без 7
  системних типів застосунок не може створювати items. Той самий патерн, що
  [`local-run/run.sh`](../k8s/local-run/run.sh).

Expand-and-contract (зворотно сумісні міграції) дозволяє старим і новим pod'ам
співіснувати під час rollout.

## Валідація локально (зроблено)

Файл pipeline пройшов YAML-валідацію:

```bash
npx --no-install js-yaml .github/workflows/deploy-gke.yml   # OK
```

Щоб зробити dry-run GitHub workflow локально, можна скористатися [`act`](https://github.com/nektos/act)
(`brew install act`), хоча кроки auth/deploy до GCP потребують справжніх облікових
даних, тож їх краще лишити для реального запуску.

> ⚙️ **Автоматизація.** Pipeline тригериться `git push` у `main`, але його можна
> запустити й перевірити з CLI через [`infra/gcp-run/run.sh`](../gcp-run/run.sh):
> ```bash
> bash infra/gcp-run/run.sh secrets   # залити WIF provider + deployer SA + APP_DOMAIN у GitHub (передумова auth@v2)
> bash infra/gcp-run/run.sh deploy    # gh workflow run deploy-gke.yml (build web+migrate → migrate Job → rollout)
> bash infra/gcp-run/run.sh smoke     # дочекатись CI (gh run watch) + health-check /api/health?deep=1
> ```
> `secrets` має відпрацювати раз після `apply` — інакше `google-github-actions/auth@v2`
> у workflow не матиме WIF-провайдера. Як саме створюється pool/provider і чому
> числовий `repository_owner_id` — у [08-gcp-bootstrap.md](08-gcp-bootstrap.md) §5.

## Тези для співбесіди

- **«Як ви автентифікуєте CI у хмарі без секретів?»** Workload Identity
  Federation — OIDC token обмінюється на короткоживучі облікові дані; жодного
  статичного ключа SA.
- **«Як ви адресуєте образи?»** SHA/latest лишаються навігаційними тегами, а deploy
  використовує immutable registry digest.
- **«Як зробити deploy безпечним?»** Gate на тестах перед build; gate на
  rollout-status після; `concurrency` для запобігання гонкам; rolling update +
  readiness + PDB (Рівень 2); після міграції — fix-forward, не blind rollback.
- **«Куди йдуть міграції?»** Gated Job на етапі pre-deploy, що запускає `prisma migrate
  deploy`, із зворотно сумісними (expand/contract) міграціями.
- **«Actions проти Cloud Build?»** Дивіться таблицю — усе залежить від того, де
  живуть інструментарій та ідентичність організації.

## Чеклист

- [x] GitHub Actions: gate verify → build → push → gate migrate Job → deploy → gate rollout
- [x] Міграції БД + seed системних `item_types` як gated pre-deploy Job
- [x] Keyless auth через Workload Identity Federation
- [x] Теги образів, прив'язані до SHA
- [x] Cloud Build — концептуальне порівняння (без окремого дублюючого файлу)
- [x] Обидва YAML-файли провалідовані
- [ ] (опційно) запуск проти реального GCP-проєкту + GitHub-репозиторію
