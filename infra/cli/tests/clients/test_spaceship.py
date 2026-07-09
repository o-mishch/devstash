"""Tests for clients/spaceship.py — transport behavior + the owned-client lifecycle.

httpx is fully encapsulated in Spaceship (no client injection); requests are intercepted with
pytest-httpx. Covers GET/PUT/DELETE status + body mapping, the network-error tolerance (a drop must
stay non-fatal — "" / 0, the shell's `curl … || true`), the auth headers, and the context-manager
contract that closes the owned connection pool on exit (the leak this fix was about).
"""

import httpx
from pytest_httpx import HTTPXMock

from devstash_infra.clients.spaceship import Spaceship

_BASE = "https://spaceship.dev/api/v1/dns/records"


class TestTransport:
    def test_get_returns_body_and_sends_auth(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(url=f"{_BASE}/zone", text="the-body")
        with Spaceship("k", "s") as ship:
            assert ship.get("zone") == "the-body"
        req = httpx_mock.get_request()
        assert req is not None
        assert req.headers["X-API-Key"] == "k"
        assert req.headers["X-API-Secret"] == "s"

    def test_get_returns_empty_on_transport_error(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_exception(httpx.ConnectError("boom"))
        with Spaceship("k", "s") as ship:
            assert ship.get("zone") == ""  # drop → "", never raises (the curl `|| true`)

    def test_write_returns_status_code(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(method="PUT", status_code=200)
        with Spaceship("k", "s") as ship:
            assert ship.write("PUT", "zone", {"force": True}) == 200

    def test_write_returns_zero_on_transport_error(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_exception(httpx.ConnectError("boom"))
        with Spaceship("k", "s") as ship:
            assert ship.write("DELETE", "zone", []) == 0  # drop → 0 (treated as non-2xx)


class TestLifecycle:
    def test_owned_client_is_closed_on_exit(self) -> None:
        with Spaceship("k", "s") as ship:
            client = ship._client  # pyright: ignore[reportPrivateUsage]  # asserting internal lifecycle
            assert not client.is_closed
        assert client.is_closed  # __exit__ closed the owned pool — no connection-pool leak
