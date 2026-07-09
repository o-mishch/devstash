"""Parity tests for gcp/dns.py — the Spaceship DNS reconciliation (dns.bats peer).

The `Dns` collaborator drives two seams, each faked with the project's established pattern:
- Spaceship        → a pure fake `Spaceship` (`_Api`: context manager + get/write) recording every
  call so we can assert method ORDER + bodies — the peer of dns.bats spying on curl by verb. No
  httpx here: Dns is tested for POLICY; Spaceship's transport is tested in test_spaceship.py.
- gcloud / tofu   → a `proc.run` monkeypatch router (`_route_proc`), since the Tofu client's
  `output_json`, `gcloud.compute.global_address` and `gcloud.secrets.access_blob` all bottom out
  in the one module-global run().

The dns.bats assertions map 1:1: cert-CNAME already-present / first-issuance /
delete-stale-before-put / delete-fails-still-puts / put-422-manual, plus update's
live-gcloud > tofu > override IP precedence. (The reserved-address read itself is asserted in
tests/clients/test_gcloud.py, since it is now `gcloud.compute.global_address`.)
"""

import json
from collections.abc import Sequence

import pytest

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.spaceship import Spaceship
from devstash_infra.clients.tofu import Tofu
from devstash_infra.environment import GcpConfig
from devstash_infra.gcp.dns import Dns
from devstash_infra.shared import proc
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import Result

# ── config + fixtures ─────────────────────────────────────────────────────────
_CONFIG = GcpConfig(project="proj", region="us-central1", environment="dev", db_name="devstash")
_ROOT = "devstash.one"
_CNAME_RECORD = "_acme-challenge.gke.devstash.one."
_TARGET_NEW = "tok-new.11.authorize.certificatemanager.goog."
_TARGET_OLD = "tok-old.9.authorize.certificatemanager.goog."
_OPS_BLOB = json.dumps({"spaceship-api-key": "k", "spaceship-api-secret": "s"})


# ── Spaceship HTTP fake ───────────────────────────────────────────────────────
class _Api:
    """A fake Spaceship (context manager + get/write) recording every call; serves a GET body +
    per-method status codes. Pure policy fake — no httpx (Spaceship's transport is tested apart).
    """

    def __init__(self, get_body: str = "", statuses: dict[str, int] | None = None) -> None:
        self._get_body = get_body
        self._statuses = statuses or {}
        self.calls: list[tuple[str, object]] = []  # (method, body); body is None for a GET

    def __enter__(self) -> _Api:
        return self

    def __exit__(self, *exc: object) -> None:
        pass

    def get(self, path: str) -> str:
        self.calls.append(("GET", None))
        return self._get_body

    def write(self, method: str, path: str, body: object) -> int:
        self.calls.append((method, body))
        return self._statuses.get(method, 204)

    @property
    def methods(self) -> list[str]:
        return [method for method, _ in self.calls]

    def body_of(self, method: str) -> object:
        """The body of the first request with `method` (or None)."""
        for recorded, body in self.calls:
            if recorded == method:
                return body
        return None


def _zone(*records: dict[str, str]) -> str:
    """A Spaceship zone GET body: {"items": [...]}."""
    return json.dumps({"items": list(records)})


def _cname(name: str, cname: str) -> dict[str, str]:
    return {"type": "CNAME", "name": name, "cname": cname}


# ── gcloud/tofu proc.run router ───────────────────────────────────────────────
def _route_proc(
    monkeypatch: pytest.MonkeyPatch,
    *,
    ingress: str | None = "",
    tofu_ingress: str = "1.1.1.1",
    app_domain: str = "gke.devstash.one",
    cname_record: str = _CNAME_RECORD,
    cname_target: str = _TARGET_NEW,
    ops_blob: str = _OPS_BLOB,
) -> list[list[str]]:
    """Route Tofu.out (tofu output -json), gcp_ingress_ip + access_secret_blob (gcloud).

    `ingress=None` makes the address describe FAIL (suspended env); "" makes it return empty.
    `tofu_ingress` is the ingress_ip_address tofu output (the last-resort IP fallback).
    Returns the recorded argv list so a test can assert what was invoked.
    """
    outputs = {
        "app_domain": {"value": app_domain},
        "ingress_ip_address": {"value": tofu_ingress},
        "dns_authorization_cname_record": {"value": cname_record},
        "dns_authorization_cname_target": {"value": cname_target},
    }
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        if args[0] == "tofu":
            return Result(args, json.dumps(outputs), "", 0)
        if "addresses" in args:  # gcp_ingress_ip
            if ingress is None:
                return Result(args, "", "not found", 1)
            return Result(args, ingress, "", 0)
        if "versions" in args and "list" in args:  # newest_enabled_secret_version
            return Result(args, "v1", "", 0)
        if "versions" in args and "access" in args:  # access_secret_blob payload
            return Result(args, ops_blob, "", 0)
        return Result(args, "", "", 1)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def _dns(api: _Api) -> Dns:
    """The collaborator under test: a factory returning the fake Spaceship. httpx never appears —
    Dns is tested for reconciliation POLICY; Spaceship's transport is tested separately.
    """

    def _make(key: str, secret: str) -> Spaceship:
        return api  # type: ignore[return-value]  # structural fake stands in for Spaceship

    return Dns(_CONFIG, Gcloud("proj"), Tofu("tf/dev"), make_spaceship=_make)


