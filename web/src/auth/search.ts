import { z } from 'zod'

/**
 * Search-param schemas shared by the auth routes.
 *
 * These live here rather than beside the open-redirect guard (their previous home) or
 * inline per route: every route hand-rolling its own meant a validation fix to one never
 * reached the others, which is how unvalidated params reached the DOM in the first place.
 */

/**
 * Coerce a search param to `string | undefined` — anything non-string collapses to
 * `undefined`. Capped at 2048 chars (a conservative URL-length bound) since this is the
 * shared base every param schema in this file builds on and it's an input-validation
 * boundary: an oversized value collapsing to `undefined` is safer than passing it through
 * to a sibling schema's own (format-specific) validation.
 */
export const optionalSearchString = z.preprocess(
  (value) => (typeof value === 'string' && value.length <= 2048 ? value : undefined),
  z.string().optional(),
)

/**
 * An email carried in a URL, used only to prefill a form field. Anything that isn't a
 * valid address collapses to `undefined` — a garbage prefill would otherwise render
 * clean until the user touches the field, since the form only shows errors once touched.
 */
export const emailSearchParam = optionalSearchString.transform((value) =>
  value !== undefined && z.email().safeParse(value).success ? value : undefined,
)

/**
 * The one-time token on the emailed reset/verify links and the OAuth pending-link
 * redirect. The token is opaque here — the Go API is the only thing that can judge it,
 * and it is consumed atomically server-side (Redis GETDEL), so the client's only job is
 * to pass it through without ever logging, linking, or rendering it.
 */
export const tokenSearchSchema = z.object({ token: optionalSearchString })
