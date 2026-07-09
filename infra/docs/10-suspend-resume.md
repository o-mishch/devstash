# 10 · Suspend / Resume — running the GKE env for ~$0

The GKE deploy (`gke.devstash.one`) is an **on-demand showcase**. The apex `devstash.one`
+ `www` run on Vercel; this stack is the heavyweight, self-managed-infra artifact you
bring up deliberately. A 24/7 GKE Autopilot + Cloud SQL + Memorystore + Cloud NAT + load
balancer has an irreducible always-on floor (~$120-170/mo at list price). To get close to
$0 we don't tune sizes — we change *when* it runs.

## The model

Two switches in `infra/terraform/envs/dev/variables.tf` drive `count` / `activation_policy`
across the stack:

- **`environment_active`** — the compute switch. The event-driven auto-suspend flips only
  this. It destroys the stateless compute and *stops* (but keeps) Cloud SQL.
- **`db_active`** — the deep-suspend switch. Only `devstash-infra gcp suspend`/`resume` flips it, and
  only after a verified GCS dump. It *destroys* the Cloud SQL instance for true ~$0.

| Resource | Active | **Deep-suspended** (`devstash-infra gcp suspend` or auto-suspend) | Why it's safe |
|---|---|---|---|
| Cloud SQL instance | running | **DUMPED to GCS, then DESTROYED** | data lives in the verified dump; resume restores it |
| GCS `db-dumps` bucket | kept | **kept** | holds the dump; Always-Free tier (us-central1) ≈ $0 |
| VPC / subnet / PSA peering | kept | **kept** | free; needed again on resume |
| Secret Manager (one `devstash-app-config` blob), app/deployer SA, WIF, uploads GCS | kept | **kept** | free (1 secret version ≤ the 6-version tier); avoids a full re-bootstrap |
| Artifact Registry `web`+`migrate` images | kept | **PURGED** | deleted for $0 idle storage; CI rebuilds+repushes on resume before the Deployment applies |
| KMS / Binary Authorization signing key | (dev: not created) | **absent** | `binauthz_enabled=false` in dev — KMS has no free tier, so it is never provisioned |
| GKE Autopilot cluster | up | **destroyed** | biggest cost; stateless |
| Memorystore (Redis) | up | **destroyed** | disposable rate-limit/cache state |
| Cloud NAT + router | up | **destroyed** | only needed while pods run |
| Cloud Armor policy | up | **destroyed** | bills per-policy/rule; attached to the gone LB |
| Global ingress IP | attached (free) | **released** | a reserved-but-idle global IP bills ~$7/mo |

There is an intermediate state — **`environment_active=false` but `db_active=true`**: compute
gone, Cloud SQL merely *stopped* (kept, ~$1.70/mo, no dump needed). Both `devstash-infra gcp suspend` and
the event-driven auto-suspend now skip past it to the full $0 deep suspend (dump + destroy).
You only land in the intermediate state deliberately — a plain `tofu apply -var
environment_active=false` (no `db_active`) — if you want the cheaper-but-dumpless middle
ground where the DB can restart instantly without a restore.

**Safety invariant:** the Cloud SQL instance no longer relies on `deletion_protection` (it
is torn down on every deep suspend, so it *can't* be protected — a `count→0` destroy reads
the flag from prior state). Data safety instead comes from the dump: `devstash-infra gcp suspend` runs
`gcloud sql export` to the `db-dumps` bucket and **verifies the object is non-empty before
it sets `db_active=false`**, so a failed dump aborts the suspend with the instance intact.
The auto-suspend path flips only `environment_active`, so it can **never** destroy the DB —
worst case it stops it. A `db_active` validation also rejects the nonsensical "app up, DB
gone" combination (`environment_active ⇒ db_active`).

**Idle cost = literal $0.00 (post-trial target).** Nothing that *runs* survives a deep
suspend, and the three at-rest items that used to floor the bill at ~$0.40–0.85/mo have each
been driven to zero — every survivor now sits inside an Always-Free allowance:

