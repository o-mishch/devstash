export const ITEMS_PAGE_SIZE = 20

export const FREE_TIER_ITEM_LIMIT = 50
export const FREE_TIER_COLLECTION_LIMIT = 3

export const THEME_STORAGE_KEY = 'theme'

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
export const ITEM_TYPES_WITH_URL = new Set(['link'])
export const ITEM_TYPES_WITH_FILE = new Set(['image', 'file'])
export const ITEM_TYPES_WITH_IMAGE_GRID = new Set(['image'])
export const ITEM_TYPES_WITH_FILE_LIST = new Set(['file'])
export const PRO_ITEM_TYPE_NAMES = new Set(['file', 'image'])

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
  prompt:  'Sparkles',
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
