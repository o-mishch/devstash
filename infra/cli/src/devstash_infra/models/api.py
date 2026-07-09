"""models/api.py — external HTTP API JSON shapes, CLI-only (pydantic v2, httpx zone).

Currently the Spaceship DNS zone read (`GET /dns/records/{zone}`). Monitoring
(idle-count) and GitHub (lifecycle-dispatch) shapes fold in with their phases.

These parse UNTRUSTED remote JSON, so every model is `extra="ignore"` + tolerant:
`DnsZone.parse` degrades a transport error / malformed body to an EMPTY zone, which
makes the dns.py prune/precedence filters treat it as "nothing to reconcile" — the
same best-effort posture the shell had (`... 2>/dev/null || printf '[]'`).
"""

from pydantic import BaseModel, ConfigDict, ValidationError


class DnsRecord(BaseModel):
    """One Spaceship DNS record. `address` (A) and `cname` (CNAME) are per-type.

    Mirrors the jq object dns.sh built (`{type, name, address}` / `{type, name, cname}`)
    — a single model covers both because the API returns a heterogeneous `items` list
    and the filters select by `type` first.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    type: str = ""
    name: str = ""
    address: str | None = None
    cname: str | None = None
    ttl: int | None = None


class DnsZone(BaseModel):
    """The `GET /dns/records/{zone}` body: `{"items": [...]}` (missing → empty)."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    items: list[DnsRecord] = []

    @classmethod
    def parse(cls, payload: str) -> DnsZone:
        """Parse a zone body; an EMPTY zone on transport error / malformed JSON.

        Ports the shell's `jq ... 2>/dev/null || printf '[]'` tolerance: a prune/probe
        over an empty zone finds nothing, so a failed GET is a no-op, never a crash.
        """
        if not payload:
            return cls()
        try:
            return cls.model_validate_json(payload)
        except ValidationError:
            return cls()
