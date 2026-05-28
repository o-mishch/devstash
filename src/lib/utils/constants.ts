export const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
}

export const ITEM_TYPES_WITH_CONTENT = new Set(['snippet', 'command', 'prompt', 'note'])
export const ITEM_TYPES_WITH_LANGUAGE = new Set(['snippet', 'command'])
export const ITEM_TYPES_WITH_CODE_EDITOR = new Set(['snippet', 'command'])
export const ITEM_TYPES_WITH_URL = new Set(['link'])
export const ITEM_TYPES_WITH_FILE = new Set(['image', 'file'])

export const SYSTEM_TYPE_ORDER: string[] = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']
