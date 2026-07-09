"""ci/app.py — the `devstash-infra ci <step>` typer sub-app: the deploy-gke.yml boundary. CLI zone.

Each `deploy-gke.yml` `run:` step maps to one command here. A command is the THIN boundary the
ported step functions were designed for: read this step's specific env subset (via `ci/env.py`),
construct the clients it needs, run the pure step inside `runtime.guard()` (so an `InfraError` deep
in the step becomes a clean `::error::` + exit code, never a traceback), and — for the gate/build
steps — write the step's decision to `$GITHUB_OUTPUT`/`$GITHUB_ENV` so downstream `if:` guards see
it. There is no monolithic CiEnv: the workflow passes a different env subset to each step, so each
command reads exactly its own vars. The step functions hold the logic; this file holds no policy.
"""

from datetime import UTC, datetime

import typer

from devstash_infra.ci import actions, env
from devstash_infra.ci.apply_infra import apply_infra
from devstash_infra.ci.build_push import build_push
from devstash_infra.ci.check_env_active import check_env_active
from devstash_infra.ci.check_migrations import check_migrations
from devstash_infra.ci.decide_build import decide_build
from devstash_infra.ci.inject_settings import inject_settings
from devstash_infra.ci.operators import ensure_operators, helm_failure_policy
from devstash_infra.ci.prune_registry import prune_registry
from devstash_infra.ci.render_manifests import render_manifests
from devstash_infra.ci.rollout_web import rollout_web
from devstash_infra.ci.run_migrations import run_migrations
from devstash_infra.ci.sign_images import sign_images
from devstash_infra.ci.validate_inputs import validate_inputs
from devstash_infra.ci.verify_control_plane import verify_control_plane
from devstash_infra.ci.wait_endpoint import wait_endpoint
from devstash_infra.ci.wait_rollout import wait_rollout
from devstash_infra.ci.wait_secrets_sync import wait_for_sync
from devstash_infra.ci.wif_torn_down_skip import wif_torn_down_skip
from devstash_infra.clients.ar import ArtifactRegistry
from devstash_infra.clients.docker import Docker
from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.helm import Helm
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.runtime import guard
from devstash_infra.shared.proc import ProcError
from devstash_infra.versions import Versions

ci_app = typer.Typer(
    name="ci",
    help="Deploy-gke.yml CI steps (build, deploy, verify) as typed subcommands.",
    no_args_is_help=True,
    add_completion=False,
)

VERSIONS_ENV = env.OVERLAY_DIR.parent.parent.parent / "versions.env"  # infra/versions.env

# A step decision becomes the literal "true"/"false" a downstream `if:` output guard compares
# (`str(True).lower()` == "true"), exactly like the shell's `echo "build=true" >> $GITHUB_OUTPUT`.


# ── gate job: build/skip decisions ──────────────────────────────────────────
@ci_app.command("validate-inputs")
def cmd_validate_inputs() -> None:
    """Validate the required deployment inputs (+ all-or-nothing Binary Authorization)."""
    with guard():
        validate_inputs(
            project_id=env.require("GCP_PROJECT_ID"),
            wif_provider=env.require("WORKLOAD_IDENTITY_PROVIDER"),
            deployer_sa=env.require("DEPLOYER_SA"),
            app_domain=env.require("APP_DOMAIN"),
            binauthz_attestor=env.optional("BINAUTHZ_ATTESTOR"),
            binauthz_keyring=env.optional("BINAUTHZ_KMS_KEYRING"),
            binauthz_key=env.optional("BINAUTHZ_KMS_KEY"),
        )


@ci_app.command("wif-torn-down-skip")
def cmd_wif_torn_down_skip() -> None:
    """Green-with-warning skip when a full `down` soft-deleted the WIF pool backing CI auth."""
    with guard():
        actions.set_output("build", str(wif_torn_down_skip()).lower())


@ci_app.command("decide-build")
def cmd_decide_build() -> None:
    """Decide whether to build+push: provision short-circuits before the (loud) cluster probe."""
    with guard():
        reason = env.optional("DISPATCH_REASON")
        if reason == "provision":
            # A resume/up never needs the cluster probe (it is provisioning it right now).
            build = decide_build(dispatch_reason=reason, cluster_present=False)
        else:
            gcloud = Gcloud(env.require("GCP_PROJECT_ID"))
            present = gcloud.container.cluster_listed(
                env.require("CLUSTER"), region=env.require("REGION")
            )
            build = decide_build(dispatch_reason=reason, cluster_present=present)
        actions.set_output("build", str(build).lower())


