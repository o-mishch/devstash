"""gcp/dns.py — Spaceship DNS reconciliation for the GCP deploy tooling.

Port of infra/run/gcp/lib/dns.sh. CLI zone (3.14). Re-architected onto the Python-native paradigm:
a `Dns` COLLABORATOR over `GcpConfig` + the typed `Gcloud`/`Tofu` clients and the `Spaceship` API
client (`clients/spaceship.py`). This module keeps only the reconciliation POLICY — it interprets
Spaceship's status codes and decides upsert-vs-prune; the transport lives in the client.

Two jobs, both idempotent + self-healing so a resume never hard-fails on DNS:

- `update`             — re-point the app's A-record at the current ingress IP. The IP is RELEASED
                         on suspend and re-allocated each resume, so this runs every resume.
                         REPLACE, never append: upsert the desired record, then DELETE every OTHER
                         A-record for the host, then re-assert — so two live A-records can never
                         round-robin resolvers onto a dead IP.
- `ensure_cert_cname`  — self-heal the Certificate Manager DNS-authorization CNAME. A stale CNAME
                         (prior dns_authorization token) makes Spaceship's PUT 422 ("CNAME with
                         host X already exists" — force:true does NOT override a same-type
                         collision, confirmed live 2026-07-07), so we delete the stale record by
                         exact (type,name,cname) BEFORE the PUT. Required for every ~60-day renewal,
                         not just first issuance — so it is upserted and never pruned.

Incident behavior preserved: the ops-config cred read resolves the newest ENABLED secret version
[fix #14] via `gcloud.secrets.access_blob`, never `access latest` (a stray DISABLED top version
would else FAILED_PRECONDITION and silently break the resume DNS re-point).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass

import typer

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.spaceship import Spaceship
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import DEVSTASH_NS as _NS
from devstash_infra.common import log, ok, warn
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.models.api import DnsZone
from devstash_infra.models.secrets_blob import OpsConfig
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.errors import InfraError

_OPS_SECRET = "devstash-ops-config"  # noqa: S105 — Secret Manager secret NAME, not a credential value
_TTL = 300  # short so a resume re-point is picked up quickly (matches dns.sh)

# Builds a Spaceship API client from resolved (key, secret). Production uses the `Spaceship` class
# itself (its httpx client is internal); a test passes a factory that injects a MockTransport client
# — so httpx never appears on the Dns surface (it is fully encapsulated in the Spaceship client).
type SpaceshipFactory = Callable[[str, str], Spaceship]


def _is_2xx(code: int) -> bool:
    """True for an HTTP 2xx status (the shell's `[[ "$code" =~ ^2 ]]`)."""
    return 200 <= code < 300


def _code_label(code: int) -> str:
    """Format a status for a warning — 0 (transport error) reads as `000`, like `${code:-000}`."""
    return f"{code:03d}" if code else "000"


def _a_record_body(sub: str, ip: str) -> dict[str, object]:
    """The desired-state A-record upsert payload — shared by the upsert + re-assert writes."""
    return {"force": True, "items": [{"type": "A", "name": sub, "address": ip, "ttl": _TTL}]}


def _cname_name(record: str, root: str) -> str:
    """Spaceship record name relative to the zone root: strip trailing dot + `.$root`.

    `_acme-challenge.gke.devstash.one.` → `_acme-challenge.gke` (dns.sh's
    `name="${record%.}"; name="${name%".$root"}"`).
    """
    name = record.removesuffix(".")
    suffix = f".{root}"
    return name.removesuffix(suffix)


def _cname_matches(record_cname: str | None, target: str) -> bool:
    """CNAME equality tolerant of a trailing dot (`$t` or `$t.`), as dns.sh's jq did."""
    return record_cname in (target, f"{target}.")


@dataclass(frozen=True)
class Dns:
    """Spaceship DNS reconciliation over the typed clients.

    `make_spaceship` builds the API client from resolved creds — it defaults to the `Spaceship`
    class (real httpx client) and a test overrides it to inject a MockTransport, so Dns holds no
    httpx detail. Env overrides (INGRESS_IP / SPACESHIP_API_KEY / _SECRET) arrive as method params —
    the app resolves them from the environment once.
    """

    config: GcpConfig
    gcloud: Gcloud
    tofu: Tofu
    make_spaceship: SpaceshipFactory = Spaceship

    def _resolve_ingress_ip(self, outputs: TofuOutputs, override: str) -> str:
        """IP resolution order: explicit override > live GCP read (authoritative) > tofu output.

        The live gcloud read wins over `tofu output` because tofu state can be stale/empty
        mid-migration while the reserved IP is still live in GCP (dns.bats context 2026-07-07).
        """
        # Short-circuit like the shell: the live GCP read only fires when no override is given.
        name = f"devstash-{self.config.environment}-ip"
        ip = (
            override
            or self.gcloud.compute.global_address(name)
            or outputs.value("ingress_ip_address")
        )
        return "" if ip == "null" else ip

    def _resolve_creds(self, key_override: str, secret_override: str) -> tuple[str, str]:
        """Spaceship API (key, secret): env overrides win, else the devstash-ops-config blob.

        The blob is read via the newest-ENABLED-version path [fix #14] (`secrets.access_blob`),
        NOT `access latest` — a stray DISABLED top version would else FAILED_PRECONDITION and
        silently break the resume DNS re-point.
        """
        ops = OpsConfig.from_blob(self.gcloud.secrets.access_blob(_OPS_SECRET))
        return (
            key_override or ops.spaceship_api_key,
            secret_override or ops.spaceship_api_secret,
        )

    def update(
        self,
        *,
        ingress_ip_override: str = "",
        key_override: str = "",
        secret_override: str = "",
    ) -> None:
        """Re-point the app's A-record at the current ingress IP via Spaceship. Best-effort.

        Ports `update_dns`. Never raises — DNS work stays non-fatal so a resume completes even if
        the registrar is unreachable; every failure warns with the manual remediation.
        """
        outputs = self.tofu.output_json()
        ip = self._resolve_ingress_ip(outputs, ingress_ip_override)
        if not ip:
            warn("no ingress IP available (environment suspended?) — skipping DNS update")
            warn("Pass one explicitly:  devstash-infra gcp update-dns --ingress-ip <ip>")
            return

        domain = outputs.value("app_domain")
        if not domain:
            warn("app_domain not set — skipping DNS update")
            return
        # gke.devstash.one → registered domain "devstash.one" (API path) + host label "gke".
        sub, root = domain.split(".", 1)

        key, secret = self._resolve_creds(key_override, secret_override)
        if not key or not secret:
            warn("Spaceship API creds not found (env SPACESHIP_API_KEY/SPACESHIP_API_SECRET or")
            warn("Secret Manager devstash-ops-config via 'gcp set-dns-creds').")
            warn(f"Update the A-record manually:  {domain}  →  {ip}")
            return

        log(f"Updating Spaceship DNS A-record: {domain} → {ip}")
        with self.make_spaceship(key, secret) as api:
            desired = _a_record_body(sub, ip)

            # 1) Upsert the desired record FIRST so the host is never left without an A-record
            #    even if the prune below fails. force:true is required — the stale record exists.
            code = api.write("PUT", root, desired)
            if not _is_2xx(code):
                warn(
                    f"Spaceship API returned HTTP {_code_label(code)} — "
                    f"set the A-record manually: {domain} → {ip}"
                )
                return

            self._prune_stale_a_records(api, root, sub, ip, desired)
            ok(f"DNS A-record updated ({domain} → {ip}). Allow a few minutes for propagation.")

        # Self-heal the one-time cert DNS-auth CNAME on every apply/resume (idempotent).
        self.ensure_cert_cname(root, key, secret)

    def _prune_stale_a_records(
        self, api: Spaceship, root: str, sub: str, ip: str, desired: dict[str, object]
    ) -> None:
        """DELETE every OTHER A-record for the host, then re-assert the desired one.

        Two live A-records for one host make resolvers round-robin onto the dead ingress IP
        (intermittent 502s). Best-effort: a prune miss is warned, never fatal. The final re-assert
        guarantees the zone ends with exactly `sub → ip` regardless of Spaceship's DELETE match
        semantics (see dns.sh step 3).
        """
        zone = DnsZone.parse(api.get(f"{root}?take=500&skip=0"))
        stale = [
            {"type": r.type, "name": r.name, "address": r.address}
            for r in zone.items
            if r.type == "A" and r.name == sub and r.address != ip
        ]
        if not stale:
            return

        addresses = ", ".join(str(r["address"]) for r in stale)
        log(f"Pruning stale {sub} A-record(s): {addresses}")
        del_code = api.write("DELETE", root, stale)
        if not _is_2xx(del_code):
            warn(
                f"Spaceship prune returned HTTP {_code_label(del_code)} — remove leftover "
                f"{sub} A-record(s) manually (Default Record Group entries may resist API delete)."
            )
        # Re-assert LAST so the final write is always the correct one.
        if not _is_2xx(api.write("PUT", root, desired)):
            warn(f"Spaceship re-assert returned non-2xx — verify the {sub} A-record manually.")

    def ensure_cert_cname(self, root: str, key: str, secret: str) -> None:
        """Idempotently upsert the Certificate Manager DNS-auth CNAME into the Spaceship zone.

        Ports `ensure_cert_cname`. Delete-stale-before-PUT is the incident fix: Spaceship
        hard-rejects a PUT over an existing same-name CNAME with 422 (force:true only disables the
        cross-type conflict checker, NOT same-type collisions — confirmed live 2026-07-07), which
        bites whenever the dns_authorization token changes. The A-record prune matches `type == "A"`
        only, so it never touches this CNAME. Best-effort — never raises.
        """
        outputs = self.tofu.output_json()
        record = outputs.value("dns_authorization_cname_record")  # _acme-challenge.gke.devstash.one
        target = outputs.value("dns_authorization_cname_target")  # <uuid>.<n>.…certmanager.goog
        if not record or record == "null" or not target or target == "null":
            warn("cert DNS-auth CNAME outputs unavailable — skipping (run 'apply' to surface them)")
            return
        name = _cname_name(record, root)

        with self.make_spaceship(key, secret) as api:
            zone = DnsZone.parse(api.get(f"{root}?take=500&skip=0"))

            # Skip the write if the correct CNAME already exists (common resume path).
            present = (
                r.type == "CNAME" and r.name == name and _cname_matches(r.cname, target)
                for r in zone.items
            )
            if any(present):
                ok(f"Cert DNS-auth CNAME already present ({name} → {target})")
                return

            # Any OTHER CNAME at this name is stale (a prior token) — delete first or the PUT 422s.
            stale = [
                {"type": r.type, "name": r.name, "cname": r.cname}
                for r in zone.items
                if r.type == "CNAME" and r.name == name and not _cname_matches(r.cname, target)
            ]
            if stale:
                cnames = ", ".join(str(r["cname"]) for r in stale)
                log(f"Removing stale cert DNS-auth CNAME(s) at {name}: {cnames}")
                del_code = api.write("DELETE", root, stale)
                if not _is_2xx(del_code):
                    warn(
                        f"Spaceship DELETE returned HTTP {_code_label(del_code)} "
                        "for stale cert CNAME(s) — the PUT below may still 422."
                    )

            log(f"Asserting cert DNS-auth CNAME: {name} → {target}")
            body = {
                "force": True,
                "items": [{"type": "CNAME", "name": name, "cname": target, "ttl": _TTL}],
            }
            code = api.write("PUT", root, body)
            if _is_2xx(code):
                ok(
                    "Cert DNS-auth CNAME asserted — Google provisions/renews the cert once it "
                    "resolves (~15-60 min first time)."
                )
            else:
                warn(
                    f"Spaceship API returned HTTP {_code_label(code)} for the cert CNAME — "
                    "add it manually:"
                )
                warn(f"  {record}  CNAME  {target}")

    def dns_hint(self) -> None:
        """Print the DNS A-record the operator must create after `apply`, plus reminders. Display.

        Ports `dns_hint` (no Spaceship write — pure post-apply guidance). TLS is served by the
        project-scoped Certificate Manager cert (envs/dev/certmanager.tf), pre-provisioned via a
        one-time DNS-auth CNAME that SURVIVES suspend — so once the A-record resolves to the
        Gateway IP, HTTPS works immediately (no per-resume cert wait). IP resolves live-GCP →
        tofu output, the same order as `update` (minus the manual override this display never has).
        """
        outputs = self.tofu.output_json()
        ip = self._resolve_ingress_ip(outputs, "")
        domain = outputs.value("app_domain")
        log(
            "DNS — point your subdomain at the Gateway static IP; the Certificate Manager cert "
            "is already provisioned"
        )
        dom = domain or "<app_domain>"
        ip_hint = ip or "<tofu output ingress_ip_address>"
        typer.echo(f"  Add an A-record:  {dom}  →  {ip_hint}")
        typer.echo(f"  Verify:           dig +short {domain or '<app_domain>'}")
        typer.echo(f"  Gateway status:   kubectl -n {_NS} get gateway devstash-web -o wide")
        typer.echo("  Cert status:      devstash-infra gcp status   # shows managed.state")
        warn("Do NOT repoint the apex/www (those serve prod on Vercel) — use the subdomain only.")
        warn("Also do §7c (Stripe webhook) + §7d (OAuth redirect URIs) in 08-gcp-bootstrap.md.")
        warn(
            "FIRST-TIME ONLY: the Google-managed cert provisions once (~15-60 min) after the "
            "DNS-auth CNAME resolves. That CNAME is asserted automatically by update-dns "
            "(self-healing) — no manual step. Once provisioned it persists across every "
            "suspend/resume — resume never waits on a cert."
        )

    def set_dns_creds(self, key: str, secret: str) -> None:
        """Store the Spaceship API key+secret as the consolidated devstash-ops-config JSON blob.

        Ports `set_dns_creds` (minus the run.sh-level `ensure_tfvars` preflight, which the app
        boundary owns). Both creds live as properties of ONE secret — matching the
        Terraform-managed devstash-ops-config the reader in `update` expects — and the blob is
        fed via stdin (`--data-file=-`) so values never touch the process arg list. Create the
        secret if absent, then add a version (re-run to rotate). Raises if either cred is empty
        (the shell's `die "both key and secret are required"`); the boundary reads them via
        `common.read_secret` (hidden, never echoed).
        """
        if not key or not secret:
            raise InfraError("both key and secret are required")
        log(
            "Storing Spaceship DNS API creds in the consolidated devstash-ops-config secret "
            f"(project {self.config.project})"
        )
        blob = json.dumps({"spaceship-api-key": key, "spaceship-api-secret": secret})
        if not self.gcloud.secrets.exists(_OPS_SECRET):
            self.gcloud.secrets.create(_OPS_SECRET)
        self.gcloud.secrets.add_version(_OPS_SECRET, blob)
        ok(
            "Spaceship DNS creds stored in devstash-ops-config. Rotate them in the Spaceship "
            "dashboard if they were ever shared in plaintext."
        )
