# Feature Spec: Credentials Vault (Zero-Knowledge `credentials` Item Type)

## 1. Summary
Add a new system item type — **`credentials`** (passwords, API keys, tokens, secret env values) — whose
sensitive fields are **end-to-end encrypted**. Secrets are encrypted **on the client**, the server and
database store **only ciphertext**, and the decryption key **never leaves the browser**. A full DB/S3
compromise yields nothing decryptable. This is the standard **zero-knowledge vault** model used by
Bitwarden, 1Password, ProtonPass, and Standard Notes — we implement the established recipe, we do **not**
invent crypto.

The defining invariant: **the value used to log in and the value used to derive the encryption key are
different cryptographic outputs.** The server can authenticate a user without ever being able to
reconstruct their encryption key.

## 2. Status
**Spec only — not coded.** Research complete (Context7-verified, 2026-06). No schema, routes, or UI yet.
This document is the design contract; build it on a `feature/credentials-vault` branch when scheduled.

## 3. Problem
DevStash stores snippets, prompts, commands, notes, files, images, and links in plaintext columns —
appropriate for non-secret developer knowledge. But developers also hoard **secrets**: API keys, DB
connection strings, OAuth client secrets, `.env` values, server passwords. Today there is no safe home
for these — putting them in a `note` means they sit in plaintext in Neon and are exposed to AI features,
full-text search, and any DB read. A credentials type must guarantee that **even DevStash operators with
full database access cannot read the secret**.

## 4. Architecture & locked decisions
All Context7-verified (libsodium-doc, `@noble/ciphers`, `@noble/hashes`; latest verify 2026-06).

### 4.1 Trust model
- **Server is dumb ciphertext storage** for secret fields. It performs auth, ownership scoping (IDOR),
  rate limiting, and persistence — **never** decryption.
- The **master key lives in browser memory only** (session-scoped). It is **never** sent to the server,
  **never** persisted to DB, localStorage, cookies, or S3. This is the single explicit exception to the
  project's "persist state in the DB" rule — persisting the key would defeat the entire design, so the
  rule is overridden **for the master/derived keys only** (non-secret metadata still persists normally).
- **No AI, no server search, no S3 preview** over encrypted fields — the server cannot read them. This is
  a real product constraint: `credentials` items are excluded from optimize/explain/tags/description and
  from any server-side full-text search.

### 4.2 Primitives (chosen)
| Concern | Choice | Rationale |
|---|---|---|
| Password → key (KDF) | **Argon2id** | Memory-hard, GPU/ASIC-resistant. OWASP + libsodium default for password→key. PBKDF2 (Web Crypto native) is the no-dep fallback but weaker. |
| Field encryption | **XChaCha20-Poly1305 with AAD** (AEAD) | Authenticated (detects tampering); 24-byte **random** nonce removes nonce-reuse risk. **Always pass associated data** binding context (§12.1). AES-256-GCM is an acceptable alternative but its 12-byte nonce is less forgiving. |
| Subkey domain separation | **HKDF / `crypto_kdf_derive_from_key`** | Derive distinct subkeys (`encKey`, `searchKey`, `commitKey`…) from one root so each domain is isolated and the login value ≠ the encryption value. |
| Unlock handshake | **OPAQUE (aPAKE)** — required | Server never sees the password **or** a verifier usable for precomputation; client gets a stable `export_key` for encryption. No legacy fallback. See §4.7. |
| Length hiding | **Bucketed padding** (`sodium_pad` / Padmé) before encrypt | Ciphertext length otherwise leaks secret length (§12.3). |
| Library (crypto) | **`@noble/ciphers` + `@noble/hashes`** | Audited, zero-dependency, ESM-native (clean Next.js 16 bundling), tiny, tree-shakeable, browser+Node. `argon2id`/`hkdf` in `@noble/hashes`, `xchacha20poly1305` + `managedNonce` in `@noble/ciphers`. |
| Library (handshake) | **`@serenity-kit/opaque`** (WASM) | Canonical audited JS OPAQUE; the same engine the Better-Auth OPAQUE plugin wraps. |

