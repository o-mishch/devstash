# Рівень 5 — Навчальний посібник і шпаргалки для співбесіди

> Рівень повторення. Уся архітектура на одній картинці, відображення SaaS→GCP та
> бліц-питання-відповіді за кожною темою. Якщо ти можеш пояснити все, що тут є,
> на прикладі *цього репозиторію*, то ти готовий.

> 🎓 **Як учити (швидко).** Це шар повторення — стислі 📚-відповіді для бліц-опитування.
> Реальні команди (runbook) і їх автоматизація `run.sh` — у документах кожного шару
> ([02](02-kubernetes.md)–[04](04-cicd.md), [08](08-gcp-bootstrap.md)).

## 60-секундний пітч

> «Я взяв застосунок на Next.js, що працював serverless на Vercel з керованими
> SaaS-бекендами, і переніс його на GCP, яким керую сам: контейнеризував його
> багатоетапним Docker build, запустив на **GKE** з Deployment, автомасштабуванням (autoscaling),
> health-пробами та оновленнями з нульовим простоєм (zero-downtime) через rolling update, розгорнув
> усе середовище — VPC, GKE, **Cloud SQL**, **Memorystore**, **GCS**, Artifact
> Registry, IAM — як код (infrastructure as code) за допомогою **Terraform** і налаштував **CI/CD**-пайплайн,
> який збирає, пушить і деплоїть на кожен merge з keyless-автентифікацією (keyless auth). Бази
> доступні лише за приватним IP (private IP), а поди дістаються до GCP через Workload Identity,
> а не через статичні ключі.»

## Огляд архітектури

```
git push → CI (test gate → build → push → deploy → rollout gate)
                                   │
                          Artifact Registry (image)
                                   │
 Internet → Cloud LB → Ingress → Service → Deployment(+HPA) → Pods
                                                                │ Workload Identity
                                   ┌────────────────────────────┼───────────────┐
                              Cloud SQL (Postgres)    Memorystore (Redis)      GCS
                              private IP / VPC peering · Secret Manager for creds
   Unchanged SaaS: Stripe · Resend · OAuth
```

## Відображення SaaS → GCP (знати назубок)

| Аспект | Було | Стало | Зміна в застосунку |
|---|---|---|---|
| Compute | Vercel | GKE | контейнеризація; standalone output |
| База даних | Neon | managed Cloud SQL | без зміни коду: `DB_DRIVER=pg` → node-postgres адаптер |
| Кеш | Upstash (REST) | Memorystore | без зміни коду: нативний `node-redis` по TCP (`REDIS_URL`); на Vercel лишається Upstash REST |
| Файли | AWS S3 | GCS | S3 SDK на GCS S3-interop endpoint, або GCS SDK |
| Registry | — | Artifact Registry | нове |
| Секрети | env-змінні | Secret Manager + Workload Identity | читаються за ідентичністю |
| Provisioning (надання інфраструктури) | дашборди | Terraform | нове |
| Доставка | git push на Vercel | GitHub Actions/Cloud Build → GKE | нове |

## Kubernetes — бліц-питання-відповіді

- **Deployment vs StatefulSet vs DaemonSet?** Stateless-репліки / стабільна
  ідентичність + сховище / по одному на кожен вузол.
- **Типи Service?** ClusterIP (внутрішній, наш), NodePort, LoadBalancer, ExternalName.
  Зовнішній трафік заходить через Ingress → ClusterIP Service.
- **Liveness vs readiness vs startup?** Перезапустити-якщо-мертвий /
  прибрати-з-LB-доки-не-готовий / зачекати-доки-завантажиться. Не клади перевірки
  залежностей у liveness.
- **Як Service знаходить поди?** Label-селектор → EndpointSlices, що оновлюються наживо.
- **Requests vs limits?** Резервування для планувальника + знаменник для HPA проти
  жорсткої стелі (CPU throttle, memory OOMKill).
- **Rollout з нульовим простоєм?** RollingUpdate `maxUnavailable:0` + gating за
  readiness + NEG readiness gate + PDB; після schema migration — fix-forward.
- **Керування секретами?** Не у відкритому вигляді в git — Sealed Secrets/SOPS,
  External Secrets із Secret Manager, або CSI + Workload Identity.
- **HPA vs Cluster Autoscaler?** HPA додає **поди** за метриками; CA (автомасштабувальник кластера) додає **вузли**,
  коли поди не можуть запланіруватись. Вони працюють разом.
- **Helm vs Kustomize?** Шаблонізація+пакування+релізи проти overlay/patch (вбудовано
  в kubectl). Ми використовуємо Kustomize: одна base, оверлеї local + gcp.

## Terraform — бліц-питання-відповіді

- **State — що це / навіщо remote / навіщо lock?** Зіставляє конфіг↔реальні ресурси
  (може містити секрети). Remote (GCS) = віддалений стан (remote state), надійний, спільний, версіонований; lock (блокування)
  не дає одночасним apply пошкодити його.
