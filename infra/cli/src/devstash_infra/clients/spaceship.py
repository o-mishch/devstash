"""clients/spaceship.py — a typed client for the Spaceship DNS REST API. CLI zone (3.14).

The DNS records live at a third-party registrar (Spaceship) with no Terraform provider that can
express our reconciliation (the namecheap/spaceship provider rejects all non-literal address/cname
values), so we drive its REST API directly over httpx (banned in the stdlib-only floor, fine here).

This is transport ONLY — it owns the host, the auth headers, the httpx client, and the network-error
tolerance (a drop must stay non-fatal so DNS work never hard-fails a resume — the shell's
`curl … || true`), and returns raw bodies / HTTP status codes. Interpreting those codes (2xx? 422?
prune vs skip) is POLICY and lives with the caller (`gcp/dns.py`). httpx is FULLY encapsulated: it
never appears on this class's public signature — the client is created and owned internally, and
tests intercept it at the transport layer with pytest-httpx (no client injection). Use as a context
manager (`with Spaceship(key, secret) as ship: …`) so the owned connection pool is closed on exit.
"""

from collections.abc import Mapping, Sequence
from typing import Literal

import httpx

_API_BASE = "https://spaceship.dev/api/v1/dns/records"
_HTTP_TIMEOUT = 30.0  # per-request Spaceship API budget

# The two write verbs the DNS reconciliation uses (a GET has its own method). A `str` here would let
# a typo'd verb through to the wire; the Literal makes an unsupported method a type error.
type WriteMethod = Literal["PUT", "DELETE"]

# A Spaceship request/response JSON body: an upsert object, or a list of records to delete. Values
# stay `object` (bool/str/int/nested) — the shape is the registrar's, validated by its API.
type JsonBody = Mapping[str, object] | Sequence[Mapping[str, object]]


class Spaceship:
    """The single Spaceship DNS API entrypoint. Ports `spaceship_api`.

    The httpx client is created and owned internally — no client parameter, so httpx stays off
    the public surface. Use as a context manager so the owned connection pool is closed on exit.
    """

    def __init__(self, key: str, secret: str) -> None:
        self._headers = {
            "X-API-Key": key,
            "X-API-Secret": secret,
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(timeout=_HTTP_TIMEOUT)

    def __enter__(self) -> Spaceship:
        return self

    def __exit__(self, *exc: object) -> None:
        self._client.close()  # always ours to close — closes the connection pool

    def get(self, path: str) -> str:
        """GET → response body (the shell's GET branch echoes the body). "" on any drop."""
        try:
            return self._client.get(f"{_API_BASE}/{path}", headers=self._headers).text
        except httpx.HTTPError:
            return ""

    def write(self, method: WriteMethod, path: str, body: JsonBody) -> int:
        """PUT/DELETE → HTTP status code (the shell's `-w '%{http_code}'`). 0 on any drop."""
        try:
            response = self._client.request(
                method, f"{_API_BASE}/{path}", headers=self._headers, json=body
            )
        except httpx.HTTPError:
            return 0  # transport error → treated as `000`, non-2xx, warn-and-continue
        return response.status_code
