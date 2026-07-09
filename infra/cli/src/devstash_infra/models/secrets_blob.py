"""models/secrets_blob.py — the consolidated Secret Manager JSON blobs, CLI-only.

pydantic v2 wrappers over the two aggregate secrets the tooling reads:
- `devstash-ops-config` — the Spaceship DNS API creds (OpsConfig), read by gcp/dns.
- `devstash-app-config`  — the app's third-party secret bundle (AppConfig), folded in
  when the app phase lands.

The canonical, stdlib-only splitter that the Cloud Build `prepare` step needs lives in
`shared/` (per the "canonical parse in shared/, pydantic wraps it" rule); these models
are the CLI-side view constructed from the SAME payload, never the reverse. Tolerant by
design — a missing/absent property yields "" so a partially-populated blob degrades to
the warn-and-skip paths the shell had, never a hard parse failure.
"""

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class OpsConfig(BaseModel):
    """The `devstash-ops-config` blob: Spaceship DNS API key + secret.

    Property names carry hyphens (`spaceship-api-key`) — the exact jq paths dns.sh
    read (`."spaceship-api-key" // empty`), mapped via Field aliases. `from_blob`
    tolerates an empty/malformed payload (absent or suspended secret) → both creds
    "", so update_dns falls through to its manual-hint warning instead of crashing.
    """

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    spaceship_api_key: str = Field(default="", alias="spaceship-api-key")
    spaceship_api_secret: str = Field(default="", alias="spaceship-api-secret")

    @classmethod
    def from_blob(cls, payload: str) -> OpsConfig:
        """Parse the raw secret payload; empty creds on absent/invalid JSON (tolerant)."""
        if not payload:
            return cls()
        try:
            return cls.model_validate_json(payload)
        except ValidationError:
            return cls()
