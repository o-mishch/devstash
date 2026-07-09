"""ci/operators.py — install External Secrets Operator + Stakater Reloader (single source).

CLI zone (3.14). The one place the two cluster operators' chart / repo / --set / version-key are
defined — the port of `infra/ci/ensure-eso.sh`, `ensure-reloader.sh`, and `ensure-operators.sh`,
which existed to keep that definition single-sourced across CI and the run.sh `eso`/`reloader` path.
`gcp/gke.py`'s serial `eso()`/`reloader()` and the `ci ensure-operators` parallel entrypoint both
call `ensure_operator` here, so the chart/version/--set never diverges between the two paths.

The Autopilot 50m `--set` block is explicit (not the chart's 10m default) so Autopilot never
silently mutates the request and billing stays predictable — the insertion order is preserved for
argv-parity with the shell installers.
"""

import os
from collections.abc import Mapping
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from types import MappingProxyType

from devstash_infra.clients.helm import Helm, HelmFailurePolicy
from devstash_infra.common import log, ok
from devstash_infra.shared.errors import InfraError
from devstash_infra.versions import Versions

# The install --wait budget — one `helm upgrade --install … --wait --timeout 5m` per operator.
_TIMEOUT = "5m"
_ALLOWED_POLICIES: tuple[HelmFailurePolicy, ...] = ("--atomic", "--rollback-on-failure")


@dataclass(frozen=True)
class OperatorChart:
    """One operator's install spec — chart, repo, namespace, and the Autopilot --set block."""

    release: str
    namespace: str
    repo_name: str
    repo_url: str
    chart_ref: str  # "<repo>/<chart>" passed to `helm upgrade --install`
    label: str  # human name for the skip/install lines ("External Secrets Operator")
    sets: Mapping[str, str]

    @property
    def chart_name(self) -> str:
        """The chart half of `chart_ref` — the skip-guard compares `<chart_name>-<version>`."""
        return self.chart_ref.rsplit("/", 1)[-1]

    def expected_chart(self, version: str) -> str:
        """The deployed-chart string a current release reports (helm's `<chart>-<version>`)."""
        return f"{self.chart_name}-{version}"


ESO = OperatorChart(
    release="external-secrets",
    namespace="external-secrets",
    repo_name="external-secrets",
    repo_url="https://charts.external-secrets.io",
    chart_ref="external-secrets/external-secrets",
    label="External Secrets Operator",
    sets=MappingProxyType(
        {
            "resources.requests.cpu": "50m",
            "resources.requests.memory": "128Mi",
            "certController.resources.requests.cpu": "50m",
            "certController.resources.requests.memory": "128Mi",
            "webhook.resources.requests.cpu": "50m",
            "webhook.resources.requests.memory": "128Mi",
        }
    ),
)

RELOADER = OperatorChart(
    release="reloader",
    namespace="reloader",
    repo_name="stakater",
    repo_url="https://stakater.github.io/stakater-charts",
    chart_ref="stakater/reloader",
    label="Stakater Reloader",
    sets=MappingProxyType(
        {
            "reloader.deployment.resources.requests.cpu": "50m",
            "reloader.deployment.resources.requests.memory": "128Mi",
        }
    ),
)


def helm_failure_policy() -> HelmFailurePolicy:
    """The on-failure flag from `HELM_FAILURE_POLICY`, defaulting to `--atomic` (gke.sh policy).

    Defaults to `--atomic` (required by CI's Helm 3); local run.sh overrides to
    `--rollback-on-failure`. Anything else is rejected rather than passed blindly to helm — the
    argv stays a known-good Literal.
    """
    value = os.environ.get("HELM_FAILURE_POLICY") or "--atomic"
    for policy in _ALLOWED_POLICIES:
        if value == policy:
            return policy
    raise InfraError(
        f"HELM_FAILURE_POLICY must be --atomic or --rollback-on-failure, got {value!r}"
    )


def ensure_operator(
    chart: OperatorChart, version: str, *, helm: Helm, failure_policy: HelmFailurePolicy
) -> bool:
    """Install/upgrade one operator idempotently. Returns True if installed, False if skipped.

    Ports the ensure-*.sh body: skip if the release is already deployed at exactly this chart
    version (`helm_skip_if_current`), else refresh the repo (`helm_repo`) and
    `helm upgrade --install` with the pinned `--version` + the Autopilot `--set` block.
    """
    if helm.deployed_chart(chart.release, namespace=chart.namespace) == chart.expected_chart(
        version
    ):
        ok(f"{chart.label} version {version} is already installed. Skipping Helm upgrade.")
        return False

    log(f"Installing {chart.label} ({version})")
    helm.refresh_repo(chart.repo_name, chart.repo_url)
    helm.upgrade_install(
        chart.release,
        chart.chart_ref,
        namespace=chart.namespace,
        version=version,
        sets=chart.sets,
        failure_policy=failure_policy,
        timeout=_TIMEOUT,
    )
    return True


def ensure_operators(versions: Versions, *, helm: Helm, failure_policy: HelmFailurePolicy) -> None:
    """Install ESO ‖ Reloader CONCURRENTLY, joining on both — the port of ensure-operators.sh.

    The two installs are fully independent (different releases/namespaces/state), so they run in
    parallel to halve the ~10-min cold-cluster cost, and BOTH must finish before apply-infra (it
    applies the SecretStore/ExternalSecret whose CRDs ESO installs). Like the shell, it waits for
    both regardless of which fails first, then raises naming every operator that failed — so the
    second install is never left orphaned by an early abort.
    """
    log("Installing External Secrets Operator ‖ Stakater Reloader (parallel)")
    tasks = {
        ESO.label: partial(
            ensure_operator, ESO, versions.eso, helm=helm, failure_policy=failure_policy
        ),
        RELOADER.label: partial(
            ensure_operator, RELOADER, versions.reloader, helm=helm, failure_policy=failure_policy
        ),
    }
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures: dict[str, Future[bool]] = {name: pool.submit(fn) for name, fn in tasks.items()}

    failed = [name for name, future in futures.items() if future.exception() is not None]
    if failed:
        raise InfraError(f"operator install failed ({', '.join(failed)})")
    ok("ESO + Reloader installed; SecretStore/ExternalSecret CRDs available")
