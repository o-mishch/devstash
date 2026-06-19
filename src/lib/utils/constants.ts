export const ITEMS_PAGE_SIZE = 20

export const FREE_TIER_ITEM_LIMIT = 50
export const FREE_TIER_COLLECTION_LIMIT = 3

export const THEME_STORAGE_KEY = 'theme'

// Max characters of code sent to the AI explain model. The client warns when the item exceeds this
// (only the first slice is used); the route truncates server-side before calling OpenAI.
export const EXPLAIN_MAX_INPUT_CHARS = 8000

// Max characters of prompt text sent to the AI optimize model. The client warns when the item exceeds
// this (only the first slice is used); the route truncates server-side before calling OpenAI.
export const OPTIMIZE_MAX_INPUT_CHARS = 8000

// `content` has no DB max-length, so the optimize parser clamps the model output to this explicit cap.
export const OPTIMIZE_MAX_OUTPUT_CHARS = 8000

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
