"""versions.py — typed read/write of infra/versions.env (the pinned Helm chart versions).

CLI zone (3.14). `infra/versions.env` is a shell `KEY=VALUE` data file, the single source of truth
for the ESO + Reloader chart versions shared by the `ci/` ensure-* installers and the `gcp eso`/
`upgrade-helm` run.sh path. Kept as a data file (honors "no inline config in scripts"); this module
is the only place that parses/rewrites it, so both consumers see one shape.

`Versions.load` reads the two pinned values; `set_version` rewrites ONE key in place (the port of
gke.sh's `_set_versions_env` sed) — preserving every other line/comment verbatim so the file's
upgrade guidance survives an in-place bump.
"""

from dataclasses import dataclass
from pathlib import Path

ESO_KEY = "ESO_VERSION"
RELOADER_KEY = "RELOADER_VERSION"


@dataclass(frozen=True)
class Versions:
    """The pinned Helm chart versions from versions.env (ESO + Reloader)."""

    eso: str
    reloader: str

    @classmethod
    def load(cls, path: Path) -> Versions:
        """Parse `ESO_VERSION`/`RELOADER_VERSION` out of the shell `KEY=VALUE` data file."""
        values = dict(
            line.split("=", 1)
            for line in path.read_text().splitlines()
            if "=" in line and not line.lstrip().startswith("#")
        )
        return cls(
            eso=values.get(ESO_KEY, "").strip(), reloader=values.get(RELOADER_KEY, "").strip()
        )


def set_version(path: Path, key: str, value: str) -> None:
    """Rewrite the single `KEY=…` line in place, leaving every other line untouched.

    Ports `_set_versions_env` (the BSD/GNU-portable `sed -i` dance) as a line-wise rewrite — no
    subprocess, and comments/ordering are preserved so the file's inline upgrade notes survive.
    """
    prefix = f"{key}="
    lines = path.read_text().splitlines(keepends=True)
    path.write_text(
        "".join(f"{key}={value}\n" if line.startswith(prefix) else line for line in lines)
    )