`managedNonce(xchacha20poly1305)(key)` prepends/extracts the nonce automatically, so each stored blob is
self-contained (nonce ∥ ciphertext ∥ tag).

`libsodium-wrappers` (WASM, `crypto_pwhash` + `crypto_secretbox` + `crypto_aead_xchacha20poly1305_ietf` +
`sodium_pad` + `sodium_memzero`) is the fallback if we ever want a single batteries-included lib, but the
WASM payload is heavier than `@noble`'s pure-JS.

### 4.3 Two-layer key hierarchy (locked)
**Never encrypt fields directly with the master key.** Use an indirection layer:

```
vaultPassword ──OPAQUE login (§4.7)──► export_key   (client-only; Argon2id stretch runs inside the OPRF)
export_key ──HKDF "enc"──────────────► encKey       (wraps account key; never sent to server)
              (OPAQUE also yields a sessionKey used only to authenticate the unlock — never an encryption key)

accountKey  = random 32 bytes (generated once at vault setup)        (the real root data key)
wrappedAccountKey = AEAD_encrypt(accountKey, encKey)                 (stored in DB)

itemKey     = random 32 bytes per credential item
wrappedItemKey = AEAD_encrypt(itemKey, accountKey)                  (stored per item)
ciphertext  = AEAD_encrypt(secretFields, itemKey)                   (stored per item)
```

Why the `accountKey` indirection:
- **Master-password change is cheap** — re-wrap one `accountKey`, not re-encrypt N items.
- **Recovery** (see §6) is just an additional wrapping of the same `accountKey`.
- **Future sharing/multi-device** wrap the `accountKey` per recipient/device.

### 4.4 Recommendation — key source (resolved)
**Recommended: separate vault unlock password**, feeding the `accountKey` indirection above.

Rationale: reusing the NextAuth login password couples vault security to a secret the **server handles
during reset flows** — a server-side password reset would silently orphan the vault (the old `encKey` can
no longer be derived), and OAuth-only users (GitHub/Google) have **no password to derive from at all**,
which is a hard blocker given DevStash's auth mix. A dedicated vault password:
- works identically for password and OAuth accounts,
- keeps the vault unaffected by login-password resets,
- matches the Bitwarden/1Password model users already expect for a secrets vault.

Cost: users manage a second secret and unlock the vault per session. Acceptable for an opt-in,
security-sensitive feature.

### 4.5 Recommendation — recovery (resolved, Context7-grounded)
**Recommended: one-time recovery key (1Password model), as the only recovery path.**

Pure zero-knowledge means a forgotten master password is **mathematically unrecoverable** — there is no
server-side reset. "No recovery at all" is too unforgiving for a general product, so generate a
high-entropy **recovery key** at vault setup that **independently wraps the same `accountKey`**:

```
recoveryKey = random 256-bit (shown once, user stores it offline)
wrappedAccountKey_recovery = AEAD_encrypt(accountKey, KDF(recoveryKey))   (stored in DB)
```

Forgotten master password → user supplies the recovery key → unwrap `accountKey` → re-wrap with a new
master password. The recovery key is shown **exactly once** at setup and **never stored server-side in
usable form**. This keeps the system zero-knowledge while giving exactly one survivable path. Disclose
loudly at setup: *"If you lose both your vault password and your recovery key, your secrets are
permanently unrecoverable — by design."*

### 4.6 Biometric unlock — WebAuthn PRF (recommended additive layer)
**Recommended: add biometric/passkey unlock via the WebAuthn PRF extension as an *additive convenience
layer*, with the vault password (+ recovery key) remaining the durable root.** This is the modern,
hardware-backed "key handshake" the question asks about — Touch ID / Face ID / Windows Hello / Android
biometric, exposed through the platform authenticator, with **no password typed** for day-to-day unlock.

**How it works (Context7-verified, SimpleWebAuthn `/docs/advanced/prf`):** the WebAuthn **PRF extension**
reliably produces a sequence of random bytes after an authentication ceremony. The seed combines
**server-controlled bytes (a stored salt)** with **authenticator-controlled bytes held alongside the
passkey's private key** — so the output is strongly bound to that passkey and reproducible only by it,
**only after user verification (biometric/PIN)**. Crucially, the PRF bytes are produced **on-device and
read client-side** (`getClientExtensionResults().prf.results.first`); they are **never sent to the
server**.

