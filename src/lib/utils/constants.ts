export const ITEMS_PAGE_SIZE = 20

export const FREE_TIER_ITEM_LIMIT = 50
export const FREE_TIER_COLLECTION_LIMIT = 3

// Max length of a collection name (mirrors `collectionFormSchema`); used to clamp the brain-dump
// default-collection name seeded from the upload filename.
export const COLLECTION_NAME_MAX_CHARS = 100

export const THEME_STORAGE_KEY = 'theme'

// Max characters of code sent to the AI explain model. The client warns when the item exceeds this
// (only the first slice is used); the route truncates server-side before calling OpenAI.
export const EXPLAIN_MAX_INPUT_CHARS = 8000

// Max characters of prompt text sent to the AI optimize model. The client warns when the item exceeds
// this (only the first slice is used); the route truncates server-side before calling OpenAI.
export const OPTIMIZE_MAX_INPUT_CHARS = 8000

// `content` has no DB max-length, so the optimize parser clamps the model output to this explicit cap.
export const OPTIMIZE_MAX_OUTPUT_CHARS = 8000

// AI File Splitter ("Brain Dump"). The whole uploaded file is sent to the model in one shot, so the
// input is bounded to keep cost/latency predictable. The client truncates to a boundary and warns;
// the route rejects anything longer with a 422.
export const SPLIT_FILE_MAX_INPUT_CHARS = 50_000
// Below this many non-blank characters there is nothing worth splitting — reject client + server.
export const SPLIT_FILE_MIN_INPUT_CHARS = 20
// v1 paste body cap (~1 MB), client + server. A paste's full text transits the POST body so the note
// can be stored whole; this bounds per-request memory and keeps the note under the platform body limit
// (Next.js/Vercel) so it is never silently clipped. Over-cap → 422 "upload as a file instead".
export const SPLIT_FILE_MAX_PASTE_BYTES = 1 * 1024 * 1024
// Hard cap on a draft title's stored length — single source of truth for the splitter parser and the
// draft-patch schema (the prompt asks the model for <= 80, but we accept and clamp up to this).
export const SPLIT_FILE_TITLE_MAX_CHARS = 200
// Allowed upload extensions for the splitter (plain text only — we read the raw text client-side).
export const SPLIT_FILE_ALLOWED_EXTS = new Set(['txt', 'md'])
// Reserved tag applied to every persisted Brain Dump source item (note for paste, file for
// upload/select). Makes sources findable + re-parsable and is surfaced in the persistence notice.
export const BRAIN_DUMP_SOURCE_TAG = 'brain-dump'

// Abandoned-job TTL: a parse job untouched for this long is purged (job + drafts + sourceText, keeping
// the durable source item) by the opportunistic lazy sweep on job-list/create. 24 hours of inactivity.
export const PARSE_JOB_TTL_MS = 24 * 60 * 60 * 1000

// Per-user hourly cap applied to every AI feature (Explain, Optimize, Description, Tags). Single
// source of truth: `rate-limit.ts` (server-only) imports this for its `ai*` keys, and the AI
// affordance tooltips surface it to the user via aiRateLimitHint().
export const AI_FEATURE_HOURLY_LIMIT = 20

// Tooltip suffix surfacing the AI rate limit. Each AI feature has its OWN independent hourly bucket
// (the `ai*` rate-limit keys are separate), so the hint names the specific operation — e.g.
// "20 optimizations per hour" — to make clear the cap is per-feature, not a shared AI total.
export function aiRateLimitHint(operationNoun: string): string {
  return `${AI_FEATURE_HOURLY_LIMIT} ${operationNoun} per hour`
}

// Item description upper bound. Raised to hold a full AI code explanation (persisted to
// `item.description`); the explain prompt/parser clamps to the same limit. The separate 280-char
// auto-description clamp (ITEM_MAX_DESCRIPTION_CHARS) is unrelated and unchanged.
export const ITEM_DESCRIPTION_MAX_CHARS = 2000

export const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
}

export const SUPPORTED_OAUTH_PROVIDERS = ['github', 'google'] as const
export type OAuthProvider = (typeof SUPPORTED_OAUTH_PROVIDERS)[number]

export const ITEM_TYPES_WITH_CONTENT = new Set(['snippet', 'command', 'prompt', 'note'])
export const ITEM_TYPES_WITH_LANGUAGE = new Set(['snippet', 'command'])

