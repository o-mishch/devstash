export const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
}

export const ITEM_TYPES_WITH_CONTENT = new Set(['snippet', 'command', 'prompt', 'note'])
export const ITEM_TYPES_WITH_LANGUAGE = new Set(['snippet', 'command'])
export const ITEM_TYPES_WITH_CODE_EDITOR = new Set(['snippet', 'command'])
export const ITEM_TYPES_WITH_MARKDOWN_EDITOR = new Set(['prompt', 'note'])
export const ITEM_TYPES_WITH_URL = new Set(['link'])
export const ITEM_TYPES_WITH_FILE = new Set(['image', 'file'])
export const ITEM_TYPES_WITH_IMAGE_GRID = new Set(['image'])
export const PRO_ITEM_TYPE_NAMES = new Set(['file', 'image'])

export const SYSTEM_TYPE_ORDER: string[] = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']

export const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
export const ALLOWED_FILE_EXTS = new Set(['pdf', 'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'csv', 'toml', 'ini'])

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
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