| Surviving residual | ~$/mo idle | How it reaches $0 |
|---|---|---|
| Artifact Registry image storage | **$0** | the repo is **gated on `environment_active`**, so the deep-suspend apply (both `devstash-infra gcp suspend` and the unattended auto-suspend) **destroys the whole repo + its images through Terraform**; CI rebuilds+repushes on resume, so nothing is stored while idle |
| Secret Manager | **$0** | the ~14 per-key secrets are **consolidated into one `devstash-app-config` JSON blob** → 1 active version (was 9), inside the 6-version free tier |
| KMS Binary Authorization signing key | **$0** | `binauthz_enabled=false` in dev → the key (KMS has **no** free tier) is **never created**; prod sets it true for enforcement parity |
| GCS: db-dumps + uploads + tfstate | **$0** | us-central1 Always-Free 5 GB regional tier; noncurrent versions expire via lifecycle rules |

The signing pipeline is gated as a unit (`binauthz_enabled`): keyring, key, note, attestor,
policy, the cluster enforcement block, and the deployer signing-IAM. CI self-skips when it is
off (`devstash-infra ci validate-inputs` treats `BINAUTHZ_*` as optional; the "Sign images" step
guards on `vars.BINAUTHZ_ATTESTOR`). Backups are off in dev (`backups_enabled=false` in the
cloudsql module) since the dump is the durability mechanism; turn them on for prod.

> **Resume cost of the $0 posture:** a resume must rebuild the images (CI already does this)
> and Terraform repopulates the consolidated secret — both already on the resume path, so no
> extra step. The only real trade-off is that dev loses Binary Authorization; it is a
> production supply-chain control with nothing to enforce against while suspended.

### Round-trip mechanics

`gcloud sql export|import sql` runs **server-side** — Cloud SQL's own service agent does the
`pg_dump`/restore straight to/from GCS, so it works over the instance's private-only
networking (no public IP or laptop connectivity needed). The agent is granted
`roles/storage.objectAdmin` on the `db-dumps` bucket only (`db-dumps.tf`). The dump includes
`_prisma_migrations`, so the CI migrate step after resume is a no-op when a dump was
restored. The generated DB password has no `keepers`, so it is stable across the cycle and
the recreated user matches the dump's object ownership.

### Dumps & retention — one live dump, versioned history

Every suspend (manual or auto) overwrites **one well-known object**,
`gs://<project>-devstash-dev-db-dumps/devstash-latest.sql`. There is no growing pile of
timestamped files — resume always reads that single current object, so it can't restore a
stale one. The bucket has **versioning on**, so an overwritten dump becomes a *noncurrent*
version rather than being discarded:

- The **current (live) dump has NO expiry — it is stored indefinitely**, until the next
  suspend overwrites it. There is deliberately no TTL on it: that's the guarantee that resume
  works no matter how long you stay suspended (a month, a year — the dump is still there).
  Enforced by scoping every lifecycle rule to `with_state = "ARCHIVED"` (noncurrent versions
  only); an unqualified age-based delete would be a data-loss bug and is called out as
  forbidden in `db-dumps.tf`. The `db_dump_keep_days` cap below does **not** apply to it.
- **Noncurrent** versions are the rollback history, bounded by two tunables (defaults keep
  the **5 most recent** superseded dumps and drop any older than **90 days**):

  ```hcl
  # terraform.tfvars — raise freely; it's ~$0 for a small DB
  db_dump_keep_versions = 5    # superseded dumps to retain (live dump always kept on top)
  db_dump_keep_days     = 90   # also expire superseded dumps older than this
  ```

  Retention is bounded by **total bytes, not version count**: GCS us-central1 gives 5 GB-month
  free (shared with the uploads bucket), and a dump is small — so keeping dozens of versions is
  effectively free, and even exceeding 5 GB is only ~$0.02/GB/month. Set the caps high (or the
  days very large) to keep long history.

To roll back to a *previous* dump (rare), list versions with
`gcloud storage ls -a gs://…/devstash-latest.sql` and copy the desired generation over the
live name before restoring.

### Restoring on demand