- **Як визначається порядок?** Граф ресурсів (dependency graph) із посилань; `depends_on` для прихованих
  залежностей (наприклад, Private Services Access перед Cloud SQL).
- **Модулі — навіщо?** Перевикористання + інкапсуляція (encapsulation); тонкий root на кожне
  середовище комбінує їх (`envs/dev`, `envs/prod` спільно використовують `modules/`).
- **`count` vs `for_each`?** `for_each` (map/set) стабільний при додаванні/видаленні;
  `count` переіндексовує й спричиняє churn. (І ще: не можна робити `for_each` по
  *sensitive* map — ключі стають адресами; ітеруй `toset(keys(...))`.)
- **plan vs apply?** Plan = попередній перегляд diff (безпечний, read-only); apply =
  застосувати. Переглядай plan у CI перед apply.
- **Як запобігти випадковому видаленню?** `deletion_protection`, `prevent_destroy`,
  перегляд plan.
- **Workspaces vs директорії?** Ми використовуємо **директорії** на кожне середовище
  (чіткіший радіус ураження) замість workspaces.

## Сервіси GCP — бліц-питання-відповіді

- **GKE Autopilot vs Standard?** Autopilot = Google керує вузлами (білінг per-pod);
  Standard = ти керуєш node pools (те, що ми використали, більше контролю).
- **Тримати БД приватною?** Приватний IP через Private Services Access (VPC peering — пірингове зʼєднання),
  `ipv4_enabled=false`, примусовий SSL; доступна лише з VPC.
- **Workload Identity?** K8s SA імперсонує Google SA → поди викликають GCP API з
  короткоживучими credentials, без експортованих ключів. Головний патерн безпеки в GCP.
  Це втілення принципу найменших привілеїв (least privilege).
- **Cloud NAT — навіщо?** Приватні вузли не мають публічного IP; вихідний інтернет
  (Stripe/Resend/npm) виходить через NAT.
- **VPC-native кластер?** Поди/Сервіси отримують реальні IP із вторинних діапазонів
  підмережі (alias IPs) → потрібно для NEG / container-native балансування навантаження (load balancing).
- **Regional vs zonal?** Регіональна control plane + вузли в кількох зонах = HA (висока доступність, high availability).

## CI/CD — бліц-питання-відповіді

- **Keyless-автентифікація в хмарі?** Workload Identity Federation: OIDC-токен CI →
  короткоживучі GCP credentials. Жодного статичного ключа SA в секретах.
- **Тегування образів?** Commit SHA + `latest` публікуються для навігації, але deploy
  використовує immutable registry digest (`image@sha256:…`).
- **Безпечний деплой?** Test gate → build → gate за rollout-status; захист
  `concurrency`; migrate-before-rollout; плавне оновлення; fix-forward після міграції.
- **Міграції?** Gated pre-deploy Job, що виконує `prisma migrate deploy`;
  expand/contract, щоб старі+нові поди співіснували.

## «Проведи мене через те, що відбувається на `git push`»

1. CI запускає lint + тести (gate). 2. Збирає багатоетапний образ і отримує його
registry digest. 3. Автентифікується в GCP keyless (WIF), пушить в Artifact Registry.
4. Отримує GKE credentials, застосовує infra, запускає migration gate, потім
Deployment із digest-pinned image. 5. Kubernetes викочує поди по одному, gating за readiness
(глибока health-перевірка пінгує Cloud SQL). 6. CI чекає на `rollout status`; якщо
поди не стають здоровими, job падає. 7. Ingress/Cloud LB маршрутизує трафік лише на
Ready-поди; HPA масштабує за навантаженням; Cluster Autoscaler додає вузли за потреби.

## Про що бути чесним (це навчальний білд)

- Перевірено **локально / офлайн**: `kubectl kustomize` рендерить обидва оверлеї,
  `tofu validate` + `fmt` проходять, CI YAML парситься. **Не** застосовано до живого
  GCP (вартість).
- Адаптації коду застосунку SaaS→GCP (Prisma node-postgres адаптер, node-redis-клієнт
  замість Upstash REST, S3 SDK на GCS S3-interop endpoint) **повністю реалізовані** в
  `src/lib/infra/` (`db-local.ts`, `redis-tcp.ts`, `email-local.ts`) і перевірені
  локально на kind (`07-local-run.md`). На Vercel ці шляхи недосяжні — вони за
  гейтами наявності connection-конфігу (`DB_DRIVER=pg`, `REDIS_URL`, `SMTP_HOST`), тому Vercel-деплой
  нічого не відчуває. Не реалізовано лише живий GCP-apply (вартість $300 trial).

## Фінальний чек-лист

- [x] Можу дати 60-секундний пітч
- [x] Можу намалювати архітектуру з пам'яті
- [x] Можу відтворити відображення SaaS→GCP
- [x] Можу відповісти на бліц-питання за кожною темою
- [x] Можу провести через `git push` від початку до кінця