# ── update IP precedence ──────────────────────────────────────────────────────
class TestUpdateIpPrecedence:
    def test_prefers_live_gcloud_ip_over_tofu_output(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch, ingress="8.232.44.235")
        api = _Api(get_body=_zone(_cname("_acme-challenge.gke", _TARGET_NEW)))
        _dns(api).update()
        put = api.body_of("PUT")
        assert isinstance(put, dict)
        assert put["items"][0]["address"] == "8.232.44.235"

    def test_falls_back_to_tofu_output_when_gcloud_read_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _route_proc(monkeypatch, ingress=None)
        api = _Api(get_body=_zone(_cname("_acme-challenge.gke", _TARGET_NEW)))
        _dns(api).update()
        put = api.body_of("PUT")
        assert isinstance(put, dict)
        assert put["items"][0]["address"] == "1.1.1.1"

    def test_ingress_override_wins_over_live_gcloud(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch, ingress="8.232.44.235")
        api = _Api(get_body=_zone(_cname("_acme-challenge.gke", _TARGET_NEW)))
        _dns(api).update(ingress_ip_override="9.9.9.9")
        put = api.body_of("PUT")
        assert isinstance(put, dict)
        assert put["items"][0]["address"] == "9.9.9.9"

    def test_no_ip_available_skips_without_any_http(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # gcloud read fails AND tofu output is empty → skip, no Spaceship call.
        _route_proc(monkeypatch, ingress=None, tofu_ingress="")
        api = _Api()
        _dns(api).update()
        assert api.calls == []

    def test_missing_creds_warns_and_skips_http(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch, ingress="8.232.44.235", ops_blob="")  # empty ops blob → no creds
        api = _Api()
        _dns(api).update()
        assert api.calls == []


# ── update A-record replace (prune) ───────────────────────────────────────────
class TestUpdatePrune:
    def test_prunes_stale_a_record_then_reasserts(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch, ingress="8.232.44.235")
        # zone GET returns the cert CNAME (already present) + a STALE A-record at the host.
        api = _Api(
            get_body=json.dumps(
                {
                    "items": [
                        {"type": "A", "name": "gke", "address": "5.5.5.5"},
                        _cname("_acme-challenge.gke", _TARGET_NEW),
                    ]
                }
            )
        )
        _dns(api).update()
        assert "DELETE" in api.methods
        deleted = api.body_of("DELETE")
        assert isinstance(deleted, list)
        assert deleted[0]["address"] == "5.5.5.5"
        # PUT (upsert) → GET → DELETE (prune) → PUT (re-assert) → cert GET.
        assert api.methods.count("PUT") >= 2

    def test_no_stale_a_record_skips_delete(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch, ingress="8.232.44.235")
        api = _Api(
            get_body=json.dumps(
                {
                    "items": [
                        {"type": "A", "name": "gke", "address": "8.232.44.235"},  # already correct
                        _cname("_acme-challenge.gke", _TARGET_NEW),
                    ]
                }
            )
        )
        _dns(api).update()
        assert "DELETE" not in api.methods


# ── ensure_cert_cname [cert DNS-auth CNAME self-heal] ─────────────────────────
class TestEnsureCertCname:
    def test_outputs_unavailable_skips_without_api(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch, cname_record="", cname_target="")
        api = _Api()
        _dns(api).ensure_cert_cname(_ROOT, "k", "s")
        assert api.calls == []

    def test_correct_cname_present_get_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch)
        api = _Api(get_body=_zone(_cname("_acme-challenge.gke", _TARGET_NEW)))
        _dns(api).ensure_cert_cname(_ROOT, "k", "s")
        assert api.methods == ["GET"]

    def test_first_issuance_put_only_no_delete(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch)
        api = _Api(get_body=_zone())  # empty zone
        _dns(api).ensure_cert_cname(_ROOT, "k", "s")
        assert "DELETE" not in api.methods
        assert "PUT" in api.methods
        put = api.body_of("PUT")
        assert isinstance(put, dict)
        assert put["items"][0]["cname"] == _TARGET_NEW

    def test_stale_cname_deleted_before_put(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch)
        api = _Api(get_body=_zone(_cname("_acme-challenge.gke", _TARGET_OLD)))
        _dns(api).ensure_cert_cname(_ROOT, "k", "s")
        # DELETE must precede PUT — the whole point of the fix.
        assert api.methods.index("DELETE") < api.methods.index("PUT")
        deleted = api.body_of("DELETE")
        assert isinstance(deleted, list)
        assert deleted[0]["cname"] == _TARGET_OLD

    def test_delete_failure_still_attempts_put(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch)
        api = _Api(
            get_body=_zone(_cname("_acme-challenge.gke", _TARGET_OLD)), statuses={"DELETE": 500}
        )
        _dns(api).ensure_cert_cname(_ROOT, "k", "s")
        assert "PUT" in api.methods

    def test_put_422_warns_manual(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _route_proc(monkeypatch)
        api = _Api(get_body=_zone(), statuses={"PUT": 422})
        _dns(api).ensure_cert_cname(_ROOT, "k", "s")
        out = capsys.readouterr().out
        assert "422" in out
        assert _CNAME_RECORD in out


# ── dns_hint [post-apply display, no Spaceship] ───────────────────────────────
class TestDnsHint:
    def test_prints_a_record_with_live_ip_and_domain(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _route_proc(monkeypatch, ingress="8.232.44.235")
        api = _Api()
        _dns(api).dns_hint()
        out = capsys.readouterr().out
        # A-record line pairs the resolved domain with the live ingress IP; no Spaceship touched.
        assert "gke.devstash.one  →  8.232.44.235" in out
        assert "kubectl -n devstash get gateway devstash-web" in out
        assert api.calls == []

    def test_placeholders_when_ip_and_domain_absent(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _route_proc(monkeypatch, ingress=None, tofu_ingress="", app_domain="")
        _dns(_Api()).dns_hint()
        out = capsys.readouterr().out
        assert "<app_domain>" in out
        assert "<tofu output ingress_ip_address>" in out


# ── set_dns_creds [store the Spaceship creds blob] ────────────────────────────
class TestSetDnsCreds:
    def test_creates_secret_when_absent_then_adds_version(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: list[tuple[list[str], str | None]] = []

        def _fake_run(
            argv: Sequence[str], *, check: bool = True, input: str | None = None, **_: object
        ) -> Result:
            args = list(argv)
            seen.append((args, input))
            # `secrets describe` (the exists probe) fails → secret absent → create + add.
            if "describe" in args:
                return Result(args, "", "not found", 1)
            return Result(args, "", "", 0)

        monkeypatch.setattr(proc, "run", _fake_run)
        _dns(_Api()).set_dns_creds("mykey", "mysecret")

        verbs = [args for args, _ in seen]
        assert ["gcloud", "secrets", "describe", "devstash-ops-config", "--project=proj"] in verbs
        assert any(a[:3] == ["gcloud", "secrets", "create"] for a in verbs)
        # The version-add rides stdin as a JSON blob — creds never touch argv.
        add = next(
            (args, inp)
            for args, inp in seen
            if args[:4] == ["gcloud", "secrets", "versions", "add"]
        )
        assert add[1] is not None
        assert json.loads(add[1]) == {
            "spaceship-api-key": "mykey",
            "spaceship-api-secret": "mysecret",
        }

    def test_skips_create_when_secret_exists(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: list[list[str]] = []

        def _fake_run(argv: Sequence[str], *, check: bool = True, **_: object) -> Result:
            args = list(argv)
            seen.append(args)
            return Result(args, "", "", 0)  # describe succeeds → secret present

        monkeypatch.setattr(proc, "run", _fake_run)
        _dns(_Api()).set_dns_creds("k", "s")
        assert not any(a[:3] == ["gcloud", "secrets", "create"] for a in seen)

    def test_empty_cred_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _route_proc(monkeypatch)
        with pytest.raises(InfraError, match="both key and secret"):
            _dns(_Api()).set_dns_creds("k", "")
