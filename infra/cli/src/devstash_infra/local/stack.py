"""local/stack.py — the kind-based local stack orchestrator. CLI zone (3.14).

Port of infra/run/local/run.sh: build the full local stack on kind and verify it, mirroring the GCP
CI deploy order (build images → apply infra → migrate gate → roll out web). The cloud analog is
`gcp/lifecycle.py`; this scales that lifecycle down to a single kind cluster. Every collaborator is
an injected typed client (docker/kind/kubectl/yq/openssl + the local-backend tofu) so the whole
orchestration tests with fakes — no real cluster, no docker, no openssl, no HTTP. `preflight` +
`build_stack` are the boundary helpers `local/app.py` calls, mirroring `gcp/context.py`.
"""

import shutil
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import typer

from devstash_infra.clients.docker import Docker
from devstash_infra.clients.health import deep_health_ok, deep_health_report
from devstash_infra.clients.kind import Kind
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.openssl import Openssl
from devstash_infra.clients.tofu_local import LocalTofu
from devstash_infra.clients.yq import Yq
from devstash_infra.common import DEVSTASH_NS as _NS
from devstash_infra.common import die, log, ok, require_kube_context, warn
from devstash_infra.job_gate import JobGate, wait_for_job_gate
from devstash_infra.paths import repo_path
from devstash_infra.shared.errors import InfraError

# ── coordinates (mirror run/local/run.sh's globals) ───────────────────────────
# Repo-anchored (see paths.py): humans run `devstash-infra local …` from infra/cli/, not repo root.
_HERE = repo_path("infra/local")  # local-dev asset dir (valkey cnf + kind tofu state live here)
_LOCAL_K8S = str(repo_path("infra/k8s/local"))  # backing-services kustomize base
_OVERLAY = str(repo_path("infra/k8s/overlays/local"))  # the app-under-test overlay
_TF_DIR = str(repo_path("infra/terraform/envs/local"))  # the kind-cluster tofu env
_TF_STATE = _HERE / ".tofu-state" / "local.tfstate"  # local-file backend state (gitignored)
_VALKEY_CNF = _HERE / "valkey-openssl.cnf"  # SANs + v3_req EKU for the server cert

_KIND_CLUSTER = "devstash"
_KIND_CONTEXT = "kind-devstash"
_CONTEXT_HINT = "run: kubectl config use-context kind-devstash"

_WEB_IMAGE = "devstash:local"
_MIGRATE_IMAGE = "devstash-migrate:local"
_MIGRATE_JOB = "devstash-migrate"
_MIGRATE_JOB_YAML = f"{_OVERLAY}/migrate-job-local.yaml"
_MIGRATE_DEADLINE_S = 300.0
_MIGRATE_LOG_TAIL = 30

_HEALTH_URL = "http://localhost:8080/api/health?deep=1"
_CA_CN = "devstash-local-valkey-ca"
_CERT_DAYS = 3650

# The dashboards (Headlamp + pgAdmin), by name — the one group held back until after the app rolls
# out. Slice 1 (data services) is the complement of this set; slice 2 (dashboards) is this set.
_DASHBOARD_NAMES = '["headlamp","headlamp-admin","pgadmin","pgadmin-config","pgadmin-seed-script"]'
_DASHBOARD_EXPR = f"(.metadata.name as $n | {_DASHBOARD_NAMES} | contains([$n]))"
_NON_DASHBOARD_EXPR = f"(.metadata.name as $n | {_DASHBOARD_NAMES} | contains([$n]) | not)"

# Data services to await before the migrate gate (resource → the rollout kind kubectl waits on).
_DATA_SERVICES = (
    "statefulset/postgres",
    "deploy/redis",
    "deploy/minio",
    "deploy/mailpit",
)

# preflight: every CLI the local stack drives + its install hint (run/local/run.sh:63).
_REQUIRED_CLIS = {
    "docker": "https://docs.docker.com/get-docker/",
    "kind": "https://kind.sigs.k8s.io/docs/user/quick-start/#installation",
    "tofu": "https://opentofu.org/docs/intro/install (or use terraform)",
    "kubectl": "https://kubernetes.io/docs/tasks/tools/",
    "yq": "brew install yq",
    "openssl": "brew install openssl",
    "curl": "https://curl.se/download.html",
    "jq": "brew install jq",
}

