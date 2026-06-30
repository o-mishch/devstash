# Рівень 7 — Повний локальний запуск (full local run) на kind

> Доказ, що застосунок реально працює на справжньому Kubernetes — **повністю
> локально, без хмари (cloud), без витрат** — з in-cluster Postgres, застосованими
> міграціями (migrations) і зеленим deep health check. Це
> [02-kubernetes.md](02-kubernetes.md) на практиці (загальний план —
> [00-master-plan.md](00-master-plan.md)).

> 🎓 **Як учити (швидко).** Це практичний runbook: усе нижче інкапсульовано в
> [`infra/k8s/local-run/run.sh`](../k8s/local-run/run.sh) (див. TL;DR). 📚-концепти
> Kubernetes — у [02-kubernetes.md](02-kubernetes.md); тут — реальний запуск наживо.

## Підсумок (TL;DR)

```bash
bash infra/k8s/local-run/run.sh          # підняти все (= up)
curl 'http://localhost:8080/api/health?deep=1'   # → {db,redis,s3,email all "ok"}
bash infra/k8s/local-run/run.sh deploy   # перезібрати образ і викотити лише застосунок
bash infra/k8s/local-run/run.sh status   # стан кластера / подів / health
bash infra/k8s/local-run/run.sh info     # вивести всі URL сервісів (застосунок, Postgres, MinIO тощо)
bash infra/k8s/local-run/run.sh down     # знести кластер
```

Застосунок піднімається з тих самих базових маніфестів, що й GCP
(`infra/k8s/base` через `infra/k8s/local-run/kustomization.yaml`) — тобто локально
реально виконуються `securityContext` (non-root 1001), requests/limits, startup/
liveness/readiness-проби, `preStop`-drain і PDB. Локальні відмінності — лише патчі:
MinIO-shim sidecar, NodePort-Service і одна репліка.

## Точки доступу (connection details)

З контейнера kind на хост проброшено **сім портів** (через `extraPortMappings`):
`8080` → застосунок, `8090` → Headlamp, `55432` → Postgres, `8025` → Mailpit UI,
`9000` → MinIO S3 API, `9001` → MinIO console, `8978` → pgAdmin, `8001` → RedisInsight.
Порт `9000` (S3 API) **обов'язково** на хості: браузер вантажить/завантажує файли
напряму в MinIO за presigned-URL, тож ендпоінт має бути доступний з браузера.
`127.0.0.1:5xxxx->6443` — це Kubernetes API (для `kubectl`, не для застосунку).
Решта сервісів живе **всередині кластера** і відкривається за потреби через
`kubectl port-forward`.

### Доступно одразу (без налаштувань)

