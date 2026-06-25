import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'
import type { FullItem } from '@/types/item'

// Maps a Brain Dump draft onto the FullItem shape the shared item drawer edit form renders.
// The drawer reads title/type/content/language/url/description/tags for editing; list/meta
// fields are inert defaults so a draft — an AiParseJobItem row, not a real Item — can drive
// the same form without a real item fetch. `id` carries the draft id for form keying only.
export function draftToFullItem(item: BrainDumpDraftItem): FullItem {
  return {
    id: item.id,
    title: item.title,
    itemType: { name: item.itemTypeName },
    content: item.content ?? null,
    language: item.language ?? null,
    url: item.url ?? null,
    description: item.description ?? null,
    tags: item.tags,
    descriptionPreview: item.description ?? null,
    contentPreview: item.content ?? null,
    fileName: null,
    fileSize: null,
    isFavorite: false,
    isPinned: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    collections: [],
  }
}