_INFO = f"""App:            http://localhost:8080
Cluster UI:     http://localhost:8090  (Headlamp)
  login token:  kubectl create token headlamp-admin -n headlamp
Postgres:       psql postgresql://devstash:devstash@localhost:55432/devstash
Postgres UI:    http://localhost:8978  (pgAdmin — login admin@devstash.dev/admin12345)
Mailpit UI:     http://localhost:8025  (captured emails)
MinIO console:  http://localhost:9001  (minioadmin/minioadmin)
Valkey:         kubectl -n {_NS} exec deploy/redis -- redis-cli --tls --cacert /tls/ca.crt  (TLS)
Billing (Pro):  OFFLINE — grant Pro with a signed fake webhook (no Stripe acct):
                STRIPE_WEBHOOK_SECRET=whsec_local_test \\
                  npx tsx infra/local/stripe-fake-webhook.ts <userId> [active|canceled]"""


# ── consumer-owned client seams (structural) ──────────────────────────────────
# Narrow protocols (ISP) declaring ONLY the methods LocalStack calls on each client, signatures
# matching the real clients exactly. The real `Docker`/`Kind`/`Kubectl`/`Yq`/`Openssl`/`LocalTofu`
# satisfy them by shape, so test fakes are plain classes — nothing subclasses a concrete client.
class _Docker(Protocol):
    """The `Docker` subset LocalStack drives — just the local image build."""

    def build(self, tag: str, *, target: str | None = None, context: str = ".") -> None: ...


class _Kind(Protocol):
    """The `Kind` subset LocalStack drives — cluster-presence probe + local-image load."""

    def cluster_names(self) -> list[str]: ...
    def load_image(self, image: str, *, cluster: str) -> None: ...


class _Kubectl(Protocol):
    """The `Kubectl` subset LocalStack drives (structural).

    A STRUCTURAL SUPERSET of `job_gate._Kubectl` (adds `job_condition`/`describe`) so
    `wait_for_job_gate(self.kubectl)` typechecks against the same instance.
    """

    def current_context(self) -> str: ...
    def ensure_namespace(self, namespace: str) -> None: ...
    def kustomize(self, directory: str) -> str: ...
    def apply_stdin(self, manifest: str, *, server_side: bool = False) -> None: ...
    def apply_file(self, path: str) -> None: ...
    def apply_secret_from_files(
        self, name: str, files: Mapping[str, str], *, namespace: str
    ) -> None: ...
    def delete_job(self, job: str, *, namespace: str) -> None: ...
    def rollout_status(self, resource: str, *, namespace: str, timeout: str) -> None: ...
    def rollout_restart(self, resource: str, *, namespace: str) -> None: ...
    def wait_condition(
        self, resource: str, condition: str, *, namespace: str, timeout: str
    ) -> bool: ...
    def get(
        self,
        target: str,
        *,
        namespace: str,
        output: str | None = None,
        sort_by: str | None = None,
        selector: str | None = None,
    ) -> str: ...
    def job_logs(self, job: str, *, namespace: str, tail: int) -> str: ...
    # ── job_gate._Kubectl superset (so wait_for_job_gate accepts this same instance) ──
    def job_condition(self, job: str, condition: str, *, namespace: str) -> str: ...
    def describe(self, resource: str, *, namespace: str) -> str: ...


class _Yq(Protocol):
    """The `Yq` subset LocalStack drives — the stdin-piped slice select."""

    def eval_stdin(
        self, expression: str, manifest: str, *, env_extra: Mapping[str, str] | None = None
    ) -> str: ...


class _Openssl(Protocol):
    """The `Openssl` subset LocalStack drives — the CA → server-CSR → sign chain."""

    def self_signed_ca(
        self, *, key_out: Path, cert_out: Path, common_name: str, days: int
    ) -> None: ...
    def server_csr(self, *, key_out: Path, csr_out: Path, config: Path) -> None: ...
    def sign_csr(
        self,
        *,
        csr: Path,
        ca_cert: Path,
        ca_key: Path,
        config: Path,
        cert_out: Path,
        days: int,
    ) -> None: ...


class _Tofu(Protocol):
    """The `LocalTofu` subset LocalStack drives — init/apply/destroy + the state probe."""

    @property
    def state_exists(self) -> bool: ...
    def init(self) -> None: ...
    def apply(self, *, cluster_active: bool) -> None: ...
    def destroy(self) -> None: ...


