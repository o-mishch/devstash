"""models/helm.py — pydantic models for Helm JSON, CLI-only.

Parses the two Helm `--output json` / `-o json` shapes the deploy tooling reads:
  - `helm search repo <chart> --output json` → a list of chart entries (newest first); we want
    `[0].version` — the latest published chart version (upgrade_helm's update check).
  - `helm list -n <ns> -o json` → the installed releases; we want the `chart` string of a release
    that is currently `deployed` (the idempotency skip-guard: is <release> already at <chart>?).

Both tolerate an empty/absent result (`[]`) — a cluster with no matching chart or no release —
returning "" so the caller falls back (fetch-failed → die; not-installed → proceed with install).
"""

from pydantic import BaseModel, ConfigDict, RootModel


class HelmChartEntry(BaseModel):
    """One `helm search repo --output json` row — only its published chart `version` matters."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    version: str = ""


class HelmSearchResults(RootModel[list[HelmChartEntry]]):
    """The `helm search repo` array, newest chart first."""

    def latest_version(self) -> str:
        """The newest published chart version (`[0].version`), or "" on an empty result."""
        return self.root[0].version if self.root else ""


class HelmReleaseEntry(BaseModel):
    """One `helm list -o json` row: the release name, its status, and the installed chart."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    name: str = ""
    status: str = ""
    chart: str = ""


class HelmReleases(RootModel[list[HelmReleaseEntry]]):
    """The `helm list -o json` array of releases in one namespace."""

    def deployed_chart(self, release: str) -> str:
        """The chart of `release` iff it is `deployed` (e.g. "external-secrets-0.20.0"), else "".

        Mirrors helm_release_at_version's `jq '.[] | select(.name==$r and .status=="deployed")
        | .chart'` — a release that exists but is failed/pending-upgrade is NOT a match, so the
        installer re-runs rather than skipping over a broken release.
        """
        return next(
            (e.chart for e in self.root if e.name == release and e.status == "deployed"), ""
        )
