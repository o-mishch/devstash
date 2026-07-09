# Навчальний трек DevOps — Зміст

Практичний трек, що переносить DevStash на **GCP + Terraform + Kubernetes**,
щоб підготуватися до технічної співбесіди з DevOps. Читайте по порядку.

| #  | Документ | Що охоплює | Тема співбесіди |
|----|-----|--------|-----------------|
| 00 | [Майстер-план](00-master-plan.md) | Уся стратегія, поточний і цільовий стек, архітектура | (орієнтація) |
| 01 | [Docker](01-docker.md) | Багатоетапний build, standalone output, посилення безпеки image | Контейнери |
| 02 | [Kubernetes](02-kubernetes.md) | Deployment, Service, Ingress, HPA, проби, ConfigMap/Secret, Kustomize | **Kubernetes** |
| 03 | [Terraform](03-terraform.md) | Модулі, state, провайдери, GKE/Cloud SQL/Memorystore/GCS/IAM | **Terraform + GCP** |
| 04 | [CI/CD](04-cicd.md) | GitHub Actions проти Cloud Build, build→push→deploy | **CI/CD** |
| 05 | [Навчальний посібник](05-study-guide.md) | Огляд архітектури + шпаргалки з питаннями та відповідями за темами | (повторення) |
| 06 | [Налаштування Mac](06-mac-setup.md) | Встановлення Terraform/OpenTofu, kubectl, kind, Docker на macOS | (налаштування) |
| 07 | [Локальний запуск](07-local-run.md) | Повний робочий застосунок на kind: in-cluster Postgres, міграції, deep health | (практика) |
| 08 | [Bootstrap GCP](08-gcp-bootstrap.md) | Що руками підготувати на cloud.google.com/free **перед** `tofu init`: проєкт, білінг, ADC, state-бакет, tfvars | (передумови deploy) |
| 09 | [GCP hardening roadmap](09-gcp-audit.md) | Forward-looking кроки до продакшну: alerts, Binary Auth, restore-drill, prod/dev split, HA-сайзинг | (roadmap) |
| 10 | [Suspend / Resume](10-suspend-resume.md) | On-demand showcase за ~$0: `environment_active` toggle, `devstash-infra gcp suspend`/`resume`, Spaceship DNS, idle auto-suspend (Monitoring→Pub/Sub→Build) | (cost) |
| 11 | [Логи застосунку](11-logs.md) | Перегляд і пошук логів подів: `kubectl logs`, Logs Explorer, пошук за підрядком (`SEARCH`, `=~`, `jsonPayload.*`) | (observability) |

## Як цим користуватися

Кожен документ має три розділи:
1. **Що ми будуємо** — артефакти та навіщо вони.
2. **Покроковий розбір** — порядкове пояснення файлів.
3. **Перевірка локально** — точні команди, що доводять працездатність (без витрат на хмару).
4. **Тези для співбесіди** — що казати, коли запитають.

> 🎓 **Навчальні позначки (єдині в усьому треку).** 📚-блок — короткий концепт для
> співбесіди (з джерелом); ⚙️-блок — команда `devstash-infra`, що інкапсулює ручний крок.
> Логіка: спершу прожени крок руками (щоб розуміти механіку), далі відтворюй одним
> викликом — [`devstash-infra local`](../cli/README.md) (kind) і
> [`devstash-infra gcp`](../cli/README.md) (GKE).

> Легенда статусів: документ кожного шару завершується чеклістом, що віддзеркалений у майстер-плані.

## Безкоштовні ресурси для навчання

| Ресурс | Що дає | Коли відкрити |
|---|---|---|
| [Google Cloud Skills Boost](https://www.cloudskillsboost.google) | Тимчасові sandbox-середовища GCP, частина лабораторій — безкоштовно | Хочеш зробити `tofu apply` без власного проєкту |
| [HashiCorp Learn — Terraform + K8s](https://developer.hashicorp.com/terraform/tutorials/kubernetes) | Офіційні покрокові туторіали Terraform | Вивчаєш `modules/`, `for_each`, remote state |
| [Terraform GKE module](https://registry.terraform.io/modules/terraform-google-modules/kubernetes-engine/google) | Production-рівень GKE-модуль — найкращі практики | Порівнюй із `infra/terraform/modules/gke/` |

### Стратегія безкоштовного GCP

- **$300 кредитів** для нових акаунтів (90 днів) — достатньо для реального `tofu apply` всього стеку
- **Google Cloud Shell** — браузерний термінал із уже встановленими `gcloud`, `kubectl`, `terraform`; нічого не треба ставити локально
- **GKE Autopilot** — Google керує nodes; management fee може покрити місячний
  GKE credit, але Pod requests оплачуються окремо
- Для dev контролюй `minReplicas`, requests і HPA; цей Autopilot module не має
  ручних preemptible node pools

> Готовий робити реальний deploy? Спершу ручний bootstrap акаунта —
> [08-gcp-bootstrap.md](08-gcp-bootstrap.md) (проєкт, білінг, ADC, state-бакет, `tfvars`).

> Без акаунта: усе валідується офлайн — `tofu validate` + `kind` + `kubectl kustomize`. Дивись [07-local-run.md](07-local-run.md).
