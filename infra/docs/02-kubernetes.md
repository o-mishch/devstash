# Шар 2 — Kubernetes

> Серце співбесіди. Беремо образ із Шару 1 і запускаємо його на Kubernetes:
> декларативно описаний, із самовідновленням (self-healing), автомасштабуванням (autoscaling) і розгортанням
> без простою (zero-downtime). Перевірено локально на **kind** (Kubernetes-in-Docker); ті самі
> маніфести націлені на GKE через Kustomize-оверлей.

> 🎓 **Навчальний трек.** Концепти для співбесіди зібрані у блоках 📚 «Ключові
> виписки з офіційних ресурсів» і «Тези для співбесіди» нижче. Блок ⚙️
> **Автоматизація** показує, яка команда `run.sh` інкапсулює ручні кроки — спершу
> прожени їх руками (щоб бачити control loop наживо), далі відтворюй одним
> викликом. Локальний стек на kind автоматизує
> [`infra/run/local/run.sh`](../run/local/run.sh), хмарний на GKE — CI, який
> запускає [`infra/run/gcp/run.sh`](../run/gcp/run.sh).

## Ментальна модель (озвучте це на співбесіді)

Kubernetes — це **декларативний цикл керування** (control loop). Ви подаєте *бажаний стан* (desired state)
(YAML); контролери безперервно узгоджують (reconcile) *фактичний стан* (actual state) із ним. Ви ніколи
не «запускаєте контейнер» — ви декларуєте «я хочу N справних реплік цього образу»,
і система робить це правдою та підтримує цей стан (переносить на інший вузол при
смерті ноди, перезапускає при збої тощо).

Ієрархія об'єктів для застосунку без стану (stateless web app):

```
Ingress  → routes external HTTP(S) to a Service
Service  → stable virtual IP + DNS, load-balances across Pods (by label selector)
Deployment → manages a ReplicaSet → which manages Pods (the running containers)
HPA      → adjusts the Deployment's replica count from live metrics
ConfigMap / Secret → inject config + credentials as env vars
PDB      → protects availability during voluntary disruptions
```

## Що ми будуємо (`infra/k8s/`)

```
base/                       # environment-agnostic
├── deployment.yaml         # replicas, rolling update, probes, resources, security
│                           #   + pod anti-affinity (spread across nodes)
├── service.yaml            # ClusterIP, label selector → pods
├── ingress.yaml            # HTTP routing (class set per overlay)
├── hpa.yaml                # autoscale 2→10 on CPU/memory
├── configmap.yaml          # non-secret env
├── secret.example.yaml     # TEMPLATE — documents required keys, never real values
├── pdb.yaml                # PodDisruptionBudget
├── networkpolicy.yaml      # default-deny; allow DNS/Postgres/Redis/HTTPS egress
└── kustomization.yaml      # ties the base together
overlays/
├── local/                  # smoke-test: nginx ingress, 1 replica, dummy secret (no backing services)
└── gcp/                    # GKE: GCE ingress, managed cert, Workload Identity, NEG
│                           #   + namespace with Pod Security Admission (restricted)
local-run/                  # FUNCTIONAL local stack (kind) — same base, with:
│                           #   patches/app-local.yaml       socat sidecar (MinIO localhost shim)
│                           #   patches/service-nodeport.yaml NodePort → host :8080
│                           #   patches/networkpolicy-local.yaml extra egress: MinIO 9000, Mailpit 1025/8025
│                           #   03-app-secret.yaml           throwaway secrets
└── run.sh                  # one-shot: create kind cluster → build image → migrate → rollout → verify
```

→ файли: [`infra/k8s/base/`](../k8s/base/)

## Ключові виписки з офіційних ресурсів

