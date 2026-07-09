"""models/ — 3.14, pydantic v2, CLI-only.

NEVER imported by shared/ or cloudbuild/ (they are stdlib-only). Where a shape is
needed on both sides, the canonical parse lives as a dataclass/TypedDict in
shared/models_core.py and the pydantic model here is a thin wrapper over the same
dict — never the reverse.
"""
