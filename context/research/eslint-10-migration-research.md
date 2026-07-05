# ESLint 10 Migration Research

_Researched 2026-07-05. ESLint latest = `10.6.0` (v10.0.0 released 2026-02-06)._

## Question

Can DevStash migrate from ESLint 9 to ESLint 10, and what is required?

## Verdict

**Blocked upstream — stay on ESLint 9.39.4 for now.** Not a config problem on our
side; the ecosystem hasn't shipped compatible releases yet. Attempting the bump
today hard-crashes `npm run lint`.

## The single blocker

`eslint.config.mjs` extends `eslint-config-next/core-web-vitals` + `.../typescript`,
which transitively bundle **`eslint-plugin-react@7.37.5`**. That plugin's
`resolveBasedir()` (`lib/util/version.js`) calls **`context.getFilename()`**, a rule-API
method **removed in ESLint 10** (replaced by the `context.filename` property). The Next
config enables ~24 `react/*` rules; any that trigger React-version detection crash with:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
```

There is **no released fix**:

- `eslint-plugin-react` has only ever published up to `7.37.5` (2025-04-03); its eslint
  peer range caps at `^9.7`. The `next` dist-tag (`7.8.0-rc.0`) is a stale **2018**
  prerelease — a red herring, not a fix.
  - Tracking issue (open): https://github.com/jsx-eslint/eslint-plugin-react/issues/3977
  - Fix PRs (open, unmerged): https://github.com/jsx-eslint/eslint-plugin-react/pull/3972 ,
    https://github.com/jsx-eslint/eslint-plugin-react/pull/3979
- `eslint-config-next` — even canary `16.3.0-canary.78` — still pins
  `eslint-plugin-react@^7.37.0`. Peer is `eslint: ">=9.0.0"` (nominally allows 10, breaks
  at runtime).
  - Next.js fix PR (open, unmerged): https://github.com/vercel/next.js/pull/91710
  - Tracking issue (closed as dup of the PR): https://github.com/vercel/next.js/issues/91702
  - Runtime-crash report: https://github.com/vercel/next.js/issues/89764

## Already ESLint-10-ready in our stack (NOT blockers)

| Package | Version | Status |
|---|---|---|
| `typescript-eslint` | 8.62.1 | ✅ peer `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` — no v9 major needed |
| `@vitest/eslint-plugin` | 1.6.21 | ✅ ESLint-10 OK ([#870](https://github.com/vitest-dev/eslint-plugin-vitest/issues/870) closed) — but 1.6.21 regressed `valid-expect` to falsely flag `expect.any(Date)`; we pin `1.6.20` |
| `eslint-plugin-react-hooks` | 7.1.1 | ✅ peer includes `^10.0.0` |
| Node (`.nvmrc`) | 24.18.0 | ✅ meets v10 floor (≥20.19 / 22.13 / 24) |
| Config style | flat (`eslint.config.mjs`) | ✅ v10 removed eslintrc entirely; we're already flat |

## Other ESLint 10 breaking changes (for when we do migrate)

Source: https://eslint.org/docs/latest/use/migrate-to-10.0.0

- **Removed in v10** (were deprecated getters through v9): `context.getFilename()`→`context.filename`,
  `context.getSourceCode()`→`context.sourceCode`, `context.getCwd()`→`context.cwd`,
  `context.getPhysicalFilename()`→`context.physicalFilename`, `context.parserOptions`,
  `context.parserPath`. (The traversal methods `getScope`/`getAncestors`/`parserServices`
  were already gone in **v9**, not v10.)
- **eslintrc fully removed** — flat config is the only option.
- **JSX references now tracked** in scope analysis — may shift `no-unused-vars` results.
- `radix` rule string options deprecated; CLI color flags now override `NO_COLOR`.
- Stopgap for un-updated plugins: `fixupPluginRules()` from `@eslint/compat` — but note it
  wraps the *legacy-config shape*, it does **not** retrofit the removed `getFilename` API,
  so it will **not** cure our specific crash.

## Options (evaluated)

1. **Wait (chosen).** Stay on 9.39.4 until Next.js releases the fix (PR #91710, itself
   gated on the react-plugin fix). Zero risk, no rework.
2. **`@eslint/compat` stopgap.** Won't fix the removed-API crash — low value here.
3. **Swap react linting to `@eslint-react/eslint-plugin` / `eslint-plugin-react-x`**
   (v5.11.2, peer `eslint: '*'`, ESLint-10-native). Works today but is **not a drop-in**
   (different rule IDs/defaults → re-baseline lint), and would likely be re-done once Next
   ships official v10 support.

## Re-check checklist (revisit when bumping ESLint)

- [ ] `npm view eslint-plugin-react version` > 7.37.5 **and** its peer allows `^10`.
- [ ] `npm view eslint-config-next dependencies | grep eslint-plugin-react` shows a version
      whose peer allows ESLint 10 (i.e. Next.js PR #91710 released).
- [ ] Then: bump `eslint` to latest 10.x, run `npm run lint` + `npm run test:run`.
- [ ] Separately, re-attempt `@vitest/eslint-plugin@^1.6.21` and confirm `valid-expect` no
      longer false-flags `expect.any(...)` (else keep the `1.6.20` pin).
