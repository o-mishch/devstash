"""clients/ar.py — Artifact Registry writability probe + bounded wait [fix #12].

CLI zone (3.14). Ports common.sh:ds_ar_writable / ds_ar_wait as a typed client, mirroring
`clients/spaceship.py`: `ArtifactRegistry` OWNS the httpx client used for the `:testIamPermissions`
REST call and is a context manager, so `wait_until_writable`'s poll reuses ONE connection across all
attempts (and the pool is closed on exit). Use as `with ArtifactRegistry(...) as ar: ar.…()`.

[fix #12] Ask "can THE CALLER push to this repo" via the AR `:testIamPermissions`
REST API — NOT by matching the IAM policy against our own member. Under WIF the
`google-github-actions/auth` action writes ADC external_account creds and never
registers a gcloud account, so `gcloud config get-value account` returns EMPTY in CI;
the old member-match guard then failed on EVERY poll and the gate never cleared even
though the deployer SA genuinely had repoAdmin (the "attempt 40/40" hang). This port
never reads `config get-value account` at all — it only needs a caller token + the
REST call, so it works identically under WIF, direct SA keys, and local creds.
"""

import httpx

from devstash_infra.common import log, poll_until
from devstash_infra.shared import proc

_UPLOAD_PERMISSION = "artifactregistry.repositories.uploadArtifacts"
_HTTP_TIMEOUT = 10.0  # per-request AR API budget
_AR_WAIT_ATTEMPTS = 40  # AR_WAIT_ATTEMPTS default
_AR_WAIT_GAP = 15  # AR_WAIT_GAP default (seconds) → ~10 min envelope


class ArtifactRegistry:
    """Artifact Registry writability probe [fix #12].

    Owns the httpx client for the `:testIamPermissions` call — created internally (httpx stays off
    the public surface) and closed on exit. Use as a context manager so the poll's reused connection
    pool is released: `with ArtifactRegistry(region, project, repo) as ar: ar.writable()`.
    """

    def __init__(self, region: str, project: str, repo: str) -> None:
        self._region = region
        self._project = project
        self._repo = repo
        self._client = httpx.Client(timeout=_HTTP_TIMEOUT)

    def __enter__(self) -> ArtifactRegistry:
        return self

    def __exit__(self, *exc: object) -> None:
        self._client.close()  # release the connection pool reused across the poll

    def writable(self) -> bool:
        """True iff the AR repo EXISTS and the CALLER holds uploadArtifacts on it [fix #12].

        Guards the resume/first-apply race: the repo + the deployer's repo-scoped binding
        are count=environment_active — destroyed on suspend, RECREATED partway through the
        still-running apply. Pushing before the binding lands is the "denied: uploadArtifacts"
        failure this polls away. Checks in order:
          1. `repositories describe` succeeds — the repo has been recreated (else 404),
          2. a caller token exists (`auth print-access-token`),
          3. the caller has uploadArtifacts, asked via `:testIamPermissions`.
        Every failure returns False so the poll retries (tolerant-probe contract).
        """
        # 1. Repo recreated yet? A 404 → not yet; never probe IAM on an absent repo.
        if not proc.run_ok(
            [
                "gcloud",
                "artifacts",
                "repositories",
                "describe",
                self._repo,
                f"--project={self._project}",
                f"--location={self._region}",
            ]
        ):
            return False

        # 2. Caller token — minted from the SAME external_account creds the push will use.
        token_res = proc.run(["gcloud", "auth", "print-access-token"], check=False)
        token = token_res.out if token_res.ok else ""
        if not token:
            return False

        # 3. testIamPermissions: a granted permission is echoed back in `permissions`; a
        #    caller without it gets a 200 with the field omitted. A 4xx (repo/propagation
        #    not ready) also reads as not-writable, so the caller retries.
        url = (
            f"https://artifactregistry.googleapis.com/v1/projects/{self._project}"
            f"/locations/{self._region}/repositories/{self._repo}:testIamPermissions"
        )
        try:
            resp = self._client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json={"permissions": [_UPLOAD_PERMISSION]},
            )
        except httpx.HTTPError:
            return False

        if resp.status_code != 200:
            return False
        try:
            granted = resp.json().get("permissions", [])
        except ValueError:
            return False
        return _UPLOAD_PERMISSION in granted

    def wait_until_writable(
        self, *, attempts: int = _AR_WAIT_ATTEMPTS, gap_seconds: float = _AR_WAIT_GAP
    ) -> bool:
        """Block until `writable()` is true, bounded by attempts × gap (ds_ar_wait).

        Returns True the moment the deployer SA can push, False on timeout. IAM →
        Artifact Registry data-plane propagation is eventually consistent with NO event
        to block on, so a bounded poll is the honest primitive (common.sh:576).
        """

        def _msg(attempt: int, total: int) -> None:
            log(
                f"Artifact Registry '{self._repo}' not writable yet (attempt {attempt}/{total}) "
                f"— repo/IAM binding still propagating to the registry; waiting {gap_seconds}s…"
            )

        return poll_until(
            self.writable, attempts=attempts, gap_seconds=gap_seconds, on_attempt=_msg
        )
