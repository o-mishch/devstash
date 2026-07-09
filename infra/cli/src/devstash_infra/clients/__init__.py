"""clients/ — typed facades over the external CLIs (gcloud, tofu, kubectl, helm).

CLI zone (3.14). Domain code calls typed methods (`gcloud.storage.write_marker(uri)`,
`tofu.apply(plan)`) instead of assembling argv lists. Each client OWNS its argv — which is where
argv-parity now lives: a client's own tests assert the exact command emitted, byte-for-byte
against the shell — and its error contract: a hard failure raises `ProcError` (an `InfraError`)
to the boundary; a deliberately best-effort op catches internally, so the shell's `|| true`
becomes an explicit per-method decision rather than a `check=False` flag scattered at call sites.

The stdlib floor (`shared/`, `cloudbuild/`) does NOT use these — it stays procedural + argv-inline,
because it must run on cloud-sdk:slim with zero install (no pydantic/typed-client layer there).
"""
