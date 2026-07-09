"""models/tofu.py — pydantic models for OpenTofu-emitted JSON, CLI-only.

Two shapes live here, both OpenTofu-emitted JSON: `TofuOutputs`/`TofuOutputValue` parse
`tofu output -json`, and `TfLock` parses the `.tflock` state-lock blob the `unlock` recovery reads.

The `tofu output -json` path (never `-raw`) is the whole point of
incident fix #2: on a state with NO outputs, `tofu output -raw X` prints its
"No outputs found" warning box to STDOUT and still exits 0 (hashicorp/terraform
#26991), so the box gets consumed AS the value; `-json` prints `{}` on empty state,
which parses cleanly to the fallback.
"""

from pydantic import BaseModel, ConfigDict, Field, RootModel


class TfLock(BaseModel):
    """The `.tflock` state-lock JSON — display fields for the interactive `unlock` recovery.

    `ID` is the internal UUID (display-only — the gcs backend force-unlocks by the object
    GENERATION, not this value [#1]); `Who` is `user@host` (the host half selects the local-PID
    probe). All fields optional/tolerant so a partial blob still parses for display.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str = Field(default="", alias="ID")
    operation: str = Field(default="", alias="Operation")
    who: str = Field(default="", alias="Who")
    created: str = Field(default="", alias="Created")

    @property
    def host(self) -> str:
        """The host half of `Who` (`user@host` → `host`) — the local-PID probe's match key."""
        return self.who.rsplit("@", 1)[-1] if self.who else ""


class TofuOutputValue(BaseModel):
    """One entry of `tofu output -json`: {"value": ..., "type": ..., "sensitive": bool}."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    value: object = None
    sensitive: bool = False


class TofuOutputs(RootModel[dict[str, TofuOutputValue]]):
    """The whole `tofu output -json` object, keyed by output name.

    `{}` (empty state) parses to an empty mapping — the fresh/destroyed/suspended
    case, where every `value()` returns its fallback [fix #2].
    """

    def value(self, name: str, fallback: str = "") -> str:
        """The named output's value as a string, or `fallback` if absent / null.

        Mirrors tf_out's `(.[$k]?.value // $fb) | tostring`: a missing key OR a JSON
        null yields the fallback; any present value is stringified.
        """
        entry = self.root.get(name)
        if entry is None or entry.value is None:
            return fallback
        return str(entry.value)

    def missing(self, *names: str) -> list[str]:
        """Names whose output is absent or empty — the require_outputs gate input."""
        return [name for name in names if not self.value(name)]