It plugs into the existing hierarchy as **just another wrapping of the same `accountKey`** — identical in
shape to the password and recovery-key wrappings (§4.3, §4.5):

```
prfOutput   = WebAuthn assertion with extensions.prf.eval.first = vaultPrfSalt   (biometric-gated, on-device)
biometricKEK = HKDF(prfOutput, "vault-biometric-kek")                            (never leaves device)
wrappedAccountKey_biometric = AEAD_encrypt(accountKey, biometricKEK)             (stored in DB, per passkey)
```

Biometric unlock = run the assertion → derive `biometricKEK` → unwrap `accountKey`. **The biometric data
itself never leaves the OS secure enclave**; WebAuthn only ever returns the assertion + PRF bytes. The
server still verifies the assertion (challenge / origin / RPID / signature / counter) to authenticate the
ceremony, but never sees `prfOutput` or `accountKey`.

**Library:** **`@simplewebauthn/browser` + `@simplewebauthn/server`** (`/masterkale/simplewebauthn`,
v13) — the standard TS WebAuthn lib; `isoBase64URL` (server) / `base64URLStringToBuffer` (browser) helpers
marshal the PRF salt. Server stores each passkey as a `WebAuthnCredential` (`id`, `publicKey`, `counter`,
`transports`).

**Why additive, not a replacement (hard constraints — drive the design):**
- **Coverage is not universal.** PRF (CTAP2 `hmac-secret`) is supported by modern platform authenticators
  but not all (older security keys, some browser/OS combos). A **password or recovery-key root must always
  exist** as the fallback — biometric is a *fast path*, never the sole key holder.
- **Passkeys are per-authenticator.** Synced passkeys (iCloud Keychain, Google Password Manager) replicate
  the credential *and* reproduce stable PRF output **within one ecosystem**, but **not across ecosystems**
  (Apple ↔ Google won't sync). So each device/ecosystem enrolls its own passkey → its own
  `wrappedAccountKey_biometric` row; the password root bridges devices on first use.
- **Enrollment timing quirk.** On some platforms (notably Chrome) registration returns `prf.enabled: true`
  but **not** usable `results` — you may need a follow-up authentication ceremony to actually obtain the
  PRF bytes and create the biometric wrapping. Plan the enrollment flow for a possible second ceremony.
- **Never use `prfOutput` raw** — run it through HKDF (domain string) before using it as a KEK, consistent
  with §4.3.
- **Scope = vault unlock, not login.** This passkey unlocks the *vault*; it is independent of NextAuth
  login (which keeps email/password + GitHub/Google). Passkey-as-login is a separate, out-of-scope feature.

Net UX: first device unlocks once with the vault password and enrolls a biometric passkey; thereafter that
device unlocks the vault with a fingerprint/face scan. Lose the device → the password or recovery key still
opens the vault on a new one. Zero-knowledge is preserved end-to-end.

### 4.7 Unlock handshake — OPAQUE aPAKE (required)
**Password unlock uses OPAQUE (an asymmetric/augmented PAKE) — never "derive an `authHash` and send it
over TLS".** This is the most advanced modern password-unlock primitive and the single biggest server-trust
upgrade in this spec. There is no plain-verifier fallback (§4.8): if OPAQUE can't run, the vault doesn't
open in that environment.

Why it's stronger (Context7-verified, `@serenity-kit/opaque` / Better-Auth OPAQUE):
- The client registers a `registrationRecord` the **server stores but provably cannot decrypt** — there is
  **no password-equivalent verifier** on the server. A stolen DB gives an attacker *only* the same offline
  Argon2 brute-force they'd face anyway, with **no precomputation/rainbow advantage** (the OPRF salt is
  oblivious — the server can't even compute candidate hashes without interacting with the client).
- The password is **never sent** — not even hashed. Login is a challenge/response where only the holder of
  the correct password can succeed; both sides derive a shared session key, proving identity without
  exchanging the secret.
- OPAQUE additionally yields a stable, client-only **`export_key`** that survives the protocol. We feed it
  through HKDF to produce `encKey`, which wraps the `accountKey` — so the *same* password unlock that
  authenticates also yields the encryption key, with the server learning neither.

```
OPAQUE login(password) ──► sessionKey (proves identity to server)
                      └──► export_key (client-only) ──HKDF──► encKey ──unwraps──► accountKey
```

It drops cleanly into the existing hierarchy: `export_key`-derived `encKey` simply replaces the
Argon2-derived `encKey` as the wrapper of `accountKey` (§4.3). Recovery key (§4.5) and biometric PRF
(§4.6) wrappings are unchanged.

**Server-side hardening it enables/needs:** consistent-timing user lookup (OPAQUE libs do this →
**user-enumeration resistance** for free), plus an Upstash rate-limit/lockout on login attempts.

### 4.8 Tiered unlock — security-first, compatibility-preserving
All tiers unwrap the **same `accountKey`**; they differ only in how `encKey`/KEK is obtained. The client
picks the strongest available:

| Tier | Mechanism | When | Notes |
|---|---|---|---|
| 1 (best) | **Passkey + WebAuthn PRF** (§4.6) | Platform authenticator supports `hmac-secret`/PRF | Hardware-backed, biometric, on-device. FIDO2 security keys (e.g. YubiKey 5) also expose PRF — a **non-biometric** hardware option. |
| 2 (baseline) | **OPAQUE password** (§4.7) | Always | The universal path; works on any modern browser. **Required — no weaker fallback.** |
| Always | **Recovery key** (§4.5) | Lost password/device | Independent wrapping; offline. |

This satisfies "security-first, but compatible where passkeys don't apply": biometrics when possible,
OPAQUE password universally. **There is no plain-KDF/verifier tier** — security is never downgraded to
accommodate an environment that can't run the OPAQUE WASM (it simply can't use the vault there). WASM is
available in every browser DevStash already targets, so this excludes no real users.

