import { Code, File, Image, Link, MessageSquare, StickyNote, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** The immutable system item-type names (mirrors the backend's closed set). */
export type ItemTypeName = 'snippet' | 'prompt' | 'command' | 'note' | 'link' | 'file' | 'image'

export interface ItemTypeMeta {
  /** Matches the backend type name (SlimItemType.name / the `typeName` query param). */
  name: ItemTypeName
  label: string
  plural: string
  icon: LucideIcon
  /** Tailwind text-color class for the type accent. */
  accent: string
  /** Tailwind top-border class for the type accent — a static class the JIT can scan. */
  border: string
  /** Raw hex of the accent — for the canvas, the one context that cannot use a class. */
  hex: string
  pro?: boolean
}

// System item types (immutable). The single source of truth for each type's icon and accent
// (the Tailwind text and border classes plus the raw hex — keep all three in sync). File/Image are
// Pro-only and can't be created until Phase 3 ships upload — they still render in lists.
// Palette mirrors the live devstash.one item-type colors/icons (single source of truth
// for the whole app — dashboard, item cards, sidebar, and the marketing hero mockup).
// `as const satisfies` rather than a `: ItemTypeMeta[]` annotation: const binds only the
// reference, so an annotated array stays push-able by any importer — and BY_NAME, built once
// below at module load, would silently desync. `satisfies` keeps the shape checked.
export const ITEM_TYPES = [
  {
    name: 'snippet',
    label: 'Snippet',
    plural: 'Snippets',
    icon: Code,
    accent: 'text-blue-500',
    border: 'border-t-blue-500',
    hex: '#3b82f6',
  },
  {
    name: 'prompt',
    label: 'Prompt',
    plural: 'Prompts',
    icon: MessageSquare,
    accent: 'text-violet-500',
    border: 'border-t-violet-500',
    hex: '#8b5cf6',
  },
  {
    name: 'command',
    label: 'Command',
    plural: 'Commands',
    icon: Terminal,
    accent: 'text-orange-500',
    border: 'border-t-orange-500',
    hex: '#f97316',
  },
  {
    name: 'note',
    label: 'Note',
    plural: 'Notes',
    icon: StickyNote,
    accent: 'text-yellow-300',
    border: 'border-t-yellow-300',
    hex: '#fde047',
  },
  {
    name: 'link',
    label: 'Link',
    plural: 'Links',
    icon: Link,
    accent: 'text-emerald-500',
    border: 'border-t-emerald-500',
    hex: '#10b981',
  },
  {
    name: 'file',
    label: 'File',
    plural: 'Files',
    icon: File,
    accent: 'text-gray-500',
    border: 'border-t-gray-500',
    hex: '#6b7280',
    pro: true,
  },
  {
    name: 'image',
    label: 'Image',
    plural: 'Images',
    icon: Image,
    accent: 'text-pink-500',
    border: 'border-t-pink-500',
    hex: '#ec4899',
    pro: true,
  },
] as const satisfies readonly ItemTypeMeta[]

// Keyed by plain string so an untrusted route param (`/items/<bad>`) can be looked up
// directly — an unknown name simply misses and returns undefined.
const BY_NAME = new Map<string, ItemTypeMeta>(ITEM_TYPES.map((t) => [t.name, t]))

export function itemTypeMeta(name: string): ItemTypeMeta | undefined {
  return BY_NAME.get(name)
}

// Which types carry editable text content, and which of those use a code editor (with a language).
// Mirrors the backend's ITEM_TYPES_WITH_CONTENT / ITEM_TYPES_WITH_CODE_EDITOR sets.
const CONTENT_TYPES: ReadonlySet<string> = new Set(['snippet', 'command', 'prompt', 'note'])
const CODE_EDITOR_TYPES: ReadonlySet<string> = new Set(['snippet', 'command'])

/** True if the type stores editable text content (snippet/command/prompt/note). */
export function typeHasContent(name: string): boolean {
  return CONTENT_TYPES.has(name)
}

/** True if the type's content is code shown in a syntax-highlighted editor (snippet/command). */
export function typeHasCodeEditor(name: string): boolean {
  return CODE_EDITOR_TYPES.has(name)
}
