"""Tests for clients/ar.py — ArtifactRegistry writability probe + wait [fix #12].

Parity port of common.bats' ds_ar_writable / ds_ar_wait cases. gcloud calls are mocked via the
argv-parity harness (`expect`); the `:testIamPermissions` REST call is intercepted via pytest-httpx.
httpx is fully encapsulated in ArtifactRegistry (it owns its client), so the test never touches a
client — it registers responses and inspects the requests the internally-owned client actually sent.
"""

from pytest_httpx import HTTPXMock
from tests.conftest import ExpectFn

from devstash_infra.clients.ar import ArtifactRegistry

_DESCRIBE = [
    "gcloud",
    "artifacts",
    "repositories",
    "describe",
    "repo",
    "--project=proj",
    "--location=us-central1",
]
_TOKEN = ["gcloud", "auth", "print-access-token"]
_UPLOAD = "artifactregistry.repositories.uploadArtifacts"
_IAM_URL = (
    "https://artifactregistry.googleapis.com/v1/projects/proj"
    "/locations/us-central1/repositories/repo:testIamPermissions"
)


def _registry() -> ArtifactRegistry:
    return ArtifactRegistry("us-central1", "proj", "repo")


class TestWritable:
    def test_fix_12_caller_has_permission_writable(
        self, expect: ExpectFn, httpx_mock: HTTPXMock
    ) -> None:
        """[fix #12] The permission is echoed back → writable, decided via
        testIamPermissions (not a member-string match).
        """
        expect(_DESCRIBE, stdout="repo exists")
        expect(_TOKEN, stdout="ya29.token\n")
        httpx_mock.add_response(url=_IAM_URL, method="POST", json={"permissions": [_UPLOAD]})
        with _registry() as reg:
            assert reg.writable() is True
        # request-parity: the caller token + the permissions body reached the API.
        req = httpx_mock.get_request()
        assert req is not None
        assert req.headers["Authorization"] == "Bearer ya29.token"

    def test_fix_12_caller_lacks_permission_not_writable(
        self, expect: ExpectFn, httpx_mock: HTTPXMock
    ) -> None:
        expect(_DESCRIBE, stdout="repo exists")
        expect(_TOKEN, stdout="ya29.token\n")
        httpx_mock.add_response(json={})  # permission omitted → caller lacks it
        with _registry() as reg:
            assert reg.writable() is False

    def test_fix_12_repo_404_not_writable_never_probes_iam(
        self, expect: ExpectFn, httpx_mock: HTTPXMock
    ) -> None:
        # describe 404 → not writable, and the IAM probe (token/HTTP) is never reached: no
        # response is registered, so any HTTP call would make pytest-httpx raise.
        expect(_DESCRIBE, returncode=1, stderr="NOT_FOUND")
        with _registry() as reg:
            assert reg.writable() is False
        assert httpx_mock.get_requests() == []

    def test_fix_12_no_token_not_writable(self, expect: ExpectFn, httpx_mock: HTTPXMock) -> None:
        expect(_DESCRIBE, stdout="repo exists")
        expect(_TOKEN, stdout="")  # print-access-token empty
        with _registry() as reg:
            assert reg.writable() is False
        assert httpx_mock.get_requests() == []

    def test_fix_12_writable_under_wif_empty_account(
        self, expect: ExpectFn, httpx_mock: HTTPXMock
    ) -> None:
        """[fix #12] The WIF regression: writability NEVER consults
        `gcloud config get-value account` (empty under WIF) — only a token + the REST
        call. So a caller with no configured gcloud account is still writable.
        """
        expect(_DESCRIBE, stdout="repo exists")
        expect(_TOKEN, stdout="ya29.wif-token\n")
        # No `config get-value account` is ever registered — if the code called it,
        # the argv-parity harness would raise on an unregistered process.
        httpx_mock.add_response(json={"permissions": [_UPLOAD]})
        with _registry() as reg:
            assert reg.writable() is True

    def test_4xx_response_not_writable(self, expect: ExpectFn, httpx_mock: HTTPXMock) -> None:
        expect(_DESCRIBE, stdout="repo exists")
        expect(_TOKEN, stdout="ya29.token\n")
        httpx_mock.add_response(status_code=403, json={"error": "propagating"})
        with _registry() as reg:
            assert reg.writable() is False


class TestWaitUntilWritable:
    def test_returns_true_when_writable_on_attempt_1(
        self, expect: ExpectFn, httpx_mock: HTTPXMock
    ) -> None:
        expect(_DESCRIBE, stdout="repo exists")
        expect(_TOKEN, stdout="ya29.token\n")
        httpx_mock.add_response(json={"permissions": [_UPLOAD]})
        with _registry() as reg:
            assert reg.wait_until_writable(attempts=3, gap_seconds=0) is True

    def test_gives_up_after_attempts_when_never_writable(
        self, expect: ExpectFn, httpx_mock: HTTPXMock
    ) -> None:
        # Never writable (repo stays 404) → bounded, returns False after `attempts`; the repo
        # 404 short-circuits before any HTTP, so no response is registered.
        expect(_DESCRIBE, returncode=1, stderr="NOT_FOUND", occurrences=3)
        with _registry() as reg:
            assert reg.wait_until_writable(attempts=3, gap_seconds=0) is False
        assert httpx_mock.get_requests() == []