@ci_app.command("check-env-active")
def cmd_check_env_active() -> None:
    """Poll for the cluster; report `suspended=true` iff it never appears within the window."""
    with guard():
        gcloud = Gcloud(env.require("GCP_PROJECT_ID"))
        cluster = env.require("CLUSTER")
        region = env.require("REGION")

        def probe() -> bool:
            # TOLERANT here (unlike decide-build's loud one-shot): this poll retries while a resume
            # provisions the cluster, so a transient gcloud/auth blip must not abort the wait — it
            # resolves to "not yet" and the window either catches the cluster or reports suspended.
            try:
                return gcloud.container.cluster_listed(cluster, region=region)
            except ProcError:
                return False

        suspended = check_env_active(
            probe,
            attempts=env.optional_int("CLUSTER_WAIT_ATTEMPTS", 40),
            gap_s=env.optional_int("CLUSTER_WAIT_GAP", 15),
        )
        actions.set_output("suspended", str(suspended).lower())


# ── build job ────────────────────────────────────────────────────────────────
@ci_app.command("build-push")
def cmd_build_push() -> None:
    """Gate on AR-writable, bake both images, export their digests to $GITHUB_ENV/$GITHUB_OUTPUT."""
    with guard():
        region = env.require("REGION")
        project = env.require("GCP_PROJECT_ID")
        repo = env.require("REPO")
        # `with`: ArtifactRegistry owns an httpx pool it closes on __exit__ — the sole production
        # consumer, so nothing else releases it (its docstring mandates context-manager use).
        with ArtifactRegistry(region, project, repo) as ar:
            result = build_push(
                ar,
                Docker(),
                region=region,
                project=project,
                repo=repo,
                image=env.require("IMAGE"),
                image_migrate=env.require("IMAGE_MIGRATE"),
                github_sha=env.require("GITHUB_SHA"),
                bake_file=env.BAKE_FILE,
                metadata_file=env.BAKE_METADATA,
            )
        # $GITHUB_ENV: later steps in THIS job (sign-images) read these as env.
        actions.set_env("IMAGE_URI", result.image_uri)
        actions.set_env("WEB_DIGEST", result.web_digest)
        actions.set_env("MIGRATE_IMAGE", result.migrate_image)
        # $GITHUB_OUTPUT: downstream JOBS (deploy) read these via needs.build.outputs.
        actions.set_output("web_image_name", result.image_uri)
        actions.set_output("web_digest", result.web_digest)
        actions.set_output("migrate_image_name", result.migrate_uri)
        actions.set_output("migrate_digest", result.migrate_digest)


@ci_app.command("sign-images")
def cmd_sign_images() -> None:
    """KMS-sign the web + migrate artifacts for Binary Authorization (hard-fails on error)."""
    with guard():
        sign_images(
            Gcloud(env.require("GCP_PROJECT_ID")),
            image_uri=env.require("IMAGE_URI"),
            web_digest=env.require("WEB_DIGEST"),
            migrate_image=env.require("MIGRATE_IMAGE"),
            attestor=env.require("BINAUTHZ_ATTESTOR"),
            keyring=env.require("BINAUTHZ_KMS_KEYRING"),
            key=env.require("BINAUTHZ_KMS_KEY"),
        )


@ci_app.command("check-migrations")
def cmd_check_migrations() -> None:
    """Pgfence migration-safety scan over every prisma migration.sql (hard-fails on risk)."""
    with guard():
        check_migrations(env.MIGRATIONS_ROOT)


# ── render job (overlaps the apply) ──────────────────────────────────────────
@ci_app.command("inject-settings")
def cmd_inject_settings() -> None:
    """Inject per-env values into the overlay's settings.yaml + pin the web image."""
    with guard():
        inject_settings(
            Yq(),
            overlay_dir=env.OVERLAY_DIR,
            project_id=env.require("GCP_PROJECT_ID"),
            app_domain=env.require("APP_DOMAIN"),
            email_from=env.require("EMAIL_FROM"),
            image_uri=env.require("IMAGE_URI"),
            web_digest=env.require("WEB_DIGEST"),
            armor_enabled=env.optional("ARMOR_ENABLED"),
            auth_github_id=env.optional("AUTH_GITHUB_ID"),
            auth_google_id=env.optional("AUTH_GOOGLE_ID"),
            stripe_publishable_key=env.optional("STRIPE_PUBLISHABLE_KEY"),
            stripe_price_id_monthly=env.optional("STRIPE_PRICE_ID_MONTHLY"),
            stripe_price_id_yearly=env.optional("STRIPE_PRICE_ID_YEARLY"),
        )