| Сервіс                       | URL / під'єднання                                              | Креди (credentials)                 |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| Застосунок (DevStash)        | http://localhost:8080                                          | —                                   |
| Deep health                  | http://localhost:8080/api/health?deep=1                        | —                                   |
| Cluster UI (Headlamp)        | http://localhost:8090                                          | bearer-токен (див. нижче)           |
| Mailpit UI (надіслані листи) | http://localhost:8025                                          | —                                   |
| MinIO S3 API (uploads)       | http://localhost:9000                                          | `minioadmin` / `minioadmin`         |
| MinIO console (S3)           | http://localhost:9001                                          | `minioadmin` / `minioadmin`         |
| pgAdmin (Postgres web UI)    | http://localhost:8978                                          | `admin@devstash.dev` / `admin12345` |
| RedisInsight (Redis web UI)  | http://localhost:8001                                          | —                                   |
| Postgres (пряме під'єднання) | `psql postgresql://devstash:devstash@localhost:55432/devstash` | `devstash` / `devstash`             |

**Усі веб-UI кластера** проброшені на хост через NodePort + `extraPortMappings`
(той самий патерн, що й застосунок) — жоден **не** потребує `port-forward`:
застосунок `:8080`, Headlamp `:8090`, Mailpit `:8025`, MinIO console `:9001`,
pgAdmin `:8978`, RedisInsight `:8001`. Postgres (raw TCP) — на `:55432`.

**Покриття веб-UI по залежностях:** Postgres → pgAdmin, S3 → MinIO console,
email (Resend) → Mailpit, Redis → RedisInsight, увесь кластер → Headlamp. Тобто
**кожна залежність має браузерний UI**.

> **Веб-UI для Postgres (pgAdmin):** на `localhost:8978` (логін
> `admin@devstash.dev`/`admin12345`). Сервер **DevStash Postgres (local)** вже
> **попередньо налаштований (pre-configured)** і **під'єднується з нуля кліків** —
> після логіну розкрий групу `DevStash`, дерево БД відкривається одразу, без майстра
> й без запиту пароля. Як це працює (дві умови разом):
>
> 1. **`servers.json`** (із ConfigMap `pgadmin-config`, env `PGADMIN_SERVER_JSON_FILE`)
>    імпортує з'єднання при першому старті.
> 2. Postgres у кластері використовує **trust-аутентифікацію**
>    (`POSTGRES_HOST_AUTH_METHOD=trust` у `01-postgres.yaml`) — пароль не потрібен. А
>    `PassFile` (pgpass, host `*`, бо pgAdmin передає в libpq резолвлений ClusterIP)
>    прибирає діалог «введіть пароль», який інакше зʼявляється перед під'єднанням.
>
> **Чому не CloudBeaver:** CloudBeaver CE не вміє віддавати збережений пароль із
> простого конфіг-файлу (шифрує в `credentials-config.json`, не редагується вручну —
> підтверджено upstream-issue #3731). pgAdmin + trust дають справжній zero-click.
> (Десктопні клієнти — `psql`/TablePlus/DBeaver — як і раніше через `:55432`; пароль
> не потрібен через trust.)

> **Чому NodePort, а не Ingress?** Ingress обслуговує лише HTTP/HTTPS, а Postgres —
> це raw TCP (Ingress його не пропустить). Тож для повного покриття все одно потрібен
> NodePort. Додавати Ingress-контролер поверх означало б **дві** системи експозиції
> заради тієї ж задачі — NodePort простіший і покриває все (рекомендація Kubernetes
> docs через Context7: для не-HTTP сервісів — саме NodePort/LoadBalancer).

### Через `kubectl port-forward` (лише raw-протоколи, без веб-UI)

| Сервіс | Команда | Відкрити / під'єднатися | Креди |
|--------|---------|-------------------------|-------|
| Redis (raw) | `kubectl -n devstash port-forward svc/redis 6379:6379` | `redis-cli -p 6379` | — |
| Mailpit SMTP | `kubectl -n devstash port-forward svc/mailpit 1025:1025` | SMTP localhost:1025 | — |

### Внутрішній DNS кластера (як поди спілкуються) — НЕ з хоста

Саме ці значення використовує Secret застосунку `devstash-secrets` (так само
названий, як у базі та GCP-оверлеї — локальний запуск тепер збирається з
`infra/k8s/base` через `infra/k8s/local-run/kustomization.yaml`):

| Змінна в Secret | Значення |
|-----------------|----------|
| `DATABASE_URL` | `postgresql://devstash:devstash@postgres:5432/devstash?sslmode=disable` |
| `REDIS_URL` | `redis://redis:6379` (нативний ioredis, як у GCP) |
| `AWS_ENDPOINT_URL_S3` | `http://localhost:9000` (не `minio:9000` — див. «Завантаження файлів» нижче) |
| `SMTP_HOST` / `SMTP_PORT` | `mailpit` / `1025` |

## Керування кластером (cluster management UI)

Веб-UI для перегляду й керування **всім кластером** піднято **в самому кластері** —
як ще один сервіс, рівно як застосунок. Використано **Headlamp** (офіційний проєкт
Kubernetes SIG): **один образ (image)** `ghcr.io/headlamp-k8s/headlamp`, звичайний
маніфест, без Helm. (Офіційний Kubernetes Dashboard v3 — це стек із 4 контейнерів
за Kong-проксі та лише Helm-інсталяція, тож його незручно прокидати NodePort'ом.)

```bash
# Уже піднято run.sh. Відкрий:
open http://localhost:8090
# Логін — bearer-токен сервіс-акаунта (service-account token):
kubectl create token headlamp-admin -n headlamp
```

- **Експозиція (expose):** Service типу **NodePort** `30090`, мапнутий kind-конфігом
  на `localhost:8090` — без `port-forward`.
- **Доступ до всього кластера:** сервіс-акаунт `headlamp-admin` прив'язаний до
  ролі `cluster-admin` через `ClusterRoleBinding`, контейнер стартує з `-in-cluster`.
  Тож UI бачить і керує **всіма namespace** (поди, деплойменти, секрети, логи, exec).
- **Безпека (security):** `cluster-admin` + токен-логін прийнятні **лише** для
  одноразового локального kind-кластера — **ніколи в проді**. Маніфест ізольований у
  namespace `headlamp` і не дотикається до застосунку.

Маніфест — `infra/k8s/local-run/06-headlamp.yaml`.

## Що працює

| Компонент | Статус |
|-----------|--------|
| kind-кластер (cluster) | ✅ справжній Kubernetes у Docker |
| Застосунок у контейнері | ✅ той самий image, що й для прод ([01-docker.md](01-docker.md)) |
| Postgres у кластері | ✅ `postgres:alpine` (latest) — StatefulSet + PVC (локальний аналог managed Cloud SQL у GCP) |
| Міграції Prisma | ✅ застосовані до in-cluster БД |
| Redis у кластері (нативний ioredis) | ✅ `redis-stack` (latest) — той самий ioredis-шлях, що й GCP→Memorystore |
| S3 у кластері (MinIO) | ✅ `minio` + автостворення бакета |
| Завантаження файлів (browser → S3) | ✅ presigned-URL працює з браузера — [деталі](#завантаження-файлів-presigned-url--спільний-ендпоінт) |
| Email у кластері (Mailpit) | ✅ SMTP + веб-UI (`:8025`) замість Resend |
| Білінг (Stripe) | ✅ повний апгрейд офлайн (підписаний фейк-вебхук) або Stripe test mode — [деталі](#білінг-stripe--без-локального-моку) |
| Cluster UI (Headlamp) | ✅ веб-керування всім кластером на `localhost:8090` |
| Deep health (усі 4 залежності) | ✅ `{"status":"ok","db":"ok","redis":"ok","s3":"ok","email":"ok"}` 200 |
| Self-healing, scaling, rolling update | ✅ демонстрований наживо |
| Graceful degradation | ✅ будь-яка з redis/s3/email впала → `"down"`, але probe лишається 200 |

## Слід у коді (footprint) — мінімально інвазивно (least invasive)

Усі чотири залежності працюють локально ціною **3 рядків** у проді (кожен —
огороджений env-прапорцем, no-op у проді):

| Бекенд | Локальна заміна | Слід у застосунку |
|--------|-----------------|-------------------|
| Postgres | in-cluster Postgres (TCP) | 1 рядок — вибір адаптера (`db-local.ts`) |
| Redis | in-cluster Redis (нативний TCP) | 1 огороджена гілка (`redis-tcp.ts`, вмикається `REDIS_URL`) |
| S3 | MinIO | 2 рядки — лише `forcePathStyle` (`s3-local.ts`); ендпоінт читається з `AWS_ENDPOINT_URL_S3` нативно |
| Email | Mailpit (SMTP) | 1 огороджена гілка (`email-local.ts`) |

Кожен дотик **незводимий (irreducible)**: SDK Neon/AWS/Resend не мають env-перемикача
саме для цих опцій (перевірено емпірично). Уся логіка винесена в окремі модулі
`*-local.ts`, що активуються наявністю connection-конфігу: `DB_LOCAL` (один явний
прапорець — `DATABASE_URL` не відрізняє Neon від Cloud SQL), `REDIS_URL`,
`AWS_ENDPOINT_URL_S3`, `SMTP_HOST` (їх задає тільки локальний Secret; на GCP SMTP_HOST
відсутній → Resend). На Vercel їх немає → код no-op, прод незмінний.

## Завантаження файлів (presigned-URL) — спільний ендпоінт

**Проблема.** Завантаження/скачування файлів іде **напряму з браузера в S3** за
presigned-URL (так само, як у проді з AWS S3 — застосунок ці байти не проксі). AWS SDK
**підписує URL проти того хоста, який стоїть в ендпоінті клієнта**. Якщо підписати проти
in-cluster імені `minio:9000`, браузер на хості його не зарезолвить — і завантаження
падає (саме це й було видно: `POST http://minio:9000/devstash-uploads` → fail).

Підмінити хост у вже підписаному URL **не можна**: SigV4 для presigned-GET підписує
заголовок `Host`, тож зміна хоста після підпису ламає підпис (перевірено за докою AWS
SDK v3 через Context7). MinIO теж **не** має env, щоб віддавати presigned-URL з іншим
хостом, ніж той, проти якого підписано (`MINIO_BROWSER_REDIRECT_URL` — лише для консолі).

**Рішення — один спільний ендпоінт `localhost:9000`, валідний з ОБОХ боків:**

1. **Браузер** дістає MinIO на `localhost:9000` — порт S3 API проброшено на хост
   (NodePort `30900` + `extraPortMappings` у `kind-config.yaml`).
2. **Под застосунку** дістає MinIO на `localhost:9000` через **нативний sidecar**
   (`socat`, `initContainer` з `restartPolicy: Always` у `04-app.yaml`), що форвардить
   `:9000` пода → in-cluster `minio:9000`. `localhost` пода — це його **власний**
   loopback, тож sidecar потрібен, щоб серверні S3-виклики йшли на той самий хост.
   Слухає **dual-stack** (`TCP6-LISTEN ... bind=[::]`), бо Node резолвить `localhost`
   спершу в `::1`; IPv4-only `bind=127.0.0.1` дав би `ECONNREFUSED`.
3. **Застосунок** підписує все проти `AWS_ENDPOINT_URL_S3=http://localhost:9000` —
   один хост, ідентичний у поді й у браузері, тож SigV4-підпис (і POST-upload, і
   GET-download/preview) валідний скрізь.

Прод незмінний: `AWS_ENDPOINT_URL_S3` там відсутній → справжній AWS S3, virtual-host
style, без sidecar. Усі три зміни — лише в `infra/k8s/local-run/` + локальному Secret.

### Health check (db + redis + s3 + email)

`/api/health?deep=1` перевіряє всі чотири. **Критичний лише Postgres** → 503 при
падінні. Redis/S3/Email — **некритичні (optional)**: їхній статус повідомляється
(`ok | down | disabled`), але збій жодного не провалює readiness (graceful
degradation). Логіка — у `src/lib/infra/health-checks.ts`; покрита тестами.

## Велика складність: serverless-драйвери

У проді на Vercel застосунок навмисно побудований на драйверах **Neon (WebSocket)**
і **Upstash (REST)** — serverless-орієнтованих, які **не** розмовляють зі звичайним
Postgres/Redis по TCP. Це і є той самий урок реплатформінгу (re-platforming), що в
[03-terraform.md](03-terraform.md). На довгоживучому Kubernetes (локально й на GKE)
кожен з них перемикається на нативний TCP-клієнт — env-перемикачем, без зміни
прод-шляху на Vercel:

### Postgres — стандартний адаптер `@prisma/adapter-pg`

У проді застосунок використовує `@prisma/adapter-neon` (serverless-драйвер Neon).
Спершу ми пробували локально емулювати протокол Neon через проксі
`local-neon-http-proxy` — але виявили **реальне обмеження**: режим fetch
(`poolQueryViaFetch`) **не підтримує інтерактивні транзакції Prisma**
(`$transaction(async tx => …)`), а застосунок на них покладається (реєстрація,
операції з items, AI-флоу). Падало з `P2028`. WebSocket-режим проксі не приймав
handshake драйвера (`non-101`). Жоден режим проксі не давав усього.

**Рішення (з документації Prisma, через Context7): локально перемкнутися на
стандартний адаптер `@prisma/adapter-pg`** — node-postgres по TCP прямо до
in-cluster Postgres. Він тримає справжнє зʼєднання → **інтерактивні транзакції
працюють**. Це ще й **точний шлях продакшн-міграції** Neon→Cloud SQL (та сама
заміна адаптера).

- **Найменш інвазивно:** вибір адаптера винесено в `src/lib/infra/db-local.ts`.
  `prisma.ts` робить `createLocalDbAdapter() ?? new PrismaNeon(...)` — один рядок.
  Локальний адаптер вмикається лише за `DB_LOCAL=1` (його задає тільки локальний
  Secret); у проді → `null` → реальний Neon-адаптер незмінний.
- **Бонус:** цей підхід **прибирає весь neon-proxy** (db-proxy, hostAliases,
  self-signed TLS, `db.localtest.me`). `DATABASE_URL` тепер просто
  `postgres://…@postgres:5432/devstash`. Простіша інфра, повна функціональність.

### Захист продакшну (production safety)

Кожна локальна/нативна заміна винесена в окремий модуль (`db-local.ts`,
`redis-tcp.ts`, `s3-local.ts`, `email-local.ts`) і **вмикається лише за опт-іном**
(`DB_LOCAL` / `REDIS_URL` / `AWS_ENDPOINT_URL_S3` / `SMTP_HOST`). На Vercel/проді цих змінних
немає → код no-op, а `prisma.ts` / `redis.ts` / `s3.ts` / `resend.ts` працюють
vendor-default (Neon + Upstash). Тож прод-шлях на Vercel **незмінний**. Підтверджено:
`npm run lint` + повний набір тестів проходять.

### Redis — нативний ioredis (як у GCP)

На Vercel застосунок говорить з Redis по Upstash REST (`@upstash/redis`) — це
serverless-середовище без сталих зʼєднань. На GKE та локально (довгоживучі поди)
він натомість підключається **нативно по TCP через ioredis** прямо до Redis —
**без SRH-проксі**. Перемикач — змінна `REDIS_URL`:

- `REDIS_URL` задано (GKE→Memorystore, локальний kind) → `getRedis()` повертає
  ioredis-адаптер з тим самим інтерфейсом, що й Upstash-клієнт
  (`src/lib/infra/redis-tcp.ts`), тож усі ~24 місця виклику, кеш і token-сховища
  **не змінюються**. Rate-limiting переходить на sliding-window Lua-скрипт
  (`@upstash/ratelimit` не підтримує ioredis).
- `REDIS_URL` не задано (Vercel) → старий Upstash REST-шлях, **байт-у-байт той самий**.

Локально це `redis://redis:6379` (без TLS); на GCP — `rediss://…@memorystore`
(TLS + AUTH, CA у `REDIS_CA_CERT`).

**Graceful degradation:** навіть якщо Redis впаде, застосунок працює —
команда падає в no-op (rate-limit fail-open/closed, кеш-міс), а deep health
повідомляє `redis:"down"`, **не** провалюючи readiness (Redis — некритична
залежність; критичний лише Postgres).

## Структура файлів

```
infra/k8s/local-run/
├── kind-config.yaml      # кластер + проброс :8080 :8090 :55432 :8025 :9000 :9001
├── 01-postgres.yaml      # Postgres StatefulSet + PVC (NodePort 30432) + pg_trgm init
├── 02-redis.yaml         # Redis (native ioredis) + RedisInsight UI (NodePort 30801)
├── 03-app-secret.yaml    # devstash-secrets — DATABASE_URL/REDIS_URL/S3/email (локальні «секрети»)
├── 05-minio-mailpit.yaml # MinIO (S3, NodePort 30900/30901) + bucket-init Job + Mailpit
├── 06-headlamp.yaml      # Headlamp — cluster management UI (NodePort 30090)
├── 07-pgadmin.yaml       # pgAdmin — Postgres web UI, preconfigured (NodePort 30978)
├── kustomization.yaml    # застосунок = infra/k8s/base + локальні патчі (нижче)
├── patches/
│   ├── app-local.yaml        # MinIO-shim sidecar + 1 репліка (поверх base Deployment)
│   └── service-nodeport.yaml # base Service → NodePort 30080
├── stripe-fake-webhook.ts # офлайн підписаний вебхук → видати Pro без Stripe/мережі
└── run.sh                # up / deploy / status / down
```

> Раніше застосунок описувався окремим `04-app.yaml`; тепер його Deployment/Service
> беруться з `infra/k8s/base` (як у GCP), а локальні відмінності — у `kustomization.yaml`
> + `patches/`. Так base-рівневі прод-налаштування (hardening, проби, ресурси, preStop)
> реально перевіряються локально, а не лише в хмарі.

## Чому міграції йдуть з хоста, а не з Job

Мінімальний runtime-image (standalone) **не містить** Prisma CLI чи теки
`prisma/migrations` — лише серверний бандл. Тому `run.sh` запускає
`prisma migrate deploy` **з хоста** напряму до Postgres на `localhost:55432`
(NodePort 30432; `DIRECT_URL` → звичайний TCP, оминаючи адаптер). Це стандартний
патерн для локальної розробки. У реальному CI/CD міграції ганяє окремий
gated-крок з образом, що містить CLI (див. [04-cicd.md](04-cicd.md)).

## Демо механік Kubernetes (золото для співбесід)

> Глибше про самі примітиви Kubernetes — у [02-kubernetes.md](02-kubernetes.md).

```bash
# Self-healing (самовідновлення): видали pod — K8s його відтворює
kubectl -n devstash delete pod -l app=devstash-web
kubectl -n devstash get pods -w

# Scaling: 3 репліки, кожна незалежно проходить deep health
kubectl -n devstash scale deploy/devstash-web --replicas=3

# Rolling update (плавне оновлення) без простою
kubectl -n devstash set image deploy/devstash-web web=devstash:local
kubectl -n devstash rollout status deploy/devstash-web
kubectl -n devstash rollout undo deploy/devstash-web   # відкат (rollback)
```

## Білінг (Stripe) — без локального моку

Stripe — **єдина залежність, яку ми НЕ self-host'имо**. Офіційний `stripe-mock`
stateless (відповіді з фікстур, нічого не зберігає) і **не шле вебхуки**, тож
апгрейд через нього ніколи б не завершився. Натомість є два локальні шляхи:
**A) повністю офлайн** (за замовчуванням) та **B) справжній Stripe test mode**.

> **Кнопка «Upgrade» в UI не працює офлайн** — вона викликає `/api/billing/checkout`,
> який іде в **реальний Stripe API** з плейсхолдер-ключами і повертає 500. Це by design:
> застосунок ми НЕ чіпаємо. Щоб перевести користувача в Pro локально — **запусти скрипт**
> (шлях A нижче). Для робочої кнопки потрібен справжній Stripe test mode (шлях B).

### A) Повністю офлайн — скрипт `stripe-fake-webhook.ts` (за замовчуванням)

Видає (або забирає) Pro для локального користувача **без Stripe-акаунта й без мережі**,
не змінюючи код застосунку. `/api/webhooks/stripe` довіряє лише заголовку
`stripe-signature` — це HMAC-SHA256 від `payload + STRIPE_WEBHOOK_SECRET`. SDK-хелпер
`stripe.webhooks.generateTestHeaderString()` створює такий підпис **офлайн**, тож обробник
не відрізнить його від реальної доставки Stripe. Скрипт шле підписаний
`customer.subscription.updated` (його обробник читає все з inline-об'єкта — на відміну від
`checkout.session.completed`, який до-фетчить підписку з Stripe API).

**Як перевести користувача в Pro:**

```bash
# 1. Дізнайся userId з Postgres:
kubectl exec -n devstash statefulset/postgres -- \
  psql -U devstash -d devstash -c "SELECT id, email FROM users;"

# 2. Видати Pro:
STRIPE_WEBHOOK_SECRET=whsec_local_test \
  npx tsx infra/k8s/local-run/stripe-fake-webhook.ts <userId> active
```

**Скрипт:** `infra/k8s/local-run/stripe-fake-webhook.ts`

**Аргументи (позиційні):**

| Позиція | Значення | Обов'язк. | За замовч. | Опис |
|---------|----------|-----------|------------|------|
| `$1` | `<userId>` | так | — | id користувача з таблиці `users` |
| `$2` | `active` \| `canceled` \| `past_due` | ні | `active` | статус підписки: `active` → видати Pro; `canceled`/`past_due` → забрати |

**Змінні середовища:**

| Env | Обов'язк. | За замовч. | Опис |
|-----|-----------|------------|------|
| `STRIPE_WEBHOOK_SECRET` | так | — | має збігатися зі значенням у Secret (`whsec_local_test`) — ним підписується вебхук |
| `APP_URL` | ні | `http://localhost:8080` | базовий URL застосунку, куди POST-иться вебхук |

**Приклади:**

```bash
# Видати Pro (status за замовчуванням active):
STRIPE_WEBHOOK_SECRET=whsec_local_test \
  npx tsx infra/k8s/local-run/stripe-fake-webhook.ts cltestuser000000000000000 active

# Забрати Pro (скасувати підписку):
STRIPE_WEBHOOK_SECRET=whsec_local_test \
  npx tsx infra/k8s/local-run/stripe-fake-webhook.ts cltestuser000000000000000 canceled
```

`whsec_local_test` — це дефолтне значення `STRIPE_WEBHOOK_SECRET` у `03-app-secret.yaml`,
тож скрипт працює одразу після `run.sh`, без жодного налаштування Stripe. Успіх → `HTTP
200`. Проходить **справжній** ланцюг: перевірка підпису → ідемпотентність →
`upsertSubscriptionStateFromObject` → Pro у БД (`isPro=t`).

### B) Справжній Stripe test mode — повний цикл checkout + Stripe CLI

Коли треба продемонструвати реальний checkout (тестова картка `4242…`):

1. Stripe Dashboard (**test mode**) → API keys: `sk_test_…`, `pk_test_…`. Створи
   продукт із двома recurring-цінами → обидва `price_…`.
2. Впиши їх у `03-app-secret.yaml` (поля `STRIPE_*`, зараз `…REPLACE_ME`).
3. Пробрось вебхуки CLI (друкує `whsec_…` → встав у `STRIPE_WEBHOOK_SECRET`):

   ```bash
   stripe login                                                   # один раз
   stripe listen --forward-to localhost:8080/api/webhooks/stripe  # лишай запущеним
   ```

4. `kubectl apply -f infra/k8s/local-run/03-app-secret.yaml` +
   `kubectl -n devstash rollout restart deploy/devstash-web`.

Тепер checkout → Stripe шле `checkout.session.completed` у CLI → форвард на
`/api/webhooks/stripe` → Pro. Без CLI checkout відкриється, але Pro не активується.

**Чому не stripe-mock:** stateless + без вебхуків (підтверджено в його ж коді —
`HandleRequest` валідує запит і віддає фікстуру, нічого не зберігаючи). Годиться
лише для перевірки форми запитів у юніт-тестах, не для життєвого циклу підписки.
Юніт-тести й так мокають `@/lib/infra/stripe` напряму і верифікують підпис
вебхука через той самий `generateTestHeaderString` — без мережі.

## Чого НЕ можна запустити локально

Шар **Terraform + GCP** (GKE, Cloud SQL, Memorystore) звертається до реальних
API Google — вірного локального GCP не існує. `tofu validate`/`plan` працюють
офлайн; `tofu apply` потребує справжнього GCP і коштує грошей. Тож «повністю
локально» означає: **повноцінний застосунок на справжньому Kubernetes (kind)**,
а специфічний для хмари провіжинінг лишається валідованим-але-не-застосованим
кодом.

**Чому локально стоїть стоковий Postgres self-hosted у кластері.**
У GKE база — це managed **Cloud SQL for PostgreSQL** ([modules/cloudsql](../terraform/modules/cloudsql/main.tf)),
поза кластером. Локально ж тримаємо гарантію «повністю локально, без хмари, без
витрат», тому ставимо `postgres:alpine` (latest) як pod у kind. Паритет із GCP
тримається на тому, що **справді** має значення для застосунку: обидва — звичайний
PostgreSQL, до якого Prisma ходить тим самим node-postgres адаптером (`DB_LOCAL=1`)
по TCP, ті самі міграції і той самий `pg_trgm`, що його вимагає `prisma/schema.prisma`.

## Тези для співбесіди

- **«Запустив би це локально?»** Так — kind дає справжній Kubernetes; in-cluster
  Postgres + застосовані міграції + зелений deep health. Cloud-провіжинінг
  (Terraform) валідується офлайн, бо вірного локального GCP немає.
- **«З чим зіткнувся при контейнеризації serverless-застосунку?»** Драйвери
  Neon/Upstash не говорять зі звичайним Postgres/Redis; потрібні проксі-мости і
  невелика огороджена конфіг-зміна (`poolQueryViaFetch`). Це і є реальна
  міграційна робота.
- **«Як не зламати прод тимчасовою локальною зміною?»** Огородження за іменем
  хоста + повний набір тестів, що доводить незмінність прод-шляху.

## Чекліст

- [x] kind-кластер + image завантажено
- [x] Postgres (in-cluster, `@prisma/adapter-pg`) у кластері
- [x] Міграції застосовано до in-cluster БД
- [x] Redis (нативний ioredis), S3 (MinIO), email (Mailpit) активні
- [x] Застосунок працює: deep health `{db,redis,s3,email all "ok"}` 200
- [x] Self-healing + scaling продемонстровано
- [x] Cluster UI (Headlamp) на `localhost:8090`
- [x] Огороджена зміна `prisma.ts` (прод незмінний; lint + повний набір тестів)