// Curated shell/CLI language set that defines the `command` ↔ `snippet` boundary. A `command`'s
// language picker is restricted to this set; a `snippet`'s picker is the full Monaco list MINUS this
// set (computed, never hand-maintained). It is also the AI disambiguator: a draft whose language is in
// this set is a terminal-runnable command, one outside it is source you'd paste into a file.
// Membership is a superset of Monaco language IDs: the synonyms ('sh','shell','zsh') feed the AI
// disambiguator/remap (free-text), while the Monaco IDs ('bash','fish','powershell','bat','dockerfile',
// 'makefile') are what the picker filter actually matches. DOS batch is Monaco's 'bat' (there is no
// 'cmd' id), so it is not listed here.
export const COMMAND_LANGUAGES = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'powershell',
  'bat',
  'dockerfile',
  'makefile',
])

// Filters the full Monaco language list down to the set valid for an item type: `command` → the
// shell/CLI set, `snippet` → everything else (the full list minus the shell set). Any other type has
// no language picker, so the full list passes through unchanged. Uses the same `isShellLanguage`
// predicate as the remap/AI layer (defined below) so the picker and enforcement never disagree.
export function languagesForItemType(itemType: string, allLanguages: string[]): string[] {
  if (itemType === 'command') {
    return allLanguages.filter((lang) => isShellLanguage(lang))
  }
  if (itemType === 'snippet') {
    return allLanguages.filter((lang) => !isShellLanguage(lang))
  }
  return allLanguages
}

// The four text-compatible item types a committed item may be re-typed among (v3 live type change).
// `link` is excluded (lossy — flips contentType TEXT↔URL); `file`/`image` need an uploaded binary. This
// is the server-side allow-list for PATCH /items/{id}'s itemTypeName.
export const TEXT_ITEM_TYPE_NAMES = new Set(['snippet', 'prompt', 'command', 'note'])

// Generic shell synonyms that normalize to "bash" when an item becomes a `command` — covers both
// non-pickable aliases ("shell","shellscript","console") and the spec's listed synonyms ("sh","zsh").
const SHELL_SYNONYMS_TO_BASH = new Set(['shell', 'shellscript', 'console', 'terminal', 'sh', 'zsh'])

// Single source of truth for "is this a shell/CLI language" — the curated command set plus the generic
// synonyms that aren't distinct command languages ("shellscript"/"console"/"terminal"). Used by the
// language picker (languagesForItemType), the snippet-clear branch of remapLanguageForType, and the AI
// disambiguator so all three partition the language space identically (e.g. a "console"-tagged value
// reads as shell on the picker, the →snippet and the →command paths alike).
export function isShellLanguage(language: string): boolean {
  const lang = language.toLowerCase()
  return COMMAND_LANGUAGES.has(lang) || SHELL_SYNONYMS_TO_BASH.has(lang)
}

/**
 * Best-effort language remap when an item is re-typed (v3). Returns the language to keep for
 * `targetType`, or null to clear it:
 * - target has no language (prompt/note) → always null.
 * - target is `command`: a generic shell synonym (e.g. "shell"/"sh"/"zsh") normalizes to "bash"; a
 *   distinct shell language already in the command set (e.g. "fish"/"powershell"/"dockerfile") is kept;
 *   anything else (a programming language) → clear.
 * - target is `snippet`: a shell language is not a valid snippet language → clear; otherwise keep.
 * Empty/absent language stays null. Pure — unit-tested directly.
 */
export function remapLanguageForType(language: string | null | undefined, targetType: string): string | null {
  const trimmed = language?.trim() || null
  const lang = trimmed?.toLowerCase() ?? null
  if (!ITEM_TYPES_WITH_LANGUAGE.has(targetType)) return null
  if (!lang) return null
  if (targetType === 'command') {
    if (SHELL_SYNONYMS_TO_BASH.has(lang)) return 'bash'
    if (COMMAND_LANGUAGES.has(lang)) return lang
    return null
  }
  // targetType === 'snippet': a shell language is not a valid snippet language → clear. A kept
  // language is returned as the user typed it (preserve casing) rather than the lowercased copy.
  return isShellLanguage(lang) ? null : trimmed
}
export const ITEM_TYPES_WITH_CODE_EDITOR = new Set(['snippet', 'command'])
export const ITEM_TYPES_WITH_MARKDOWN_EDITOR = new Set(['prompt', 'note'])
// AI prompt optimization is gated strictly to `prompt` — the markdown editor is shared with `note`,
// which must never get the Optimize affordance.
export const ITEM_TYPES_WITH_PROMPT_OPTIMIZE = new Set(['prompt'])
export const ITEM_TYPES_WITH_URL = new Set(['link'])
export const ITEM_TYPES_WITH_FILE = new Set(['image', 'file'])
export const ITEM_TYPES_WITH_IMAGE_GRID = new Set(['image'])
export const ITEM_TYPES_WITH_FILE_LIST = new Set(['file'])
export const PRO_ITEM_TYPE_NAMES = new Set(['file', 'image'])
export const PRO_ITEM_TYPE_NAMES_LABEL = [...PRO_ITEM_TYPE_NAMES].join(' and ')

