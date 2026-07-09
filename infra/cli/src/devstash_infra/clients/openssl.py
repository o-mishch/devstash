"""clients/openssl.py — a typed facade over the openssl CLI. CLI zone (3.14).

The local stack serves Valkey over in-transit TLS to mirror GCP Memorystore's SERVER_AUTHENTICATION,
so the app runs the SAME `rediss://` + REDIS_CA_CERT code path locally. That needs a throwaway
self-signed CA + a server cert signed by it, generated fresh each `up` (the cluster is disposable).
openssl has no Python surface we want, so it stays subprocess behind this facade; every generated
key/cert is written under a caller-owned temp dir that the caller removes. All three verbs raise — a
cert-gen failure must abort the bring-up before the Valkey pod starts.
"""

from pathlib import Path

from devstash_infra.shared import proc


class Openssl:
    """`openssl …` — the self-signed CA → server-CSR → signed-cert chain for the local TLS."""

    def self_signed_ca(self, *, key_out: Path, cert_out: Path, common_name: str, days: int) -> None:
        """`openssl req -x509 -newkey rsa:4096 …` — the root CA the app verifies against."""
        proc.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:4096",
                "-nodes",
                "-sha256",
                "-days",
                str(days),
                "-keyout",
                str(key_out),
                "-out",
                str(cert_out),
                "-subj",
                f"/CN={common_name}",
            ]
        )

    def server_csr(self, *, key_out: Path, csr_out: Path, config: Path) -> None:
        """`openssl req -newkey rsa:2048 … -config <cnf>` — server key + CSR (SANs from the cnf)."""
        proc.run(
            [
                "openssl",
                "req",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-sha256",
                "-keyout",
                str(key_out),
                "-out",
                str(csr_out),
                "-config",
                str(config),
            ]
        )

    def sign_csr(
        self,
        *,
        csr: Path,
        ca_cert: Path,
        ca_key: Path,
        config: Path,
        cert_out: Path,
        days: int,
    ) -> None:
        """`openssl x509 -req … -CA <ca> -CAkey <k> -extensions v3_req` — sign the CSR."""
        proc.run(
            [
                "openssl",
                "x509",
                "-req",
                "-in",
                str(csr),
                "-CA",
                str(ca_cert),
                "-CAkey",
                str(ca_key),
                "-CAcreateserial",
                "-sha256",
                "-days",
                str(days),
                "-extensions",
                "v3_req",
                "-extfile",
                str(config),
                "-out",
                str(cert_out),
            ]
        )