@ci_app.command("render-manifests")
def cmd_render_manifests() -> None:
    """Render the GCP overlay once to the shared rendered file (+ drop the empty armor policy)."""
    with guard():
        render_manifests(
            Kubectl(), Yq(), overlay_dir=env.OVERLAY_DIR, rendered_path=env.RENDERED_PATH
        )


# ── deploy job ───────────────────────────────────────────────────────────────
@ci_app.command("verify-control-plane")
def cmd_verify_control_plane() -> None:
    """Pre-Helm /readyz probe; raise on the 403 GFE drift signature, warn-skip if unreachable."""
    with guard():
        verify_control_plane(
            Kubectl(), cluster=env.require("CLUSTER"), region=env.require("REGION")
        )


@ci_app.command("ensure-operators")
def cmd_ensure_operators() -> None:
    """Install ESO ‖ Reloader concurrently (both must be up before apply-infra)."""
    with guard():
        ensure_operators(
            Versions.load(VERSIONS_ENV), helm=Helm(), failure_policy=helm_failure_policy()
        )


@ci_app.command("apply-infra")
def cmd_apply_infra() -> None:
    """SSA-apply everything except the web Deployment (after deleting the legacy Ingress stack)."""
    with guard():
        apply_infra(Kubectl(), Yq(), namespace=env.DEVSTASH_NS, rendered_path=env.RENDERED_PATH)


@ci_app.command("wait-secrets-sync")
def cmd_wait_secrets_sync() -> None:
    """The sole ESO secret-readiness join; report `synced=true|false` for downstream self-skip."""
    with guard():
        synced = wait_for_sync(
            Kubectl(),
            namespace=env.DEVSTASH_NS,
            timeout_s=env.optional_int("SECRET_SYNC_TIMEOUT", 900),
            nudge_interval_s=env.optional_int("SECRET_SYNC_NUDGE_INTERVAL", 30),
        )
        actions.set_output("synced", str(synced).lower())


@ci_app.command("run-migrations")
def cmd_run_migrations() -> None:
    """Apply the digest-pinned migrate Job and block on its gate (raise on Failed/timeout)."""
    with guard():
        run_migrations(
            Kubectl(),
            Yq(),
            namespace=env.DEVSTASH_NS,
            migrate_image=env.require("MIGRATE_IMAGE"),
            manifest_path=env.MIGRATE_MANIFEST,
        )


@ci_app.command("rollout-web")
def cmd_rollout_web() -> None:
    """Server-side apply the web Deployment (triggers the rolling update)."""
    with guard():
        rollout_web(Kubectl(), Yq(), rendered_path=env.RENDERED_PATH)


@ci_app.command("wait-rollout")
def cmd_wait_rollout() -> None:
    """Block on the web rollout; on failure dump per-pod crash logs and raise (no auto-rollback)."""
    with guard():
        wait_rollout(Kubectl(), namespace=env.DEVSTASH_NS)


@ci_app.command("wait-endpoint")
def cmd_wait_endpoint() -> None:
    """Poll the public /api/health?deep=1 URL until the L7 LB serves it (warn-skip if no domain)."""
    with guard():
        wait_endpoint(Kubectl(), app_domain=env.optional("APP_DOMAIN"), namespace=env.DEVSTASH_NS)


# ── post-deploy ──────────────────────────────────────────────────────────────
@ci_app.command("prune-registry")
def cmd_prune_registry() -> None:
    """Collapse every package in the repo to its just-deployed digest + children (best-effort)."""
    with guard():
        keep_digests = {
            name: digest
            for name, digest in (
                ("web", env.optional("WEB_DIGEST")),
                ("migrate", env.optional("MIGRATE_DIGEST")),
            )
            if digest
        }
        prune_registry(
            Gcloud(env.require("GCP_PROJECT_ID")),
            Docker(),
            region=env.require("REGION"),
            project=env.require("GCP_PROJECT_ID"),
            repo=env.require("REPO"),
            keep_digests=keep_digests,
            now=datetime.now(UTC),
        )