export const SYSTEM_TYPE_ORDER: string[] = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']

// Colors and icon names match the DB seed — fixed for system types
export const SYSTEM_TYPE_COLORS: Record<string, string> = {
  snippet: '#3b82f6',
  prompt:  '#8b5cf6',
  command: '#f97316',
  note:    '#fde047',
  file:    '#6b7280',
  image:   '#ec4899',
  link:    '#10b981',
}

// Returns the accent color of the most common item type in a list (e.g. mostly notes → yellow),
// or null for an empty list. Ties resolve by SYSTEM_TYPE_ORDER so the result is deterministic.
export function dominantTypeColor(typeNames: string[]): string | null {
  if (typeNames.length === 0) return null

  const counts = typeNames.reduce<Record<string, number>>((acc, name) => {
    acc[name] = (acc[name] ?? 0) + 1
    return acc
  }, {})

  const winner = Object.keys(counts).reduce((best, name) => {
    if (counts[name] !== counts[best]) return counts[name] > counts[best] ? name : best
    return SYSTEM_TYPE_ORDER.indexOf(name) < SYSTEM_TYPE_ORDER.indexOf(best) ? name : best
  })

  return SYSTEM_TYPE_COLORS[winner] ?? null
}

// Maps type name → Lucide icon name (key in ICON_MAP from item-type-icon.tsx)
export const SYSTEM_TYPE_ICON_NAMES: Record<string, string> = {
  snippet: 'Code',
  prompt:  'MessageSquare',
  command: 'Terminal',
  note:    'StickyNote',
  file:    'File',
  image:   'Image',
  link:    'Link',
}

export function compareBySystemTypeOrder(a: { name: string }, b: { name: string }): number {
  return SYSTEM_TYPE_ORDER.indexOf(a.name) - SYSTEM_TYPE_ORDER.indexOf(b.name)
}

export const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
export const ALLOWED_FILE_EXTS = new Set(['pdf', 'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'csv', 'toml', 'ini'])

export const FILE_ICON_CODE_EXTS = new Set(['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'sh', 'bash', 'zsh'])
export const FILE_ICON_JSON_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'xml'])
export const FILE_ICON_TEXT_EXTS = new Set(['txt', 'md', 'pdf', 'csv'])

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_THUMBNAIL_MAX_WIDTH = 640
export const IMAGE_THUMBNAIL_QUALITY = 80
export const THUMB_MAX_BYTES = 100 * 1024

export const FILE_MAX_BYTES = 10 * 1024 * 1024

const IMAGE_ACCEPT = [...ALLOWED_IMAGE_EXTS].map((e) => `.${e}`).join(',')
const FILE_ACCEPT = [...ALLOWED_FILE_EXTS].map((e) => `.${e}`).join(',')

const IMAGE_ACCEPT_LABEL = [...ALLOWED_IMAGE_EXTS].map((e) => e.toUpperCase()).join(', ')
const FILE_ACCEPT_LABEL = [...ALLOWED_FILE_EXTS].map((e) => e.toUpperCase()).join(', ')

export const FILE_UPLOAD_CONFIG = {
  image: {
    allowedExts: ALLOWED_IMAGE_EXTS,
    maxBytes: IMAGE_MAX_BYTES,
    accept: IMAGE_ACCEPT,
    acceptLabel: IMAGE_ACCEPT_LABEL,
  },
  file: {
    allowedExts: ALLOWED_FILE_EXTS,
    maxBytes: FILE_MAX_BYTES,
    accept: FILE_ACCEPT,
    acceptLabel: FILE_ACCEPT_LABEL,
  },
} as const

export type FileItemType = keyof typeof FILE_UPLOAD_CONFIG
