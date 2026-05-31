'use client'

import Image from 'next/image'
import { ExternalLink, Tag, Download, FileIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemContentView } from '@/components/shared/item-content-view'
import { ItemTags } from '@/components/shared/item-tags'
import { DrawerLayout, DrawerSection, DrawerSharedSections } from './drawer-shared'
import { ItemDrawerActionBar } from './item-drawer-action-bar'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import type { Item, LightItem } from '@/types/item'

interface FileSectionProps {
  item: LightItem | Item
}

function FileSectionContent({ item }: FileSectionProps) {
  if (!item.fileUrl) return <p className="text-sm text-muted-foreground">—</p>

  if (item.itemType.name === 'image') {
    return (
      <div className="flex justify-center">
        <div className="group relative flex max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
          <Image
            src={`/api/download/${item.id}`}
            alt={item.fileName ?? item.title}
            width={0}
            height={0}
            unoptimized
            priority
            className="h-auto w-auto max-h-[50vh] max-w-full object-contain"
          />
          <a
            href={`/api/download/${item.id}`}
            download={item.fileName ?? item.title}
            className="absolute right-2 top-2 rounded-md bg-background/50 p-1.5 backdrop-blur-sm transition-colors hover:bg-background/80 opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Download image"
          >
            <Download className="size-4 text-foreground" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.fileName ?? '—'}</p>
        {item.fileSize != null && (
          <p className="text-xs text-muted-foreground">{formatBytes(item.fileSize)}</p>
        )}
      </div>
      <a href={`/api/download/${item.id}`} download={item.fileName ?? item.title}>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0">
          <Download className="size-3.5" />
        </Button>
      </a>
    </div>
  )
}

interface ItemDrawerViewContentProps {
  item: LightItem | Item
  isLight: boolean
  onClose: () => void
  onEdit: () => void
  onDeleted: () => void
}

export function ItemDrawerViewContent({ item, isLight, onClose, onEdit, onDeleted }: ItemDrawerViewContentProps) {
  const { itemType } = item
  const fullItem = isLight ? null : (item as Item)
  const description = isLight ? (item as LightItem).descriptionPreview : (item as Item).description

  return (
    <DrawerLayout
      itemType={itemType}
      onClose={onClose}
      titleArea={
        <>
          <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="capitalize">{itemType.name}</Badge>
            {fullItem?.language && <Badge variant="outline">{fullItem.language}</Badge>}
          </div>
        </>
      }
      actionArea={
        <ItemDrawerActionBar
          item={item}
          isLight={isLight}
          fullItem={fullItem}
          onEdit={onEdit}
          onDeleted={onDeleted}
        />
      }
    >
      {ITEM_TYPES_WITH_CONTENT.has(itemType.name) && (
        <DrawerSection label="Content" className="flex flex-col shrink-0">
          {isLight ? (
            <Skeleton className="w-full rounded-md min-h-[72px] max-h-[clamp(72px,30vh,400px)]" />
          ) : (
            <div className="overflow-hidden rounded-lg flex flex-col min-h-[72px] max-h-[clamp(72px,30vh,400px)]">
              <ItemContentView
                itemType={itemType.name}
                content={fullItem!.content}
                language={fullItem!.language}
              />
            </div>
          )}
        </DrawerSection>
      )}

      {ITEM_TYPES_WITH_FILE.has(itemType.name) && (
        <DrawerSection label={itemType.name === 'image' ? 'Image' : 'File'}>
          <FileSectionContent item={item} />
        </DrawerSection>
      )}

      <DrawerSection label="Description">
        {description ? (
          <p className="text-sm leading-relaxed">{description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </DrawerSection>

      {ITEM_TYPES_WITH_URL.has(itemType.name) && (
        <DrawerSection label="URL">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline break-all">
              {item.url}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </DrawerSection>
      )}

      <DrawerSection label="Tags" icon={<Tag className="size-3" />}>
        {item.tags.length > 0 ? (
          <ItemTags tags={item.tags} />
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </DrawerSection>

      {fullItem && <DrawerSharedSections item={fullItem} />}
    </DrawerLayout>
  )
}