`devstash-infra gcp restore-db` imports the latest dump into the **current** Cloud SQL instance without a
full resume — this is the escape hatch if you ever end up with a freshly-created but empty
instance (e.g. after a bare `devstash-infra gcp apply` following an auto-suspend — see the footgun below).
`devstash-infra gcp dump-db` takes an ad-hoc export at any time without suspending. Both are no-ops-safe:
`restore-db` skips cleanly if there is no dump yet, and requires the instance to exist.

## Operating it

```bash
devstash-infra gcp suspend   # → ~$0: destroy compute, STOP Cloud SQL (data kept)
devstash-infra gcp resume    # recreate compute, START Cloud SQL, redeploy, fix DNS
```

The chosen state is persisted to `infra/terraform/envs/dev/active.auto.tfvars` (gitignored,
auto-loaded by OpenTofu), so a plain `tofu apply` / `devstash-infra gcp apply` keeps it — it won't
silently revert to active.

### There is no wake-on-request

GKE + Cloud SQL have no scale-to-zero / wake-on-HTTP (that's a Cloud Run / Vercel
property). While suspended, a request to `gke.devstash.one` reaches nothing. **Resume is an
explicit `~minutes` operation** (Autopilot cluster create ~3-5 min + Cloud SQL start ~1-2
min + image build/migrate/rollout). If you want "hit the URL and it's there," use the
Vercel deployment.

### Aborting a resume/up mid-flight — Ctrl-C ONCE, then re-run

If you must stop a `resume`/`up`/`apply` while OpenTofu is provisioning, press **Ctrl-C
exactly once** and wait. One interrupt is delivered to the whole foreground process group, so
the child `tofu` does its own **graceful shutdown** — it finishes the in-flight resource
operation and persists state before exiting. `devstash-infra` traps that first interrupt and
deliberately does **not** tear down, precisely so tofu can finish writing state.

**A second Ctrl-C tells tofu to exit immediately**, cancelling the provider mid-create. If a
resource (e.g. the Cloud SQL instance) was created cloud-side but its ID never got written to
state, it becomes an **orphan** — untracked, so neither a re-`apply` nor `terraform refresh`
will adopt it, and a later `suspend` (which sets `db_active=false`) cannot destroy it. Avoid
the double Ctrl-C unless you accept manual cleanup.

**Recovery from an interrupted bring-up: just re-run the SAME command** — `devstash-infra gcp resume` (or
`up`). Its `reconcile_state` step (branch 3d) detects a Cloud SQL instance / GKE cluster /
Valkey that exists in GCP but not in state and **imports** it before planning, so the retry
continues cleanly. Do **not** `suspend` over an interrupted resume — the DB-import branch is
skipped while `db_active=false`, which strands the orphan. If you already stranded one, delete
it by hand (`gcloud sql instances delete <name>` — the data is safe in the GCS dump) and then
resume/suspend as intended.

### DNS

The ingress IP is released on suspend and a fresh one is allocated on resume, so `resume`
re-points the `gke.devstash.one` A-record via the **Spaceship DNS API**
(`PUT /v1/dns/records/devstash.one`). It reads credentials from `SPACESHIP_API_KEY` /
`SPACESHIP_API_SECRET` (env) or the consolidated Secret Manager ops blob `devstash-ops-config`
(`spaceship-api-key` / `spaceship-api-secret` JSON properties).

**Where to put the credentials** — add them to the gitignored `terraform.tfvars` like
every other real credential; `dns.tf` pushes them to the single `devstash-ops-config` secret
on `apply` (kept OUT of the app blob `devstash-app-config` and its app-SA grant, so the app
never sees them):

```hcl
spaceship_api_key    = "..."
spaceship_api_secret = "..."
```

Alternatives: `devstash-infra gcp set-dns-creds` (hidden prompts → Secret Manager, also used to
**rotate** without a full apply), or one-off `SPACESHIP_API_*` env vars before `resume`.
If no creds are found, `resume` prints the IP and you set the A-record by hand. The managed
TLS cert re-provisions after DNS resolves to the new IP (up to ~60 min).

## Idle guard (so a forgotten env can't drain credits)