## 5. Data model (Prisma)
Secret fields become opaque blobs; non-secret metadata stays plaintext so items remain listable/filterable
without an unlock.

- **`Item`** — add `credentials` to the item-type enum/union (`src/lib/utils/constants.ts` icon+color).
  Reuse existing plaintext columns for **non-secret** metadata only: `title`, optional `url`,
  `username`/label, `tags`, collection membership.
- **Encrypted payload** (new columns or a related `CredentialSecret` row):
  - `ciphertext String @db.Text` (base64: nonce ∥ ciphertext ∥ tag) — the encrypted secret fields blob.
  - `wrappedItemKey String @db.Text` — itemKey wrapped by accountKey.
  - `cipherVersion Int` — algorithm/format version for future migration.
- **`VaultKeyset`** (one per user, created at vault setup):
  - `kdfSalt`, `kdfParams` (Argon2id opslimit/memlimit/version),
  - `wrappedAccountKey` (by encKey), `wrappedAccountKey_recovery` (by recovery key),
  - `opaqueRecord` (the OPAQUE `registrationRecord` — server-stored, **server-undecryptable**; §4.7).
  - `wrappedAccountKey` (by `encKey` from OPAQUE `export_key`), `wrappedAccountKey_recovery`,
  - `keyCommitment` (binds the key to the ciphertext — §12.2),
  - `kdfParams`, `cipherVersion`, `keysetVersion` (crypto agility / rehash-on-upgrade).
- **`VaultPasskey`** (zero-or-more per user — biometric unlock, §4.6): the WebAuthn
  `WebAuthnCredential` fields (`credentialId`, `publicKey`, `counter`, `transports`,
  `credentialDeviceType`, `backedUp`), plus `prfSalt` (server-controlled, non-secret) and
  `wrappedAccountKey_biometric` (accountKey wrapped by the PRF-derived KEK). One row per enrolled
  device/ecosystem.

Migrate on the **`dev`** Neon branch only (never `production`). Add a focused migration; do not touch
existing item rows.

## 6. Flows
- **Vault setup** (first use): user sets a vault password → client runs OPAQUE registration (server stores
  the undecryptable `opaqueRecord`) → generates `accountKey` + `recoveryKey` → derives `encKey` from the
  OPAQUE `export_key` (HKDF) → wraps `accountKey` (by `encKey` and by the recovery key) → POSTs the
  `VaultKeyset`. Recovery key shown once.
