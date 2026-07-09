"""gcp/config.py — the immutable GCP deploy target value object.

CLI zone (3.14). `GcpConfig` lives in its own leaf module (importing nothing from the rest of the
package) so both `Environment` and the `gcp/` collaborators can depend on it without a cycle:
`Environment` now imports the collaborators (`Gke`, `Reconcile`), and they in turn need the config
type — a shared leaf breaks that knot.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class GcpConfig:
    """The immutable deploy target — the four run.sh identity globals + the state bucket."""

    project: str
    region: str
    environment: str
    db_name: str
    state_bucket: str = ""
