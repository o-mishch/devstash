# Рівень 1 — Docker

> Kubernetes планує запуск **контейнерів**, а не вихідного коду (source code). Тому перш ніж братися
> за будь-яку роботу з K8s, нам потрібен невеликий, безпечний, відтворюваний (reproducible) image
> застосунку Next.js. Цей рівень — фундамент, на якому стоїть усе інше.

> 🎓 **Як учити (швидко).** 📚-блоки = короткий концепт для співбесіди (з джерелом);
> ⚙️-блоки = команда `run.sh`, що інкапсулює крок. Спершу прожени руками, далі —
> одним викликом. Образ цього рівня збирають [`infra/k8s/local-run/run.sh`](../k8s/local-run/run.sh)
> (kind) і CI [`deploy-gke.yml`](../../.github/workflows/deploy-gke.yml) (GKE).

## Що ми будуємо

| Файл | Призначення |
|------|---------|
| `Dockerfile` (корінь репозиторію) | Multi-stage build → мінімальний runtime image |
| `.dockerignore` (корінь репозиторію) | Зменшує build-контекст, не пускає секрети в image |
| `next.config.ts` → `output: 'standalone'` | Змушує Next згенерувати самодостатній серверний бандл |
| `src/app/api/health/route.ts` | Endpoint liveness + readiness для probe |

→ файл: [`Dockerfile`](../../Dockerfile)

## Ключові виписки з офіційних ресурсів