### Kubernetes — Deployment та RollingUpdate
> Джерело: [kubernetes.io/docs/concepts/workloads/controllers/deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

**Deployment** — декларативне управління набором Pod-ів для stateless-застосунків. Ви описуєте бажаний стан; Deployment Controller узгоджує фактичний стан із ним у контрольованому темпі.

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3

  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0   # ніколи не опускатись нижче бажаної кількості
      maxSurge: 1         # max 1 зайвий pod під час викочування

  # revisionHistoryLimit: скільки старих ReplicaSet зберігати для rollback
  revisionHistoryLimit: 10
  progressDeadlineSeconds: 600   # скільки секунд чекати на прогрес
```

**Як працює rolling update:**
- `maxUnavailable: 0` + `maxSurge: 1` → 3 бажаних = max 4 pod, min 3 pod під час deploy
- Новий pod має пройти `readinessProbe` перш ніж старий буде видалено
- Зміна `.spec.template` тригерить rollout; зміна `.spec.replicas` — ні

**Команди управління rollout:**
> `rollout undo` — загальний Kubernetes інструмент. У GCP pipeline не використовуй
> його після успішного migration Job без перевірки backward compatibility; default — fix-forward.
```bash
kubectl rollout status deployment/devstash-web    # дочекатись завершення
kubectl rollout history deployment/devstash-web   # переглянути ревізії
kubectl rollout undo deployment/devstash-web      # відкотити на попередній ReplicaSet
kubectl rollout undo deployment/devstash-web --to-revision=2   # на конкретну ревізію
kubectl rollout pause deployment/devstash-web     # призупинити (для серії змін)
kubectl rollout resume deployment/devstash-web    # відновити
```

**Стани Deployment:**

| Стан | Значення |
|------|---------|
| `Progressing` | rollout в процесі, новий ReplicaSet створено |
| `Complete` | всі репліки оновлені й доступні |
| `Failed` | не вдалось прогресувати (помилка pull image, quota тощо) |

---

### Kubernetes — три типи проб
> Джерело: [kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

| Проба | Запитання | Дія при невдачі |
|-------|-----------|----------------|
| `startupProbe` | чи завершився запуск? | чекати далі (liveness/readiness не запускаються) |
| `livenessProbe` | чи живий процес? | **перезапустити** контейнер |
| `readinessProbe` | чи готовий до трафіку? | **прибрати з Service** (без перезапуску) |

```yaml
# Startup: дати час на холодний старт Next.js перш ніж liveness вмикається.
# failureThreshold × periodSeconds = максимальний час запуску
startupProbe:
  httpGet:
    path: /api/health
    port: http
  failureThreshold: 12   # 12 × 5с = 60с максимум
  periodSeconds: 5

# Liveness: процес завис або заблокувався? → перезапуск.
# НЕ перевіряти БД тут — збій БД не означає, що app треба перезапускати.
livenessProbe:
  httpGet:
    path: /api/health
    port: http
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3

# Readiness: глибока перевірка — чи підключені залежності?
# Невдача → pod прибирається з Endpoints Service, трафік не йде.
readinessProbe:
  httpGet:
    path: /api/health?deep=1
    port: http
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
```

**Ключові поля конфігурації:**

| Поле | За замовч. | Призначення |
|------|-----------|-------------|
| `initialDelaySeconds` | 0 | затримка перед першою пробою |
| `periodSeconds` | 10 | інтервал між пробами |
| `timeoutSeconds` | 1 | тайм-аут однієї проби |
| `failureThreshold` | 3 | кількість невдач підряд → дія |

> **Типова помилка:** БД-перевірка у `livenessProbe` → тимчасовий збій БД = restart loop. БД перевіряється тільки в readiness.

---

### Kubernetes — resource requests vs limits
> Джерело: [kubernetes.io/docs/concepts/configuration/manage-resources-containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)

```yaml
resources:
  requests:         # планувальник резервує це на ноді; HPA рахує % від requests
    cpu: 250m       # 250 мілікор = 0.25 ядра
    memory: 256Mi
  limits:           # жорстка стеля (kubelet / cgroups)
    cpu: "1"        # CPU throttle — не вбиває, лише сповільнює
    memory: 512Mi   # перевищення → OOMKill (реактивно)
```

| Аспект | Request | Limit |
|--------|---------|-------|
| Перевіряється | при плануванні | під час виконання |
| Виконавець | kube-scheduler | kubelet/kernel |
| Чи можна перевищити? | так (якщо ресурси є) | ні |
| CPU при перевищенні | n/a | throttle (не вбиває) |
| Memory при перевищенні | n/a | OOMKill |

**Без `requests` HPA не може обчислити % утилізації → автомасштабування не працює.**

```
# ❌ ПОМИЛКА: memory: 400m = 0.4 байти!
# ✅ ПРАВИЛЬНО: memory: 400Mi = 400 мебібайти
```

---

### kubectl — шпаргалка
> Джерело: [kubernetes.io/docs/reference/kubectl/quick-reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/)

```bash
# Огляд стану
kubectl get pods -n devstash                      # статус усіх pod'ів
kubectl get pods -n devstash -o wide              # з IP та нодою
kubectl describe pod <name> -n devstash           # Events: probe failures, scheduling

# Логи та дебаг
kubectl logs <pod> -n devstash                    # поточні логи
kubectl logs <pod> -n devstash -f                 # слідкувати в реальному часі
kubectl logs <pod> -n devstash --previous         # логи впавшого контейнера
kubectl exec -it <pod> -n devstash -- sh          # shell всередині контейнера

# Rollout (`undo` only when no incompatible schema migration has landed)
kubectl rollout status deploy/devstash-web -n devstash
kubectl rollout undo deploy/devstash-web -n devstash

# Ресурси в реальному часі
kubectl top pods -n devstash
kubectl top nodes

# Kustomize
kubectl kustomize infra/k8s/overlays/local        # рендерити без застосування
kubectl apply -k infra/k8s/overlays/local         # рендерити + застосувати
kubectl diff -k infra/k8s/overlays/gcp            # показати diff перед apply

# Зручні аліаси
alias k=kubectl
alias kn='kubectl config set-context --current --namespace'
```

**Поширені статуси pod:**

| Статус | Причина |
|--------|---------|
| `ImagePullBackOff` | реєстр / тег / права доступу |
| `CrashLoopBackOff` | app падає при запуску — дивись `--previous` |
| `Pending` | немає ноди з достатніми ресурсами |
| `0/1 Ready` | readiness probe не проходить |

## Розбір — ключові ресурси

### Deployment (`deployment.yaml`)

Його серце. Важливі поля та *чому вони мають значення*:

- **`strategy: RollingUpdate` / `maxUnavailable: 0` / `maxSurge: 1`** — розгортання
  без простою (rolling update). K8s піднімає новий pod, чекає на його **readiness**-пробу, а потім
  виводить з експлуатації старий. Ніколи не опускається нижче бажаної ємності.
- **Три проби**, кожна ставить інше запитання:
  | Проба | Запитання | При збої | Шлях |
  |-------|----------|-----------|------|
  | `startupProbe` | Чи завершився запуск? | продовжувати чекати (до 60с) | `/api/health` |
  | `livenessProbe` | Чи завис/заблокувався? | **перезапустити** контейнер | `/api/health` |
  | `readinessProbe` | Чи може обслуговувати *зараз*? | **прибрати з Service** (без перезапуску) | `/api/health?deep=1` |
  Розділення має значення: тимчасовий збій БД має вивести pod із ротації
  (readiness, глибока перевірка), але **не** перезапускати його (liveness, поверхнева
  перевірка). Підключення liveness до перевірки БД — класична помилка, що перетворює
  миттєвий збій БД на цикл перезапусків (crash loop).
- **`resources.requests` проти `limits`** — requests — це те, що резервує планувальник (scheduler)
  і відносно чого **HPA вимірює утилізацію**; limits — жорсткі стелі
  (перевищення пам'яті → OOMKill). Немає requests = HPA не може обчислити % = немає
  автомасштабування.
- **`securityContext`** — `runAsNonRoot`, скинути всі capabilities,
  `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`. Відповідає
  non-root образу й задовольняє «restricted» PodSecurity.

### Service (`service.yaml`)

`ClusterIP` — стабільна внутрішньокластерна IP-адреса + DNS-ім'я (`devstash-web`), що
балансує навантаження (load balancing) між pod'ами, які відповідають label selector. Pod'и ефемерні (IP
змінюються при кожному перезапуску); Service — це стабільна адреса, яку використовує все інше.
`targetPort: http` посилається на *іменований* порт контейнера, тож номер живе в
одному місці.

### Ingress (`ingress.yaml`)

L7 HTTP-маршрутизація ззовні кластера до Service. Базова конфігурація не залежить
від провайдера; **ingress class** задається в кожному оверлеї — `nginx` локально, `gce` на
GKE (який провіжить справжній Google Cloud Load Balancer).

### HPA (`hpa.yaml`)

`autoscaling/v2`. Масштабує Deployment 2→10, коли середній CPU > 70% від request
(або пам'ять > 80%). `behavior` масштабує **вгору швидко** (вікно 30с) і **вниз повільно**
(300с), щоб уникнути «гойдання» (thrashing) на сплесках трафіку.

### ConfigMap проти Secret — межа безпеки

- **ConfigMap** = несекретна конфігурація (`NODE_ENV`, `PORT`, `LOG_LEVEL`, публічний URL).
- **Secret** = усе чутливе (URL БД, `AUTH_SECRET`, API-ключі).
- `secret.example.yaml` — це **шаблон**: він документує ключі (дзеркалить
  `.env.example`), але не містить реальних значень. У продакшені ви ніколи не робите `kubectl apply`
  для секрету у відкритому тексті; ви використовуєте **Sealed Secrets** / **SOPS** (зашифровані в git),
  **External Secrets Operator** (синхронізація з Google Secret Manager) або
  **Secrets Store CSI driver** (монтування через Workload Identity). Шар Terraform
  провіжить Secret Manager + Workload Identity саме для цього.
- **Stakater Reloader** (анотація `secret.reloader.stakater.com/reload: "devstash-secrets"`
  у `deployment.yaml`) стежить **лише за Secret** `devstash-secrets` — коли ESO оновлює
  значення з Secret Manager, Reloader сам робить rolling restart подів. За ConfigMap
  `devstash-config` Reloader **не** стежить. Оскільки `devstash-config` генерується через
  `configMapGenerator` (`behavior: merge`), а значення з `settings.yaml` потрапляють у неї
  через `replacements` **після** генерації хешу, хеш-суфікс імені ConfigMap не змінюється —
  тож зміна значення в `settings.yaml` (напр. `authGoogleId`) теж не тригерить рестарт.
  Після такої зміни потрібен ручний рестарт:
  ```bash
  kubectl rollout restart deploy/devstash-web -n devstash
  ```

### PodDisruptionBudget (`pdb.yaml`)

`maxUnavailable: 1` — під час *добровільних* збоїв (voluntary disruptions) (drain ноди для оновлення,
зменшення масштабу автоскейлером) Kubernetes дозволяє виселити (evict) максимум 1 под одночасно.
Це дозволяє оновлювати ноди без простою для масштабованих додатків, а також запобігає блокуванню
оновлення, коли додаток масштабовано до 1 репліки (наприклад, у dev-оточеннях).

## Kustomize: base + overlays (без шаблонізації)

Kustomize ґрунтується на патчах, а не на шаблонах (на відміну від Helm). Один `base/`, потім
оверлеї, які **патчать** його під кожне середовище:

- **`overlays/local`** (kind): ingress class nginx, 1 репліка, закомічений
  *фіктивний* (dummy) секрет (кожне значення несправжнє — безпечно лише тому, що нічого
  не є реальним), образ `devstash:local`.
- **`overlays/gcp`** (GKE): GCE ingress + глобальна статична IP + Google **ManagedCertificate**
  (авто-TLS), **BackendConfig**, щоб Cloud LB перевіряв здоров'я через `/api/health`,
  анотація **NEG** для container-native балансування навантаження та ServiceAccount із
  **Workload Identity**, щоб pod'и зверталися до GCP API за ідентичністю (без статичних ключів).
  Образ вказує на Artifact Registry; CI перевизначає тег під кожну збірку.

## Перевірка локально

Маніфести вже перевірені — обидва оверлеї рендеряться:

```bash
# Render without a cluster (what we ran here):
kubectl kustomize infra/k8s/overlays/local   # 8 resources
kubectl kustomize infra/k8s/overlays/gcp     # 10 resources (adds SA, BackendConfig, cert)
```

Щоб реально запустити це на локальному кластері:

```bash
# 1. Create a local cluster + ingress
kind create cluster --name devstash
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml

# 2. Load the Layer 1 image into kind (no registry needed)
docker build -t devstash:local .
kind load docker-image devstash:local --name devstash

# 3. Deploy
kubectl apply -k infra/k8s/overlays/local

# 4. Observe the control loop in action
kubectl -n devstash get pods -w           # watch pods become Ready
kubectl -n devstash describe deploy devstash-web
kubectl -n devstash get hpa               # autoscaler targets
kubectl -n devstash logs deploy/devstash-web

# 5. Reach it
kubectl -n devstash port-forward svc/devstash-web 8080:80
curl localhost:8080/api/health            # {"status":"ok"}

# 6. Tear down
kind delete cluster --name devstash
```

> Локальний запуск із фіктивним секретом піднімає застосунок і обслуговує `/api/health`; функції,
> що залежать від БД, потребують справжніх Postgres/Redis (запустіть їх у кластері або скористайтеся шляхом GCP).

> ⚙️ **Автоматизація.** Кроки 1–6 вище (kind → build → deploy → перевірка) ручні —
> щоб бачити control loop наживо. Повний **функціональний** локальний стек
> (in-cluster Postgres/Redis/MinIO/Mailpit + міграції + seed, у тому ж порядку
> migrate→rollout, що й CI) піднімає один скрипт:
> ```bash
> bash infra/run/local/run.sh up       # kind → build web+migrate → migrate Job → rollout → verify
> bash infra/run/local/run.sh deploy   # швидка ітерація: rebuild + migrate + rollout
> bash infra/run/local/run.sh status   # стан кластера / подів / health
> bash infra/run/local/run.sh info     # URL усіх сервісів (app, Postgres, MinIO, Mailpit…)
> bash infra/run/local/run.sh down     # знести kind-кластер
> ```
> На GKE ті самі base-маніфести застосовує CI (`deploy-gke.yml`), що його тригерить
> [`infra/run/gcp/run.sh deploy`](../run/gcp/run.sh) (Рівень 4). Детальний розбір
> kind-стека — у [07-local-run.md](07-local-run.md).

## Шпаргалка з налагодження (вас про це запитають)

```bash
kubectl get pods                          # STATUS column tells the story
kubectl describe pod <p>                  # Events: scheduling, pull, probe failures
kubectl logs <p> [-c web] [--previous]    # --previous = logs from the last crash
kubectl exec -it <p> -- sh                # shell into the container
kubectl get events --sort-by=.lastTimestamp
kubectl rollout status deploy/devstash-web
kubectl rollout undo deploy/devstash-web  # only if the DB schema remains backward-compatible
```

Поширені стани: `ImagePullBackOff` (реєстр/тег/права), `CrashLoopBackOff`
(застосунок завершується — перевірте логи + `--previous`), `Pending` (немає вузла для
планування / занадто високі resource requests), `0/1 Ready` (readiness-проба не проходить).

## Тези для співбесіди

- **«Deployment проти StatefulSet проти DaemonSet?»** Deployment = взаємозамінні
  репліки без стану (наш web-застосунок). StatefulSet = стабільна ідентичність + сховище
  (бази даних). DaemonSet = один pod на вузол (агенти логів/метрик).
- **«Як rolling updates залишаються без простою?»** `maxUnavailable: 0` + гейтинг на
  readiness + PDB; нові pod'и мають стати Ready перш ніж старі будуть виведені (drain).
- **«Liveness проти readiness?»** Перезапустити-якщо-мертвий проти прибрати-з-LB-доки-не-готовий;
  різні проби, різні засоби лікування. Не кладіть перевірки залежностей у liveness.
- **«Як Service знаходить pod'и?»** Label selector → Endpoints/EndpointSlices,
  що оновлюються в міру появи та зникнення pod'ів.
- **«Як ви керуєте секретами?»** Не у відкритому тексті в git — Sealed Secrets/SOPS,
  External Secrets із Secret Manager або CSI + Workload Identity.
- **«Requests проти limits?»** Резервування планувальника + знаменник HPA проти жорсткої
  стелі (CPU тротлиться, пам'ять OOMKill'иться).
- **«Helm проти Kustomize?»** Helm = шаблонізація + пакування + релізи; Kustomize =
  оверлей/патч, без мови шаблонів, вбудований у kubectl. Ми використовуємо Kustomize.

## Чек-лист

- [x] Deployment із rolling update, 3 пробами, ресурсами, securityContext
- [x] Service (ClusterIP) + Ingress (class per overlay)
- [x] HPA (v2, CPU + пам'ять, поведінка масштабування)
- [x] ConfigMap + шаблон Secret + PDB
- [x] Kustomize base + оверлеї local/gcp — обидва рендеряться чисто
- [ ] (опціонально) розгорнуто на локальний kind-кластер