@dataclass(frozen=True)
class LocalStack:
    """The kind local-stack lifecycle over injected clients (up/deploy/status/info/down)."""

    docker: _Docker
    kind: _Kind
    kubectl: _Kubectl
    yq: _Yq
    openssl: _Openssl
    tofu: _Tofu
    health_report: Callable[[str], str] = deep_health_report
    health_ok: Callable[[str], bool] = deep_health_ok

    # ── public verbs ─────────────────────────────────────────────────────────
    def up(self) -> None:
        """Bring the whole stack up: cluster → images → services → migrate → app → verify."""
        # 1. Cluster (OpenTofu-provisioned, state-tracked). kind switches kubectl's context to
        #    kind-devstash as a side effect, so the guard runs AFTER cluster_up, never before.
        self._cluster_up()
        require_kube_context(self.kubectl.current_context(), _KIND_CONTEXT, _CONTEXT_HINT)

        # 2. Build + load images; 3. namespace; 3b. Valkey TLS (before the redis pod starts).
        self._build_and_load()
        self.kubectl.ensure_namespace(_NS)
        self._ensure_valkey_tls()

        # 4. Backing services (base minus dashboards); wait each ready before migrations.
        self._apply_slice(_LOCAL_K8S, _NON_DASHBOARD_EXPR)
        for resource in _DATA_SERVICES:
            self.kubectl.rollout_status(resource, namespace=_NS, timeout="120s")
        if not self.kubectl.wait_condition(
            "job/minio-bucket-init", "complete", namespace=_NS, timeout="120s"
        ):
            die("minio-bucket-init job did not complete within 120s")

        # 5. Apply overlay infra (everything except the Deployment) so the migrate Job can read
        #    the Secret; 6. migrate gate BEFORE the web Deployment; 7. roll out web post-migration.
        self._apply_slice(_OVERLAY, '.kind != "Deployment"', server_side=True)
        self._run_migrate()
        self._apply_slice(_OVERLAY, '.kind == "Deployment"', server_side=True)
        self.kubectl.rollout_status("deploy/devstash-web", namespace=_NS, timeout="180s")

        # 8. Dashboards (held back until post-app); 9. verify.
        self._apply_slice(_LOCAL_K8S, _DASHBOARD_EXPR)
        self.kubectl.rollout_status("deploy/headlamp", namespace="headlamp", timeout="120s")
        self.kubectl.rollout_status("deploy/pgadmin", namespace=_NS, timeout="120s")
        log("deep health (db + redis + s3 + email)")
        self._deep_health_check()
        self.info()

    def deploy(self) -> None:
        """Fast app-only iterate: rebuild + reload images, re-apply infra, migrate, roll out web."""
        self._require_kind_cluster()
        require_kube_context(self.kubectl.current_context(), _KIND_CONTEXT, _CONTEXT_HINT)
        self._build_and_load()
        self._apply_slice(_OVERLAY, '.kind != "Deployment"', server_side=True)
        self._run_migrate()
        self._apply_slice(_OVERLAY, '.kind == "Deployment"', server_side=True)
        self.kubectl.rollout_restart("deploy/devstash-web", namespace=_NS)
        self.kubectl.rollout_status("deploy/devstash-web", namespace=_NS, timeout="180s")
        log("deep health")
        self._deep_health_check()

    def status(self) -> None:
        """Print a cluster / app / health summary (requires a running kind cluster)."""
        self._require_kind_cluster()
        log(f"workloads (ns: {_NS})")
        typer.echo(self.kubectl.get("deploy,statefulset,job,svc,pdb,hpa", namespace=_NS))
        log("app pods")
        typer.echo(
            self.kubectl.get(
                "pods", namespace=_NS, output="wide", selector="app.kubernetes.io/name=devstash"
            )
        )
        log("deep health (db + redis + s3 + email)")
        self._deep_health_check()

    def down(self) -> None:
        """Tear down the kind cluster (state-tracked destroy)."""
        self._cluster_down()

    def info(self) -> None:
        """Print all local service URLs (app, Postgres, MinIO, Mailpit, Valkey, billing hint)."""
        typer.echo(_INFO)

    # ── helpers ──────────────────────────────────────────────────────────────
    def _require_kind_cluster(self) -> None:
        """Die unless the `devstash` kind cluster exists — a clear "run 'up' first" gate."""
        if _KIND_CLUSTER not in self.kind.cluster_names():
            die("no kind cluster — run 'up' first")

    def _build_and_load(self) -> None:
        """Build the web + migrator images and load both into kind (no registry pull needed)."""
        self.docker.build(_WEB_IMAGE)
        self.docker.build(_MIGRATE_IMAGE, target="migrator")
        self.kind.load_image(_WEB_IMAGE, cluster=_KIND_CLUSTER)
        self.kind.load_image(_MIGRATE_IMAGE, cluster=_KIND_CLUSTER)

    def _apply_slice(self, directory: str, expr: str, *, server_side: bool = False) -> None:
        """Render `directory`, keep the docs matching `expr`, and apply them (optionally SSA).

        The base up-flow stages data services BEFORE the migrate gate and dashboards AFTER; the
        overlay applies infra before the Job and the Deployment after — so both render once and
        apply complementary yq-selected slices through this one helper (kustomize | yq | apply).
        """
        rendered = self.kubectl.kustomize(directory)
        sliced = self.yq.eval_stdin(f"select({expr})", rendered)
        self.kubectl.apply_stdin(sliced, server_side=server_side)

    def _run_migrate(self) -> None:
        """Delete any prior migrate Job, apply the Job, and gate on its terminal condition.

        Wraps the SAME `wait_for_job_gate` the CI `run-migrations` step uses (300s here), so the two
        can't drift; a Failed/timed-out gate dumps diagnostics then `die`s with local wording.
        """
        log("running migrate job")
        self.kubectl.delete_job(_MIGRATE_JOB, namespace=_NS)
        self.kubectl.apply_file(_MIGRATE_JOB_YAML)
        gate = wait_for_job_gate(
            self.kubectl, namespace=_NS, job=_MIGRATE_JOB, deadline_s=_MIGRATE_DEADLINE_S
        )
        if gate is JobGate.FAILED:
            die("migrate job reached Failed condition")
        if gate is JobGate.TIMEOUT:
            die("migrate job did not complete within 300s")
        typer.echo(self.kubectl.job_logs(_MIGRATE_JOB, namespace=_NS, tail=_MIGRATE_LOG_TAIL))
        ok("migrate job complete")

    def _ensure_valkey_tls(self) -> None:
        """Generate a throwaway self-signed CA + cert and load them into the valkey-tls Secret.

        Mirrors GCP Memorystore's in-transit TLS so the app runs the same `rediss://` + REDIS_CA
        path locally. The temp dir holds the CA private key, so it is removed in a `finally` even if
        an openssl/kubectl step raises — no private-key material is left on disk (the shell's RETURN
        trap). Regenerated each `up`; the cluster is disposable, so rotation on rebuild is fine.
        """
        log("generating local Valkey TLS certs (self-signed, dev-only)")
        tmp = Path(tempfile.mkdtemp())
        try:
            ca_key, ca_crt = tmp / "ca.key", tmp / "ca.crt"
            tls_key, tls_csr, tls_crt = tmp / "tls.key", tmp / "tls.csr", tmp / "tls.crt"
            self.openssl.self_signed_ca(
                key_out=ca_key, cert_out=ca_crt, common_name=_CA_CN, days=_CERT_DAYS
            )
            self.openssl.server_csr(key_out=tls_key, csr_out=tls_csr, config=_VALKEY_CNF)
            self.openssl.sign_csr(
                csr=tls_csr,
                ca_cert=ca_crt,
                ca_key=ca_key,
                config=_VALKEY_CNF,
                cert_out=tls_crt,
                days=_CERT_DAYS,
            )
            self.kubectl.apply_secret_from_files(
                "valkey-tls",
                {"ca.crt": str(ca_crt), "tls.crt": str(tls_crt), "tls.key": str(tls_key)},
                namespace=_NS,
            )
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _deep_health_check(self) -> None:
        """Print the deep-health body AND warn if it doesn't report status=ok (200 ≠ healthy).

        HTTP 200 alone doesn't mean healthy — the endpoint can return 200 with {"status":"error"}
        while Postgres/Redis/MinIO is still coming up, and a human skimming the JSON could miss it.
        So print the body for the operator, then delegate the verdict to the shared health contract.
        """
        body = self.health_report(_HEALTH_URL)
        if not body:
            warn("app unreachable on :8080")
            return
        typer.echo(body)
        if not self.health_ok(_HEALTH_URL):
            warn("deep health check did not report status=ok — inspect the body above")

    def _cluster_up(self) -> None:
        """Provision the kind cluster via OpenTofu (init the backend, then apply active=true)."""
        _TF_STATE.parent.mkdir(parents=True, exist_ok=True)
        log("provisioning kind cluster via OpenTofu (envs/local)")
        self.tofu.init()
        self.tofu.apply(cluster_active=True)

    def _cluster_down(self) -> None:
        """Destroy the kind cluster via OpenTofu — a no-op warning when no state exists."""
        if not self.tofu.state_exists:
            warn("no local tofu state — nothing to destroy")
            return
        log("destroying kind cluster via OpenTofu (envs/local)")
        self.tofu.init()
        self.tofu.destroy()


def preflight() -> None:
    """Assert every CLI the local stack drives is on PATH, else raise with the install hint."""
    log("Preflight — required CLIs")
    missing = {name: hint for name, hint in _REQUIRED_CLIS.items() if shutil.which(name) is None}
    if missing:
        lines = "\n".join(f"  {name}: {hint}" for name, hint in missing.items())
        raise InfraError(f"missing required CLI(s):\n{lines}")
    ok("all CLIs present")


def build_stack() -> LocalStack:
    """Construct the `LocalStack` with the real clients — the boundary's factory."""
    return LocalStack(
        docker=Docker(),
        kind=Kind(),
        kubectl=Kubectl(),
        yq=Yq(),
        openssl=Openssl(),
        tofu=LocalTofu(_TF_DIR, _TF_STATE),
    )
