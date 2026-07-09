"""Tests for clients/openssl.py — argv-parity for the CA → CSR → sign chain (Paths stringified)."""

from collections.abc import Sequence
from pathlib import Path

import pytest

from devstash_infra.clients.openssl import Openssl
from devstash_infra.shared import proc
from devstash_infra.shared.proc import Result


def _route(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    calls: list[list[str]] = []

    def _fake_run(argv: Sequence[str], **_: object) -> Result:
        args = list(argv)
        calls.append(args)
        return Result(args, "", "", 0)

    monkeypatch.setattr(proc, "run", _fake_run)
    return calls


def test_self_signed_ca_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Openssl().self_signed_ca(
        key_out=Path("/work/ca.key"), cert_out=Path("/work/ca.crt"), common_name="my-ca", days=3650
    )
    assert calls == [
        [
            "openssl", "req", "-x509", "-newkey", "rsa:4096", "-nodes", "-sha256",
            "-days", "3650", "-keyout", "/work/ca.key", "-out", "/work/ca.crt",
            "-subj", "/CN=my-ca",
        ]
    ]  # fmt: skip


def test_server_csr_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Openssl().server_csr(
        key_out=Path("/work/tls.key"), csr_out=Path("/work/tls.csr"), config=Path("/cnf")
    )
    assert calls == [
        [
            "openssl", "req", "-newkey", "rsa:2048", "-nodes", "-sha256",
            "-keyout", "/work/tls.key", "-out", "/work/tls.csr", "-config", "/cnf",
        ]
    ]  # fmt: skip


def test_sign_csr_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _route(monkeypatch)
    Openssl().sign_csr(
        csr=Path("/work/tls.csr"),
        ca_cert=Path("/work/ca.crt"),
        ca_key=Path("/work/ca.key"),
        config=Path("/cnf"),
        cert_out=Path("/work/tls.crt"),
        days=3650,
    )
    assert calls == [
        [
            "openssl", "x509", "-req", "-in", "/work/tls.csr", "-CA", "/work/ca.crt",
            "-CAkey", "/work/ca.key", "-CAcreateserial", "-sha256", "-days", "3650",
            "-extensions", "v3_req", "-extfile", "/cnf", "-out", "/work/tls.crt",
        ]
    ]  # fmt: skip
