"""clients/helm.py — a typed facade over the Helm CLI. CLI zone (3.14).

Helm is a CLI with no Python surface we want (we keep argv control for parity), so this stays
subprocess behind a typed facade — one explicit method per used subcommand, argv built inline
(mirroring the `Gcloud`/`Tofu` clients). It owns the JSON parse of `search repo`/`list` via the
`models/helm.py` shapes, so callers get typed values, never raw json.

Error contract: `refresh_repo`'s add is TOLERANT (a re-add of an existing repo warns + exits
non-zero — benign); every other op raises `ProcError` on failure (the shell ran them under
`set -e`, so a failed `repo update`/`upgrade` aborts). The read probes (`latest_chart_version`,
`deployed_chart`) are tolerant — an empty/absent result is normal and returns "".
"""

from collections.abc import Mapping
from typing import Literal

from devstash_infra.models.helm import HelmReleases, HelmSearchResults
from devstash_infra.shared import proc

# The Helm on-failure flag. MUST default to "--atomic": ubuntu-latest ships Helm 3, which rejects
# "--rollback-on-failure" (local run.sh overrides via HELM_FAILURE_POLICY). Resolved from env by
# the ensure-* layer and passed in — the client just renders whichever was chosen (common.sh:431).
type HelmFailurePolicy = Literal["--atomic", "--rollback-on-failure"]


class Helm:
    """`helm …` — chart-repo registration + release install/query, all argv-exact."""

    def refresh_repo(self, name: str, url: str) -> None:
        """Register (idempotent) + refresh one chart repo — the `helm_repo` add+update pair.

        The add is tolerant (a re-add of an existing repo exits non-zero with an "already exists"
        warning — benign, ignored); the update RAISES on failure (a real repo error must surface).
        """
        proc.run(["helm", "repo", "add", name, url], check=False)
        proc.run(["helm", "repo", "update", name])

    def latest_chart_version(self, chart: str) -> str:
        """`helm search repo <chart> --output json` → the newest published version, or "".

        Tolerant: a chart the repo doesn't list yet (or a search miss) returns "" so the caller
        can `die "could not fetch latest … chart version"` explicitly rather than crash on parse.
        """
        result = proc.run(["helm", "search", "repo", chart, "--output", "json"], check=False)
        if not (result.ok and result.stdout.strip()):
            return ""
        return HelmSearchResults.model_validate_json(result.stdout).latest_version()

    def deployed_chart(self, release: str, *, namespace: str) -> str:
        """The `deployed` chart string of `release` in `namespace`, or "" (the skip-guard probe).

        Mirrors helm_release_at_version: only a release whose status is `deployed` matches, so a
        failed/pending release is treated as "not current" and the installer re-runs.
        """
        result = proc.run(["helm", "list", "-n", namespace, "-o", "json"], check=False)
        if not (result.ok and result.stdout.strip()):
            return ""
        return HelmReleases.model_validate_json(result.stdout).deployed_chart(release)

    def upgrade_install(
        self,
        release: str,
        chart: str,
        *,
        namespace: str,
        version: str,
        sets: Mapping[str, str],
        failure_policy: HelmFailurePolicy = "--atomic",
        timeout: str = "5m",
    ) -> None:
        """`helm upgrade --install … --wait --create-namespace <policy> --version <v> --set …`.

        The one-source-of-truth install both ensure-*.sh scripts run: pinned `--version`, the
        Autopilot 50m `--set` block (passed in as `sets`, insertion-ordered for argv-parity), and
        the failure policy. Raises `ProcError` on failure (the policy rolls the release back).
        """
        argv = [
            "helm",
            "upgrade",
            "--install",
            release,
            chart,
            "-n",
            namespace,
            "--create-namespace",
            "--wait",
            "--timeout",
            timeout,
            failure_policy,
            "--version",
            version,
        ]
        for key, value in sets.items():
            argv += ["--set", f"{key}={value}"]
        proc.run(argv)
