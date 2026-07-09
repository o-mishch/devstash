"""Tests for shared/secrets.py — newest-ENABLED secret resolution [fix #14].

secrets.sh has no standalone bats suite (it is exercised via callers), so these
assert the argv-parity + tolerant-empty contract directly, plus the fix #14
acceptance criterion (never `access latest`).
"""

from collections.abc import Callable

from devstash_infra.shared import secrets


class TestNewestEnabledSecretVersion:
    def test_fix_14_resolves_newest_enabled_never_access_latest(
        self, expect: Callable[..., None]
    ) -> None:
        """[fix #14] The version is resolved via `versions list` filtered to
        state:ENABLED, sorted ~createTime, limit 1 — NOT `access latest`.

        Source: posix/secrets.sh:13-16. `access latest` fails FAILED_PRECONDITION if
        the top version is DISABLED/DESTROYED (interrupted rotation), which unattended
        would block the whole suspend. The exact filter/sort argv is the assertion.
        """
        expect(
            [
                "gcloud",
                "secrets",
                "versions",
                "list",
                "my-secret",
                "--project=proj",
                "--filter=state:ENABLED",
                "--sort-by=~createTime",
                "--limit=1",
                "--format=value(name)",
            ],
            stdout="projects/p/secrets/my-secret/versions/7\n",
        )
        got = secrets.newest_enabled_secret_version("my-secret", "proj")
        assert got == "projects/p/secrets/my-secret/versions/7"

    def test_absent_secret_returns_empty_non_fatal(self, expect: Callable[..., None]) -> None:
        expect(
            [
                "gcloud",
                "secrets",
                "versions",
                "list",
                "gone",
                "--project=proj",
                "--filter=state:ENABLED",
                "--sort-by=~createTime",
                "--limit=1",
                "--format=value(name)",
            ],
            returncode=1,
            stderr="NOT_FOUND",
        )
        assert secrets.newest_enabled_secret_version("gone", "proj") == ""


class TestAccessSecretBlob:
    def test_accesses_resolved_version(self, expect: Callable[..., None]) -> None:
        expect(
            [
                "gcloud",
                "secrets",
                "versions",
                "list",
                "s",
                "--project=proj",
                "--filter=state:ENABLED",
                "--sort-by=~createTime",
                "--limit=1",
                "--format=value(name)",
            ],
            stdout="projects/p/secrets/s/versions/3\n",
        )
        expect(
            [
                "gcloud",
                "secrets",
                "versions",
                "access",
                "projects/p/secrets/s/versions/3",
                "--secret=s",
                "--project=proj",
            ],
            stdout='{"payload":"value"}\n',
        )
        assert secrets.access_secret_blob("s", "proj") == '{"payload":"value"}'

    def test_no_enabled_version_returns_empty_without_accessing(
        self, expect: Callable[..., None]
    ) -> None:
        # When resolution yields nothing, access is never attempted (tolerant).
        expect(
            [
                "gcloud",
                "secrets",
                "versions",
                "list",
                "s",
                "--project=proj",
                "--filter=state:ENABLED",
                "--sort-by=~createTime",
                "--limit=1",
                "--format=value(name)",
            ],
            stdout="",
        )
        assert secrets.access_secret_blob("s", "proj") == ""
