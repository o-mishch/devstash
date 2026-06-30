# GCP hardening roadmap

Forward-looking production-readiness work for the GCP/GKE deployment. The current
stack is functional for a dev environment; the items below are the increments that take
it to production. Implementation rationale for the settings already in place lives in
the Terraform/manifest inline comments — this file is only the "what's next" backlog.

> 🎓 **Як учити (швидко).** Це forward-looking backlog (що далі до прод), не runbook.
> Поточну автоматизацію — bootstrap/apply/deploy/secrets — закриває
> [`infra/gcp-run/run.sh`](../gcp-run/run.sh) (див. [08-gcp-bootstrap.md](08-gcp-bootstrap.md)).
> 📚-концепти для співбесіди — у посиланнях наприкінці.

## Resolved issues

Issues found during bootstrap that were fixed in the codebase. Kept here for reference
so future AI/human reviewers don't retry the same wrong fixes.

| # | Issue | Root cause | Fix applied |
|---|---|---|---|
| R1 | `google_org_policy_policy` fails with `403 SERVICE_DISABLED` on every `tofu apply` despite API being enabled | v2 resource (`google_org_policy_policy`) calls `orgpolicy.googleapis.com` without `X-Goog-User-Project` header when using `authorized_user` ADC — confirmed provider bug [#18281](https://github.com/hashicorp/terraform-provider-google/issues/18281). `user_project_override = true` and `billing_project` in `providers.tf` do NOT fix it for this resource. | Replaced with v1 resource `google_project_organization_policy` (uses `cloudresourcemanager.googleapis.com`, which correctly respects user ADC). Added comment explaining the choice and the upgrade path back to v2 once #18281 is fixed. |
| R2 | `412 conditionNotMet` on `google_storage_hmac_key` immediately after org policy override applied | GCP org policy changes propagate eventually (can take minutes). `depends_on` in Terraform ensures apply order but adds no wall-clock delay. | No code fix — by design. Documented in `main.tf` comments and §11 of `08-gcp-bootstrap.md`. Re-running `tofu apply` a few minutes later always succeeds. |
| R3 | `cloudresourcemanager.googleapis.com` not pre-enabled, causing `403 accessNotConfigured` during bootstrap with `user_project_override = true` | API was absent from both the Terraform `google_project_service` list and the manual `gcloud services enable` block in `run.sh`. | Added `cloudresourcemanager.googleapis.com` to both `main.tf` and `run.sh`. |
| R4 | `EMAIL_FROM` stored in Secret Manager unnecessarily | Non-secret constant (per K8s design: ConfigMaps for non-confidential data, Secrets for credentials). ESO pulled it as a secret, wasting a Secret Manager entry and widening Secret RBAC blast radius. | Moved to `devstash-config` ConfigMap via `kustomization.yaml` `configMapGenerator` (GCP and local overlays). Removed from `third_party_secrets` map in `terraform.tfvars`. Promoted to a standalone `email_from` variable in `variables.tf` (non-sensitive, plainly typed). Removed from ESO `ExternalSecret`, `variables.tf` validation list, `secret.example.yaml`, `secret.local.yaml`, and `gcp-run/run.sh` secrets check. |
| R5 | GKE Autopilot cluster running 74+ minutes with all system pods stuck in `Pending` ("no nodes available to schedule") | GCP logged `ERROR: "enable_master_authorized_networks should be enabled if private endpoint is enabled"`. `master_authorized_networks_config` block was present but missing `private_endpoint_enforcement_enabled = true`. The provider does **not** accept a top-level `enabled` boolean (it causes "Unexpected attribute") — the block's presence implies `enabled = true`, but `private_endpoint_enforcement_enabled = true` is additionally required to satisfy the constraint. Without it, Autopilot refuses to provision any nodes. | Added `private_endpoint_enforcement_enabled = true` to `master_authorized_networks_config` in `modules/gke/main.tf`. Added detailed comment explaining why `enabled` is not a valid attribute and why `private_endpoint_enforcement_enabled` is the correct field. |
| R6 | Autopilot provisioned nodes but immediately deleted them (~9 min lifecycle); `kubectl get nodes` always empty | Compute Engine default SA (`{project_number}-compute@developer.gserviceaccount.com`) had **no IAM roles** on the project. Autopilot nodes boot as this SA and require `roles/container.defaultNodeServiceAccount` to register with the cluster control plane. Without it, nodes fail registration and Autopilot deletes them as unused. Diagnosed via Cloud Audit logs: `instances.insert` at 17:00 → `instances.delete` at 17:09. | Added `google_project_iam_member.compute_default_sa_node` in `modules/iam/main.tf` binding the default Compute Engine SA to `roles/container.defaultNodeServiceAccount`. Used `data.google_project.current` to derive the project number from `project_id` without hardcoding. |
| R8 | CI deploy fails at the **first `helm`/`kubectl` step** with `Error: Kubernetes cluster unreachable: <html> … Error 403 (Forbidden)!!1 … That's an error`, while the `get-gke-credentials` step stays **green** | The generic **Google HTML 403** page is a Google-Front-End rejection at the DNS endpoint. **Confirmed root cause:** the deployer's `roles/container.developer` binding carried an **IAM Condition** pinning `resource.name` to the cluster path (`projects/…/clusters/…`). Over the `*.gke.goog` DNS endpoint, `container.clusters.connect` is evaluated against the **DNS-endpoint resource, not the cluster-path resource**, so the condition never matched and the GFE returned the generic page (not a named-permission error). The creds step still succeeds because it reads the cluster over the always-on regional `container.googleapis.com` API, **not** the DNS endpoint — so green creds followed by a 403 on the first API call is the tell. (`allow_external_traffic` was already `true` and was **not** the cause.) | **Removed the IAM Condition** from `google_project_iam_member.deployer_gke` (`modules/iam/main.tf`, commit `a051ad7`) — verified: CI then reached the first helm/kubectl call. Do **NOT** re-add a cluster-`resource.name` condition to the deployer; the DNS endpoint cannot satisfy it. A fail-fast **`Verify control plane reachable (DNS endpoint)`** preflight in `deploy-gke.yml` surfaces this 403 early and names both gates to check. Keep `allow_external_traffic = true` (a separate prerequisite). |
| R9 | After R8, CI reaches `helm upgrade --install external-secrets` but it fails: `cannot patch "external-secrets-controller" … ClusterRole … requires ["container.clusterRoles.update"]` (likewise ClusterRoleBindings, Roles, RoleBindings, ValidatingWebhookConfigurations) | The system Helm charts (external-secrets, reloader) create/patch **cluster-scoped RBAC and webhook objects**. `roles/container.developer` grants `get`/`list` on these but **no `create`/`update`/`delete`**. Verified via `gcloud iam roles describe`: both `container.developer` **and** `container.clusterAdmin` lack `container.clusterRoles.update` et al.; only `roles/container.admin` includes them (plus `customResourceDefinitions.*`). | Bumped `google_project_iam_member.deployer_gke` to **`roles/container.admin`** (`modules/iam/main.tf`) — the narrowest **predefined** role that manages in-cluster RBAC. Do **NOT** "downgrade to `clusterAdmin` for least privilege" — it has zero in-cluster RBAC verbs and silently re-breaks this step. The only tighter option is a custom role with exactly those verbs; not worth the maintenance for this dedicated, WIF-locked-to-`main` SA, so project-level `container.admin` is the accepted scope. |
| R7 | After R6 fix, `kubectl get nodes` still returned empty; cluster autoscaler stuck at `scaleUp: NoActivity` for 2+ hours despite 11 kube-system pods in `Pending` | **By design:** GKE Autopilot's autoscaler only provisions nodes in response to **user workload pods**, not `kube-system` system pods. The `OPTIMIZE_UTILIZATION` autoscaling profile means the cluster idles at zero nodes when no user pods exist. The `kube-system` pods have `FailedScheduling` events but these do not trigger scale-up. After IAM was fixed (R6), Autopilot stopped attempting node provisioning; the autoscaler `lastTransitionTime` was frozen at the moment the last bad node was deleted. The cluster autoscaler status (`cluster-autoscaler-status` ConfigMap) showed `cloudProviderTarget: 0` for every node group — a confirmed no-op state. | Deploy a user pod with explicit CPU/memory requests to force autoscaler re-evaluation. A `pause` container is sufficient: `kubectl run trigger-node --image=gcr.io/google-containers/pause:3.9 --restart=Never --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":1001,"runAsGroup":1001,"fsGroup":1001,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"trigger-node","image":"gcr.io/google-containers/pause:3.9","resources":{"requests":{"cpu":"100m","memory":"128Mi"}},"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"seccompProfile":{"type":"RuntimeDefault"}}}]}}' -n default`. Within ~10s a `TriggeredScaleUp` event fires; within ~2–5 min a node reaches `Ready` and all kube-system pods transition to `Running`. Delete the trigger pod after the node is up. Documented in `08-gcp-bootstrap.md §7`. **Do NOT retry** if no node appears for 5+ minutes without a `TriggeredScaleUp` event — check IAM (R6) and cluster autoscaler status configmap first. |

## Known issues / watch items

| # | Issue | Status | Mitigation |
|---|---|---|---|
| K1 | `google_project_organization_policy` (v1) is less capable than v2 — no tag-based conditions, no dry-run mode | Active — using v1 as a workaround for provider bug #18281 | Switch to `google_org_policy_policy` (v2) once #18281 is fixed or when Terraform is authenticated as a SA (not user ADC). See comment in `main.tf`. |
| K2 | Operator secrets (Stripe, OAuth, etc.) visible in Terraform state | Active — see increment 5 below | State bucket has PAP + uniform access + no public access. Rotate secrets post-bootstrap. |
| K3 | Binary Authorization in `ALWAYS_ALLOW` mode (no attestation enforcement) | Active — see increment 3 below | API and provenance storage are wired; enforcement is the next step. |
| K4 | `kubernetes.io/ingress.class: "gce"` annotation is deprecated in upstream Kubernetes | Active — must keep; see below | GKE GCE Ingress controller **requires** the annotation; `spec.ingressClassName` is not supported by the GCE controller. The kubectl deprecation warning is a Kubernetes-generic warning; GKE docs say to ignore it. Do not "fix" this annotation. Source: [GKE Ingress docs](https://cloud.google.com/kubernetes-engine/docs/how-to/load-balance-ingress). |
| K5 | No container image in Artifact Registry — Deployment pods stay `Pending` | **Blocking** — pods cannot run without a real image | Trigger CI from `main` branch: `gh workflow run deploy-gke.yml --ref main` (WIF `attribute_condition` blocks auth from any other branch). CI builds + pushes the image and applies the overlay with a real digest. See `08-gcp-bootstrap.md` §9 (`run.sh deploy`). |
| K6 | DNS A-record `gke.devstash.one` → `8.232.44.235` not yet added | **Blocking** for TLS — `ManagedCertificate` stays `Provisioning` until DNS resolves | Add A-record in Spaceship DNS: Host=`gke`, Value=`8.232.44.235`, TTL=5 min. Cert becomes `Active` 15–60 min after global DNS propagation. See `08-gcp-bootstrap.md §7a`. |
| K7 | Stripe webhook endpoint not registered for GKE host | Active — billing events won't reach the GKE deploy | After DNS+cert are `Active`: create endpoint at `https://gke.devstash.one/api/webhooks/stripe` and update `devstash-stripe-webhook-secret` in Secret Manager. See `08-gcp-bootstrap.md §7c`. |
| K8 | OAuth redirect URIs for GKE host missing in GitHub + Google OAuth apps | Active — OAuth login fails with `redirect_uri_mismatch` | Add `https://gke.devstash.one/api/auth/callback/github` and `/google` to the respective OAuth apps. GitHub OAuth App supports only one callback — create a separate app for GKE if Vercel already occupies it. See `08-gcp-bootstrap.md §7d`. |

## Increments

1. **Observability alerts** — add Cloud Monitoring uptime, migration/rollout, SQL/Redis
   saturation, and billing alerts once owners, notification channels, and thresholds are
   chosen.
2. **Scope the deployer's RBAC** — move ESO/Reloader installation to a platform workflow
   and give the app deployer namespace-scoped RBAC. CI stays broad only while it installs
   cluster-scoped CRDs and webhooks.
3. **Enforce Binary Authorization** — provision an attestor, create native attestations
   for every image digest, then switch the cluster rule from `ALWAYS_ALLOW` to
   `REQUIRE_ATTESTATION`.
4. **Vulnerability gate** — add an Artifact Analysis severity gate plus an exception
   workflow. Enabling the API and storing provenance alone do not block vulnerable images.
5. **Get operator secrets out of Terraform state** — move operator-supplied secret
   versions out of state. Existing state is sensitive and must stay access-restricted
   until that migration lands.
6. **Test restore, not just backups** — run a Cloud SQL point-in-time restore drill.
   Configured backups are not a verified recovery capability until restoration is tested.
7. **Separate production from dev** — create distinct production configuration and state
   rather than renaming this dev environment in place.
8. **Production sizing & HA** — dev defaults to zonal Cloud SQL and BASIC Memorystore for
   cost. Production must enable the HA variables and use a production-sized SQL tier.
9. **Track the nodemailer advisory** — follow the upstream NextAuth `@auth/core` peer
   range so nodemailer can move beyond the audited 7.0.13 advisories. `npm audit
   --omit=dev` reports one high and three moderate findings with no compatible fix; the
   GCP flow does not configure NextAuth's email provider, but the dependency remains in
   the production tree.

## References

- [GKE Ingress configuration](https://cloud.google.com/kubernetes-engine/docs/how-to/ingress-configuration)
- [GKE Autopilot requests](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests)
- [GKE maintenance windows](https://cloud.google.com/kubernetes-engine/docs/how-to/maintenance-windows-and-exclusions)
- [GKE container-native load balancing](https://cloud.google.com/kubernetes-engine/docs/concepts/container-native-load-balancing)
- [Memorystore TLS connections](https://cloud.google.com/memorystore/docs/redis/manage-in-transit-encryption)
- [IAM condition resource attributes](https://cloud.google.com/iam/docs/conditions-resource-attributes)
- [Cloud Storage object IAM](https://cloud.google.com/storage/docs/access-control/iam-permissions)
- [Cloud Storage pricing/free regions](https://cloud.google.com/storage/pricing)
- [Terraform state in GCS](https://cloud.google.com/docs/terraform/resource-management/store-state)
- [Binary Authorization attestations](https://cloud.google.com/binary-authorization/docs/attestations)
- [Cloud Armor Adaptive Protection](https://cloud.google.com/armor/docs/adaptive-protection-overview)
- [External Secrets ownership/deletion](https://external-secrets.io/latest/api/externalsecret/)
- [Prisma production migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