Two independent options. **Neither ever auto-resumes** — they only drive the env *down*;
you always bring it back with `devstash-infra gcp resume`.

### Option A — event-driven idle auto-suspend (no scheduler, fires with your laptop off)

Implemented in `infra/terraform/envs/dev/auto-suspend.tf`, **on by default** (`auto_suspend_enabled = true`;
set it false to opt out). There is no
polling clock: a **Cloud Monitoring alert** watches the ingress load balancer and fires
when it has served **zero requests for the idle window**. The alert publishes to a
**Pub/Sub topic**, which triggers a **Cloud Build** that first **dumps Cloud SQL to the
`db-dumps` bucket and verifies the dump**, then runs
`tofu apply -var environment_active=false -var db_active=false` — the same true-$0 deep
suspend a local `devstash-infra gcp suspend` does, unattended. The dump-and-verify is a separate build
step *before* the destroy apply, and a failed/empty export fails the build so an un-dumped
instance is never destroyed. It is **on by default** — `devstash-infra gcp apply` creates it with no
tfvars needed. Optionally tune it (or turn it off) in `terraform.tfvars`:

```hcl
# auto_suspend_enabled             = false  # opt OUT of automated suspension (default: true)
# auto_suspend_idle_window_seconds = 3600   # suspend after this much zero-traffic (default 1h)
# auto_suspend_repo_branch         = "main" # branch the build applies from
```

Cost is ~$0: Monitoring alerting and the first 10 GB/mo of Pub/Sub are
free, and Cloud Build runs only when a suspend actually happens (~once per idle transition),
not on a timer.

Flow: `Monitoring alert (0 requests for the window)` → `Pub/Sub topic` → `Cloud Build trigger` → guard → **dump + verify** → suspend apply.

How it stays correct and least-privilege:

- **Dedicated `…-lifecycle` SA**, separate from the deploy SA (which stays deploy-scoped).
  It gets exactly the roles suspend needs — delete cluster/Memorystore/NAT/Armor/IP, export
  + delete Cloud SQL, drop the `redis-*` + `database-*` secrets, read request_count + state
  + the dump object — and nothing more. The DB export runs as this SA (cloudsql.admin covers
  export + delete); the GCS write is done by the Cloud SQL service agent, so the SA only
  needs *read* on the dump bucket (for the verify).
- **The build re-checks before acting.** Its first step re-reads the live request count and
  a fresh-resume grace (a cluster younger than the idle window is left alone), and only
  proceeds if still idle. So the alert's *resolved* notification (sent when traffic returns)
  is a no-op — **a busy env can never be suspended**.
- **The dump gates the destroy.** The export + non-empty verify is a distinct step before
  the apply; `set -eu` makes a failed/empty dump fail the build, so the destroy apply never
  runs without a good dump in GCS.
- **`-refresh=false`** on the apply so Terraform only calls APIs for what suspend changes,
  not the org-policy / service-usage / WIF / KMS-admin surface a full refresh would touch.
- **No secrets baked into config.** Non-secret tfvars are passed as a base64 JSON blob built
  from the same module; the build reconstructs `third_party_secrets` + the Spaceship creds
  at runtime from the `devstash-*` Secret Manager secrets a normal apply created.

**Caveat — the ingress IP is public, so scanner/bot traffic counts as "use."** If the IP is
being scanned continuously the env may never go idle and so never auto-suspend. This only
ever *delays* a suspend (it can't cause a wrongful one); if it matters, suspend manually
with `devstash-infra gcp suspend` or narrow access with Cloud Armor.

**Footgun (now sharper — reads the DB, not just compute):** an auto-suspend writes
`environment_active=false` **and `db_active=false`** to *state*, but your local
`active.auto.tfvars` is untouched. If it still says `db_active = true`, a later bare
`devstash-infra gcp apply` would **recreate the Cloud SQL instance EMPTY** — it recreates the instance
but does *not* restore the dump (only `devstash-infra gcp resume` does). The data isn't lost (the dump
is safe in GCS), but you'd be staring at an empty database. **After an auto-suspend, always
bring the env back with `devstash-infra gcp resume`** — it sets both flags intentionally *and* runs the
`gcloud sql import` restore. Never use a bare `apply` to come back. If you already did and
have an empty instance, run **`devstash-infra gcp restore-db`** to import the dump into it — no need to
tear down and resume. To test before merging, point `auto_suspend_repo_branch` at your
feature branch.

