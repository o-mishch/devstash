"""ci/wait_secrets_sync.py — block until ESO materializes devstash-secrets, then classify.

CLI zone (3.14). Port of infra/ci/wait-secrets-sync.sh — the SOLE secret-readiness join in the
deploy pipeline. Re-nudge ESO every interval (its 1h refreshInterval means it will NOT re-read a
mid-bump version on its own) and condition-wait on the ExternalSecret's real `Ready` event. On
timeout, classify by ESO's OWN `reason=UpdateFailed` Kubernetes Event — NEVER by reading the
`devstash-app-config` payload, which the deployer SA (secretmanager.viewer, not secretAccessor)
cannot access anyway.

The classification is load-bearing (three prior outages):
  - a partially-populated blob (redis-*/database-* omitted while suspended/mid-resume) surfaces
    "does not exist in secret" → an EXPECTED parked state: warn, `synced=false`, exit 0 so the
    downstream migrate + rollout steps self-skip instead of failing on missing DB creds.
  - a still-DISABLED version after the FULL budget, a non-property failure, no event at all, or a
    kubectl error are REAL faults → raise (the boundary exits non-zero) so a broken producing apply
    is investigated, never silently greened.

`wait_for_sync` returns True (synced) / False (benign parked state) and RAISES `InfraError` on a
genuine fault; the entrypoint maps the bool to the `synced` step output.
"""

import time
from collections.abc import Callable

from devstash_infra.ci import actions
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.common import log
from devstash_infra.shared.errors import InfraError

ES = "devstash-secrets"  # the K8s Secret ESO materializes (migrate Job + web pods consume it)
SM_SECRET = "devstash-app-config"  # noqa: S105 — Secret Manager secret NAME, not a credential value
_UPDATE_FAILED = "UpdateFailed"  # ESO's failure Event reason
_MISSING_PROPERTY = "does not exist in secret"  # GCP provider: `key %s does not exist in secret %s`
_DISABLED_VERSION = "is in DISABLED state"

# GitHub-Actions ::warning:: shown for the benign parked state — names the fix so an operator
# reading the run log knows the deploy self-skipped on purpose, not silently broke.
_PARKED_WARNING = (
    f"'{ES}' is missing a property that '{SM_SECRET}' only populates once the env is fully "
    "active — the dev env is suspended or mid-resume (Terraform omits redis-*/database-* keys "
    "until then), so ESO cannot sync. Treating as an expected parked state and finishing without "
    "failing the build. Downstream migrate + rollout steps self-skip. Repopulate with: "
    "devstash-infra gcp resume (or a Terraform apply on the active env)."
)


def wait_for_sync(
    kubectl: Kubectl,
    *,
    namespace: str,
    timeout_s: int,
    nudge_interval_s: int,
    clock: Callable[[], float] = time.monotonic,
) -> bool:
    """Wait for `devstash-secrets` to sync, re-nudging ESO; True=synced, False=benign parked state.

    Raises `InfraError` on a genuine fault (see module docstring). `clock` is injected so tests
    drive the deadline without real waits.
    """
    log(
        f"Waiting up to {timeout_s}s for '{ES}' to sync, re-nudging ESO every {nudge_interval_s}s "
        "(its 1h refreshInterval means it will not re-read a mid-bump version on its own)…"
    )
    if _nudge_until_ready(kubectl, namespace, timeout_s, nudge_interval_s, clock):
        log(f"ExternalSecret '{ES}' is Ready — secrets synced.")
        return True
    return _classify_timeout(kubectl, namespace)


def _nudge_until_ready(
    kubectl: Kubectl,
    namespace: str,
    timeout_s: int,
    nudge_interval_s: int,
    clock: Callable[[], float],
) -> bool:
    """Re-annotate → condition-wait each interval until Ready or the overall budget is spent.

    Each annotation is a metadata write ESO reconciles on immediately, so a version enabled
    mid-loop is picked up within one interval — no manual `kubectl annotate`, no burning the whole
    budget against ESO's idle 1h latch (the regression this rewrite fixes).
    """
    deadline = clock() + timeout_s
    while True:
        # Best-effort nudge; a changing force-sync value forces an immediate ESO reconcile.
        kubectl.annotate(f"externalsecret/{ES}", "force-sync", str(clock()), namespace=namespace)
        if kubectl.wait_condition(
            f"externalsecret/{ES}", "Ready", namespace=namespace, timeout=f"{nudge_interval_s}s"
        ):
            return True
        if clock() >= deadline:  # a short final interval that would overrun is not started
            return False


def _classify_timeout(kubectl: Kubectl, namespace: str) -> bool:
    """Classify a not-Ready ExternalSecret by ESO's newest UpdateFailed Event. Raises on a fault."""
    log(f"ExternalSecret '{ES}' did not become Ready within the timeout — inspecting its events…")
    result = kubectl.newest_event_message(ES, _UPDATE_FAILED, namespace=namespace)
    if not result.ok:
        # A kubectl failure (RBAC denial, API unreachable) is a real error — never folded into
        # "no event found"; surface the real cause for whoever is debugging.
        raise InfraError(
            f"'{ES}': kubectl get events failed (rc={result.code}) — a real error, not a "
            f"suspended/mid-resume env.\n{result.stderr}"
        )

    events = result.stdout
    if not events:
        _dump_events(kubectl, namespace)
        raise InfraError(
            f"'{ES}' has no UpdateFailed events — a real error, not a suspended/mid-resume env."
        )

    if _MISSING_PROPERTY in events:
        actions.warning(_PARKED_WARNING)
        return False

    if _DISABLED_VERSION in events:
        _dump_events(kubectl, namespace)
        raise InfraError(
            f"'{ES}' is stuck on a DISABLED secret version after re-nudging ESO for the full "
            f"budget — no ENABLED '{SM_SECRET}' version materialized in time. A real error (the "
            "producing apply never enabled a new version), not a mid-resume race."
        )

    raise InfraError(
        f"'{ES}' failed to sync for a reason other than a missing infra property — a real error, "
        f"not a suspended/mid-resume env.\n{events}"
    )


def _dump_events(kubectl: Kubectl, namespace: str) -> None:
    """Log the `describe` Events: section for a loud-fail branch (best-effort diagnostic)."""
    described = kubectl.describe(f"externalsecret/{ES}", namespace=namespace)
    _, _, events = described.partition("Events:")
    if events:
        log(f"Events:{events}")