### Docker — багатоетапні збірки (multi-stage builds)
> Джерело: [docs.docker.com/build/building/multi-stage](https://docs.docker.com/build/building/multi-stage/)

> *«Multi-stage builds are useful to anyone who has struggled to optimize Dockerfiles while keeping them easy to read and maintain.»*

Кілька `FROM`-інструкцій у одному Dockerfile — кожна починає нову стадію з чистою файловою системою. Лише остання стадія стає фінальним image. Build-інструменти, dev-залежності і вихідний код ніколи не потрапляють у продакшн.

```dockerfile
# Стадія 1 — збірка (AS <name> дозволяє посилатися на неї далі)
FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

# Стадія 2 — runtime (лише артефакти зі стадії builder)
FROM node:22-alpine AS runner
COPY --from=builder /app/.next/standalone ./
CMD ["node", "server.js"]
```

**Корисні прийоми:**
```bash
# Збудувати лише конкретну стадію (для дебагу або тестів):
docker build --target builder -t devstash:debug .

# Скопіювати файл із зовнішнього image (не тільки з попередньої стадії):
COPY --from=nginx:latest /etc/nginx/nginx.conf /nginx.conf
```

BuildKit автоматично пропускає стадії, від яких не залежить цільова — збірка швидша.

---

### Docker — контейнеризація Node.js застосунку
> Джерело: [docs.docker.com/guides/nodejs/containerize](https://docs.docker.com/guides/nodejs/containerize/)

> *«Packaging an application with its dependencies, configuration, and runtime into a single portable unit called a container image enables consistent behavior across any environment.»*

**Три стратегічні стадії для Node.js:**

| Стадія | Призначення |
|--------|-------------|
| `deps` | встановити всі залежності (npm ci) |
| `builder` | скомпілювати / зробити next build |
| `runner` | лише скомпільований вивід + production node_modules |

```dockerfile
# Кешування шарів: копіюємо лише lock-файл спочатку,
# щоб npm ci не перезапускався при зміні вихідного коду
COPY package.json package-lock.json ./
RUN npm ci           # детерміновано; не npm install
COPY . .             # вихідний код — окремий шар після deps

# Запуск від non-root: обов'язково для PodSecurity "restricted" у K8s
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs
USER nextjs
```

**`.dockerignore` — виключити перед відправкою контексту:**
```
node_modules
.next
.git
.env*
!.env.example
```
Без `.dockerignore` локальний `node_modules` і файли `.env` можуть потрапити в image.

---

### Docker — HEALTHCHECK
> Джерело: [docs.docker.com/reference/dockerfile/#healthcheck](https://docs.docker.com/reference/dockerfile/#healthcheck)

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health') \
    .then(r => process.exit(r.ok ? 0 : 1)) \
    .catch(() => process.exit(1))"
```

`--start-period` — час до початку відліку невдалих спроб (для повільного запуску Next.js).  
У Kubernetes цей HEALTHCHECK ігнорується на користь `startupProbe` / `livenessProbe` / `readinessProbe` — вони гнучкіші.

---

### Next.js — standalone output
> Джерело: [nextjs.org/docs/app/api-reference/config/next-config-js/output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

```ts
// next.config.ts
const nextConfig = {
  output: 'standalone',
  // next build відстежить, які файли реально потрібні в runtime,
  // і запише мінімальне дерево в .next/standalone/
}
```

**Підступний момент:** standalone **не** включає `.next/static` і `public/` — копіювати явно:
```dockerfile
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static   # ← без цього 404 на CSS/JS
COPY --from=builder /app/public ./public
```
Результат: image ~200 МБ замість >1 ГБ (без standalone).

## Покроковий розбір

### 1. `output: 'standalone'` (next.config.ts)

Зазвичай runtime Next потребує весь репозиторій + увесь `node_modules`. За
`output: 'standalone'` `next build` відстежує, які саме файли досяжні в runtime,
і записує мінімальне дерево в `.next/standalone`, що містить точку входу (entrypoint) `server.js`
і лише ті node_modules, які реально використовуються. Результат: image розміром у
**сотні МБ замість >1 ГБ**. Vercel ігнорує це налаштування, тому шлях бойового
деплою (production) не зачіпається.

> Підступний момент: standalone **не** включає `.next/static` чи `public/` — Dockerfile
> копіює їх явно. Якщо про це забути, отримаєш класичний баг «404 на CSS/JS
> у контейнері».

### 2. Три стадії

Dockerfile — **multi-stage**: кожен `FROM` починає нову стадію; лише
остання стає image, який ми відвантажуємо. Попередні стадії — це build-обв'язка, що
ніколи не потрапляє в продакшн.

- **`deps`** — копіює лише `package*.json` + `prisma/` і запускає `npm ci`. Оскільки
  вхідні дані цього layer змінюються рідко, Docker перевикористовує (reuses) закешований layer між
  build-ами: редагування React-компонента **не** перевстановлює залежності (dependencies). Prisma's
  `postinstall` → `prisma generate` потребує схеми (schema), тому `prisma/` копіюється
  саме тут.
- **`builder`** — підтягує `node_modules` з `deps`, копіює повний вихідний код
  і запускає `npm run build`. `SKIP_ENV_VALIDATION=true` дозволяє build-у пройти
  успішно без справжніх секретів Stripe/Redis (інакше `next.config.ts` застосунку
  валідує env білінгу).
- **`runner`** — фінальний image. Копіює лише `.next/standalone`, `.next/static`
  і `public/` з builder. Жодного вихідного коду, dev-залежностей чи build-інструментів.

### 3. Рішення з посилення захисту, hardening (золото для співбесід)

- **Non-root user.** Ми створюємо користувача `nextjs:nodejs` (uid/gid 1001) і `USER
  nextjs`. PodSecurity «restricted» у Kubernetes відхиляє root-контейнери; запуск від
  non-root обмежує радіус ураження (blast radius), якщо процес скомпрометовано.
- **Alpine + `libc6-compat`.** Alpine крихітний, але використовує musl libc; query engine
  Prisma очікує деякі символи glibc, тому ми додаємо compat-прошарок (compat shim).
- **`HOSTNAME=0.0.0.0`.** Standalone-сервер Next за замовчуванням прив'язується до
  `127.0.0.1`, що недосяжно ззовні контейнера. Прив'язка до `0.0.0.0` потрібна,
  щоб Service/probe могли до нього достукатися.
- **`HEALTHCHECK`.** Health на рівні image для `docker run`/Compose. У K8s його
  заміняють власні probe pod-а liveness/readiness (Рівень 2).

### 4. `.dockerignore`

Виключає `node_modules`, `.next`, `.git`, **усі `.env*` крім `.env.example`**,
тести та цей трек `docs/`+`infra/`. Дві причини: менший контекст швидше
вивантажується на daemon і — що критично — локальні файли `.env` ніколи не запікаються в
layer image, де вони могли б витекти.

### 5. Health-маршрут

`GET /api/health` → миттєво `{ status: 'ok' }` (liveness — «чи живий
процес?»). `GET /api/health?deep=1` перевіряє залежності (readiness — «чи може
цей pod обслуговувати трафік?»):

- **Postgres — критична залежність (critical dependency):** `SELECT 1`; якщо БД
  недосяжна → `503`, і pod прибирають з ротації.
- **Redis — некритична (optional):** `PING`; статус повідомляється
  (`redis: ok | down | disabled`), але збій Redis **сам по собі ніколи не
  провалює readiness** — застосунок коректно деградує (graceful degradation).

Тобто здоровий стан = `{"status":"ok","db":"ok","redis":"ok"}` (200). Обидві
перевірки йдуть паралельно через `Promise.allSettled`, але readiness гейтить
лише результат БД. Це **public**-маршрут: probe не мають сесії й ніколи не
повинні бути за auth-захистом чи rate-limit.

## Перевірка локально

```bash
# Build the image (uses BuildKit caching).
docker build -t devstash:local .

# Run it. Real env isn't needed just to see it boot + serve the health route;
# pass --env-file .env for a fully working app.
docker run --rm -p 3000:3000 \
  -e SKIP_ENV_VALIDATION=true \
  devstash:local

# In another terminal:
curl -s localhost:3000/api/health            # {"status":"ok"}
docker images devstash:local                 # check the final image size

# Inspect the layers / why something is large:
docker history devstash:local
```

> Docker не встановлено? `brew install --cask docker` (Desktop) або `colima start`
> (легковажний варіант). Сам Dockerfile — це навчальний артефакт: читати його важливіше,
> ніж запускати.

> ⚙️ **Автоматизація.** Ручний `docker build` вище — щоб зрозуміти стадії. У реальному
> циклі обидва образи (web + migrator) збирає й вантажить у кластер один крок:
> ```bash
> bash infra/k8s/local-run/run.sh up   # build devstash:local + devstash-migrate:local → kind load
> ```
> На GKE те саме робить CI: `docker build` обох таргетів → push в Artifact Registry →
> deploy за digest (Рівень 4, [04-cicd.md](04-cicd.md)).

## Реальні баги, які виявив цей build (і їх виправлення)

Контейнеризація застосунку, що розраховував на середовище, багате на секрети, виявила три проблеми
— саме той тип речей, які спливають під час реплатформінгу. Усі вже виправлені:

1. **`export const dynamic = 'force-dynamic'` несумісний з `cacheComponents`**
   (налаштування Next 16 у цьому проєкті). Build падав на health-маршруті. Виправлення:
   прибрано — маршрут читає `request.nextUrl.searchParams`, тож Next позначає його
   динамічним автоматично.
2. **`/settings` обчислював Stripe під час build-у** і кидав помилку без
   `STRIPE_SECRET_KEY`. Виправлення: `await connection()` з `next/server` на початку
   сторінки — сумісний з Next 16 і `cacheComponents` спосіб примусити рендеринг під час
   запиту (сучасна заміна `export const dynamic`). Джерело: документація Next.js
   через Context7.
3. **Жадібне інстанціювання (eager instantiation) SaaS-клієнта.** `src/lib/infra/resend.ts` виконував
   `new Resend(process.env.RESEND_API_KEY)` під час **імпорту модуля**, що кидає помилку, коли
   ключ порожній — ламаючи build для кожної сторінки, яка транзитивно його імпортує
   (`/dashboard`, `/collections`, …). Виправлення: ліниве інстанціювання (lazy instantiation) (створення під час
   першого використання), за зразком наявного лінивого Stripe-адаптера. Це кращий
   патерн незалежно від Docker.

**Урок:** serverless-застосунок часто розраховує, що секрети існують під час build-у. Контейнери
будуються без них, тому build-time код не повинен *використовувати* секрети — відкладай до runtime
(`connection()`) і інстанціюй клієнтів ліниво.

## Тези для співбесіди

- **«Навіщо multi-stage?»** Build-інструменти й dev-залежності ніколи не відвантажуються; runtime
  image малий і має меншу поверхню атаки (attack surface). Кешування build-у пришвидшує ітерації.
- **«Як тримати images малими?»** Standalone output + multi-stage + Alpine +
  `.dockerignore`. Можна піти ще далі з distroless.
- **«Як убезпечити image контейнера?»** Non-root user, без секретів у layer-ах
  (`.dockerignore` + build args/runtime env, ніколи `COPY .env`), мінімальна база,
  закріплені digest базового image, сканування Trivy/Grype в CI.
- **«Конфіг build-time проти runtime?»** `NEXT_PUBLIC_*` вбудовується під час build-у; серверні
  секрети інжектяться в runtime (K8s Secret/ConfigMap), ніколи не запікаються.
- **«Liveness проти readiness?»** Liveness = перезапуск, якщо мертвий; readiness = прибрати з
  балансувальника (load balancer), доки залежності (БД) недосяжні. Різні режими відмов.

## Чекліст

- [x] standalone output у `next.config.ts`
- [x] маршрут `/api/health` liveness + readiness
- [x] `Dockerfile` (multi-stage, non-root, standalone)
- [x] `.dockerignore`
- [ ] (опційно) зібрано + запущено локально через Docker