#### Checking the last run

Neither the Cloud Scheduler job (`devstash-dev-auto-suspend-uptime-cap`) nor the Monitoring
alert carry useful logs themselves — they only publish a Pub/Sub message. The real
guard/prepare/dump/suspend/cleanup output lives in the **Cloud Build** run they
trigger (`devstash-dev-auto-suspend`).

Find the trigger id once (stable across runs):

```bash
gcloud builds triggers list --project=project-39965ce5-4c4b-495e-8d4 --region=us-central1 \
  --format="value(name,id)"
```

Get the latest build for that trigger — `--filter` scopes to just this trigger (otherwise
you'd get builds from every trigger in the project), `--limit=1` + newest-first gives you
the last one, `--format="value(id)"` strips it to the bare ID:

```bash
gcloud builds list --project=project-39965ce5-4c4b-495e-8d4 --region=us-central1 \
  --filter="buildTriggerId=<TRIGGER_ID>" --limit=1 --format="value(id)"
```

Drop `--format`/`--limit` (or raise `--limit`) to see full JSON — status, timestamps,
substitutions — across the last few runs instead of just the latest.

Then fetch the full step-by-step log for that build:

```bash
gcloud builds log <BUILD_ID> --project=project-39965ce5-4c4b-495e-8d4 --region=us-central1
```

Or open it in the console: `https://console.cloud.google.com/cloud-build/builds;region=us-central1/<BUILD_ID>?project=<PROJECT_NUMBER>`

A no-op tick (guard found no cluster, or cluster too fresh, or traffic present) shows every
step logging `skipping` and exiting clean — that's expected on most ticks, not a failure.

### Option B — local launchd job (simplest, no new infra, but laptop-dependent)

Runs `devstash-infra gcp suspend` nightly with *your* credentials (`AUTO_APPROVE=1` skips the confirm).
Only fires while your Mac is on/awake. Save as
`~/Library/LaunchAgents/one.devstash.auto-suspend.plist` (fill in `<REPO_ROOT>`), then
`launchctl load` it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>one.devstash.auto-suspend</string>
  <key>ProgramArguments</key>
  <array>
    <string><PATH_TO>/devstash-infra</string>
    <string>gcp</string>
    <string>suspend</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>AUTO_APPROVE</key><string>1</string></dict>
  <key>WorkingDirectory</key><string><REPO_ROOT></string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/devstash-auto-suspend.log</string>
  <key>StandardErrorPath</key><string>/tmp/devstash-auto-suspend.log</string>
</dict></plist>
```

## Complementary always-on savings (already applied)

These reduce cost while the env is *up*, independent of suspend/resume:

- **Cloud SQL backups off in dev** (`backups_enabled=false` in the cloudsql module; PITR
  `db_point_in_time_recovery` off too) — the suspend-time GCS dump is the durability
  mechanism, so paying for daily backups + WAL-archive storage is redundant here. Turn
  both on for a prod environment.
- **HPA `minReplicas: 1`** in the gcp overlay (base stays `2`) — halves the idle Autopilot
  pod floor; rolling updates stay zero-downtime via `maxSurge: 1`.
- **Billing budget + alert** (`billing_account` / `monthly_budget_amount` in tfvars,
  `budget.tf`) — emails at 50/90/100%. **A budget only ALERTS; it does not cap spend.** The
  actual $0 enforcement is the event-driven idle auto-suspend above — the budget is a backstop
  for a runaway that the idle guard doesn't catch, not the cost control itself. A true hard
  cap (budget → Pub/Sub → Cloud Function that disables billing) is deliberately not wired up:
  it's overkill for a ~$1/mo env and can brick a live demo. Enable BigQuery billing export
  once in the Console for label-level cost reviews (see `budget.tf` header).
</content>
