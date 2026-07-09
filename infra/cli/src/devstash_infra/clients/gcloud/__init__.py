"""clients/gcloud — a typed facade over the gcloud CLI, now a package. CLI zone (3.14).

`Gcloud` groups the CLI by service (`.auth`, `.config`, `.projects`, `.billing`, `.services`,
`.storage`, `.compute`, …), mirroring gcloud's own command tree so calls read like the tool. The
client is scoped to ONE project (the deploy target), so service facades that need it close over
`self._project` rather than making every caller repeat it.

Each method builds its argv (asserted in this client's tests — the argv-parity anchor) and picks
its error contract EXPLICITLY, replacing the shell's three implicit modes:

- a probe (`… && …` / `[ -n "$(…)" ]`) → a `bool` / value (via `proc.run_ok` / a tolerant read);
- a best-effort op (`… 2>/dev/null || true`) → catches `ProcError` internally and returns a
  tolerant value ("" / None), so tolerance is a VISIBLE method decision, not a buried `|| true`;
- a hard mutation → lets `ProcError` (an `InfraError`) propagate to the boundary.

Interactive flows (`auth login`, ADC login) run with `capture=False` so gcloud can drive the
browser/console the way the shell's un-redirected calls did.
"""

from devstash_infra.clients.gcloud._artifacts import _Artifacts
from devstash_infra.clients.gcloud._auth import _Auth
from devstash_infra.clients.gcloud._billing import _Billing
from devstash_infra.clients.gcloud._builds import _Builds
from devstash_infra.clients.gcloud._certmanager import _CertManager
from devstash_infra.clients.gcloud._compute import _Compute
from devstash_infra.clients.gcloud._config import _Config
from devstash_infra.clients.gcloud._container import _Container
from devstash_infra.clients.gcloud._iam import _Iam
from devstash_infra.clients.gcloud._memorystore import _Memorystore
from devstash_infra.clients.gcloud._projects import _Projects
from devstash_infra.clients.gcloud._quotas import _Quotas
from devstash_infra.clients.gcloud._secrets import _Secrets
from devstash_infra.clients.gcloud._services import _Services
from devstash_infra.clients.gcloud._sql import _Sql
from devstash_infra.clients.gcloud._storage import _Storage


class Gcloud:
    """The gcloud facade, scoped to one project: `gcloud.billing.link(acct)`, `gcloud.storage.…`."""

    def __init__(self, project: str) -> None:
        self._project = project
        self.auth = _Auth()
        self.config = _Config(project)
        self.projects = _Projects(project)
        self.billing = _Billing(project)
        self.services = _Services(project)
        self.secrets = _Secrets(project)
        self.sql = _Sql(project)
        self.quotas = _Quotas(project)
        self.container = _Container(project)
        self.memorystore = _Memorystore(project)
        self.artifacts = _Artifacts(project)
        self.iam = _Iam(project)
        self.storage = _Storage()
        self.compute = _Compute(project)
        self.certificate_manager = _CertManager(project)
        self.builds = _Builds(project)