- **Unlock** (per session): user enters vault password → client runs OPAQUE login → server validates the
  proof and creates the session (no password/verifier ever seen) → client obtains `export_key` → HKDF →
  `encKey` → fetches `VaultKeyset`, unwraps `accountKey`, holds it in a **memory-only Zustand store**. The
  OPAQUE OPRF/stretch is intentionally slow, so unlock **once per session**, cache in memory, and re-prompt
  on idle (couples to the existing **idle-session-timeout** work).
- **Create/edit credential**: client generates `itemKey`, encrypts fields, wraps `itemKey` with
  `accountKey`, POSTs ciphertext + `wrappedItemKey` + plaintext metadata via the normal `api`/`$api`
  client and a new `route.ts` (+ `paths.ts` + Zod schema + `openapi:gen`).
- **View credential**: client fetches the row, unwraps `itemKey` with in-memory `accountKey`, decrypts.
- **Change vault password**: re-run OPAQUE registration with the new password → new `export_key` → new
  `encKey` → re-wrap `accountKey`, PATCH the `opaqueRecord` + `wrappedAccountKey`. Items untouched.
- **Recovery**: recovery key → unwrap `accountKey` → set a new vault password (re-wrap).
- **Enroll biometric** (per device, §4.6): vault already unlocked (accountKey in memory) → server issues a
  fresh `prfSalt` + registration options (`extensions.prf`) → `startRegistration()` → verify on server →
  obtain PRF bytes (possibly via a follow-up `startAuthentication()` ceremony) → derive `biometricKEK` →
  POST `wrappedAccountKey_biometric` + the `VaultPasskey` row. Never blocks setup; opt-in per device.
- **Biometric unlock**: server sends auth options (`allowCredentials` + `extensions.prf.eval.first =
  prfSalt`) → `startAuthentication()` triggers the OS biometric prompt → verify assertion server-side →
  client reads `prf.results.first` → derive `biometricKEK` → unwrap `accountKey` into the in-memory store.
  Falls back to password unlock if PRF is unavailable or the passkey is gone.

## 7. Hard constraints / non-goals
- **Search**: cannot server-search ciphertext. For maximum-assurance E2EE, **encrypt the metadata too**
  (title/url/username) and support search via a **keyed blind index** (§12.4) or client-side search after
  unlock — rather than leaving metadata plaintext. (Decision #6.)
- **No AI / no preview** over `credentials` (server can't read them).
- **No key escrow**: DevStash operators must have **no** path to plaintext. If a future feature needs
  server-side access to a secret, it is **out of scope** for this type by definition.
- **Clipboard/exposure UX** (auto-clear clipboard, reveal-on-click, no secret in logs/error bodies) —
  spec'd here as requirements; secrets must never appear in Pino logs or API error payloads.

## 8. Library / API references (Context7-verified)
- **`@noble/hashes`** — `argon2id(password, { salt, ... })` for KDF; `hkdf` for subkey separation.
- **`@noble/ciphers`** — `import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'`;
  `managedNonce(xchacha20poly1305)(key)` for self-contained blobs; `gcm` from `@noble/ciphers/aes.js` as
  the AES alternative. AEAD only — never an unauthenticated cipher.
- **libsodium equivalents** (if we switch): `crypto_pwhash` (Argon2id), `crypto_secretbox_easy` /
  `crypto_secretstream_*`, `crypto_kdf_derive_from_key` (8-byte context for domain separation).
- **`@simplewebauthn/browser` + `@simplewebauthn/server`** (v13) — biometric unlock (§4.6).
  `generateRegistrationOptions` / `generateAuthenticationOptions` with `extensions.prf`; browser
  `startRegistration` / `startAuthentication`; read `getClientExtensionResults().prf.results.first`.
  Marshal salt with `isoBase64URL` (server) ↔ `base64URLStringToBuffer` (browser). Always HKDF the PRF
  bytes before use as a KEK.
- **`@serenity-kit/opaque`** (WASM) — OPAQUE unlock handshake (§4.7): `client.startRegistration` /
  `server.createRegistrationResponse` / `client.finishRegistration`; login `start/finish` yielding
  `sessionKey` + `exportKey`. HKDF the `exportKey` before use as `encKey`.
- **AEAD with AAD** — `crypto_aead_xchacha20poly1305_ietf_encrypt(..., ad, adlen, ...)` (libsodium) or pass
  associated data to noble's AEAD; bind `userId ∥ itemId ∥ fieldType ∥ cipherVersion` (§12.1).
- **Length hiding** — `sodium_pad` / Padmé before encrypt (§12.3). **Memory wipe** — `sodium_memzero`,
  or zero `Uint8Array`s in JS (best-effort) (§12.5).
- **Nonce rule**: XChaCha 24-byte random nonces are safe; AES-GCM needs unique 12-byte nonces. Use a CSPRNG
  (`crypto.getRandomValues` / noble `randomBytes`) for all keys, salts, nonces.

## 9. Verification (when built)
`lint` + Vitest on the crypto module (round-trip encrypt/decrypt, wrong-key rejection, **tamper + wrong-AAD
rejection**, **key-commitment rejection**, recovery-key unwrap, password-change re-wrap, **OPAQUE
register→login→exportKey round-trip**) + the route handlers; `prisma migrate dev`/`status` on **dev**;
`openapi:gen` (no hand edits); Playwright happy path (setup → lock/unlock → create → reload → decrypt →
change password → recover → biometric enroll/unlock). Server-side test must assert **no plaintext secret,
password, or key ever reaches the DB or logs**, and that a stolen-DB snapshot decrypts to nothing.

## 10. Open decisions for the user
1. **Key source** — recommendation: **separate vault password** (§4.4); confirm vs. reuse-login.
2. **Recovery** — recommendation: **one-time recovery key** (§4.5); confirm vs. pure no-recovery.
3. **Pro-gating** — is `credentials` Pro-only (like file/image) or available to all tiers?
4. **Encrypted-field shape** — single JSON blob of `{ password, username, url, notes, customFields[] }`,
   or per-field columns? (Single blob is simpler and leaks less structure; recommended.)
5. **Biometric unlock (§4.6)** — recommendation: **ship as an additive WebAuthn-PRF layer**, password +
   recovery key remain the root. Confirm in scope for v1, or defer biometrics to a v2 (password/recovery
   only first). The crypto hierarchy is designed so adding it later needs **no re-encryption** — just a new
   `wrappedAccountKey_biometric` per device.
6. **Metadata privacy** — recommendation: **encrypt title/url/username too + keyed blind index** (§12.4)
   for max E2EE. Confirm vs. the simpler "minimal plaintext metadata" cut (cheaper, but leaks more).
7. **OPAQUE unlock (§4.7)** — **locked: OPAQUE is required**, no plain-verifier fallback (decided). Vault
   is unavailable in any environment that can't run the OPAQUE WASM (excludes no browser DevStash targets).

## 11. References
- Context7: `/jedisct1/libsodium-doc`, `/paulmillr/noble-ciphers`, `/masterkale/simplewebauthn`
  (`/docs/advanced/prf`), `/theuntraceable/better-auth-opaque`, `/websites/rs_opaque-ke_opaque_ke`.
- Pattern provenance: Bitwarden security whitepaper (auth-hash ≠ encryption-key), 1Password recovery key
  + Secret Key model, OWASP Password Storage / Key Management cheat sheets, WebAuthn L3 PRF extension
  (CTAP2 `hmac-secret`), IRTF CFRG OPAQUE (aPAKE), Padmé padding scheme, partitioning-oracle / committing-AEAD
  research.

## 12. Advanced hardening — maximum-assurance E2EE
Each item is independent and additive; together they close the metadata/structural leaks and
chosen-ciphertext classes of attack that a basic "encrypt the password field" design leaves open.

### 12.1 Bind context with AAD (associated data)
Every AEAD call passes associated data = `userId ∥ itemId ∥ fieldType ∥ cipherVersion`. Decryption fails
if any ciphertext is moved to another item/user/field or replayed across versions. Defeats
**ciphertext-swap / confused-deputy** attacks where the server returns row B's blob for item A.

### 12.2 Key-committing encryption
XChaCha20-Poly1305 and AES-GCM are **not key-committing** → a crafted ciphertext can decrypt validly under
two different keys (**partitioning-oracle** attack — relevant because we have multiple wrappings of the same
data: password, recovery, biometric). Store a `keyCommitment` (e.g. `HMAC(key, "commit")` or a hash of the
key) alongside each wrapped key/blob and verify it before trusting a decrypt.

### 12.3 Length-hiding padding
Ciphertext length leaks plaintext length (a 8-char vs 64-char password is visible). **Pad plaintext to
size buckets** (`sodium_pad`, or the Padmé scheme that bounds overhead to ~12%) before encryption.

### 12.4 Encrypted metadata + keyed blind index (optional, max-privacy)
For true E2EE, encrypt `title`/`url`/`username` too. To keep server-side lookup/filtering, derive a
`searchKey = HKDF(accountKey, "search")` and store **blind indexes** = `HMAC(searchKey, normalize(token))`
per searchable token. The server matches HMACs without ever seeing plaintext. Trade-off: blind indexes
leak equality/co-occurrence — bucket/normalize carefully, and treat them as the documented residual leak.

### 12.5 Memory & exposure hygiene
- Hold keys in `Uint8Array`, never JS strings (strings are immutable and GC-uncontrollable). **Zero buffers
  after use** (`sodium_memzero` / manual fill); accept it is best-effort in a GC'd runtime.
- **Auto-lock**: clear all in-memory keys on idle timeout (reuse the idle-session work), tab `visibilitychange`
  hidden, and explicit "Lock vault". Re-prompt to unlock.
- **Clipboard**: copy-on-demand, auto-clear after ~20 s, never log copied values.
- **Never** let a secret, password, key, or `export_key` enter Pino logs or an API error body. Add a test
  asserting this.

### 12.6 Argon2id work factor
Tune to OWASP-plus for an infrequently-run vault unlock: target ≥ **256 MiB**, `t ≥ 3`, `p = 1` (calibrate
to ~0.5–1 s on a mid device). Store params; rehash-on-upgrade when raised. (With OPAQUE the stretching runs
inside the client OPRF step.)

### 12.7 Anti-brute-force + enumeration resistance
Upstash rate-limit + temporary lockout on unlock attempts; constant-time user lookup (OPAQUE provides this).
No response distinguishes "no vault" from "wrong password".

### 12.8 Supply-chain & transport integrity
Pin + audit the (few, zero-dep) crypto deps; verify npm provenance/sigstore; strict CSP
(`connect-src` allowlist, no `unsafe-inline`/`eval`); **Subresource Integrity** on any externally-loaded
asset; HSTS. Defense-in-depth: keep at-rest encryption on the Neon/S3 ciphertext columns too (doesn't
change the threat model, but layers).

### 12.9 Password health without leaks (nice-to-have)
Client-side strong generator; **HIBP k-anonymity** range check (send only the first 5 chars of the
SHA-1, match the suffix locally) so breach checks never reveal the password. Optional encrypted **TOTP
seed** field type.

## 13. Fundamental limitation of in-browser E2EE (must disclose)
**The honest "101%" caveat:** a pure web app delivers the very JavaScript that performs the crypto *from the
server on every load*. A compromised server, CDN, or build pipeline could ship key-exfiltrating code and
silently defeat E2EE — no in-browser mechanism can fully prevent this (the page that would verify integrity
is itself served by the same origin). This is inherent to **all** web-based E2EE (Proton, Bitwarden web,
etc.), not specific to DevStash.

Mitigations (raise the bar, don't eliminate it): strict CSP + SRI + dependency pinning (§12.8), minimal
audited crypto deps, reproducible/signed builds, and — for the highest assurance — a **desktop app or
browser extension** whose code is installed and version-pinned rather than re-fetched per load. **Disclose
this plainly** in the vault's security explainer; do not market "zero-knowledge" without it. Everything else
in this spec (server never holds keys/passwords, biometric on-device, OPAQUE) is real and strong **given the
client code is honest** — this caveat names exactly the trust that remains.
