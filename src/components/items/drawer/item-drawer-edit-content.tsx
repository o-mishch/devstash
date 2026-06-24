'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X, Check } from 'lucide-react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { LanguageInput } from '@/components/shared/item-content-input'
import { ItemFormFields } from '@/components/items/item-form-fields'
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog'
import { useUpdateItem, type TextItemTypeName } from '@/hooks/items/use-update-item'
import type { UpdateItemInput } from '@/lib/utils/validators'
import { useDirtyGuard } from '@/hooks/ui/use-dirty-guard'
import { useVisualViewport } from '@/hooks/ui/use-visual-viewport'
import { useRegisterSheetClose, type SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'
import { DrawerLayout, DrawerDetailsSection } from './drawer-shared'
import { ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL, TEXT_ITEM_TYPE_NAMES, SYSTEM_TYPE_ORDER, remapLanguageForType } from '@/lib/utils/constants'
import { cn, getTypeLabel, actionbarLabelClass, ACTIONBAR_BUTTON_CLASS } from '@/lib/utils'
import { itemFormBaseSchema } from '@/lib/utils/validators'
import { parseTagString } from '@/lib/utils/format'
import type { FullItem } from '@/types/item'
import type { CollectionPickerItem } from '@/types/collection'

// URL shape ("must look like a URL") is validated by `itemFormBaseSchema.url`; this only adds the
// per-type presence gate — link items require a non-empty URL.
const createDrawerFormSchema = (itemType: string) => itemFormBaseSchema.superRefine((data, ctx) => {
  if (ITEM_TYPES_WITH_URL.has(itemType) && !data.url) {
    ctx.addIssue({
      code: 'custom',
      message: 'URL is required for this item type',
      path: ['url'],
    })
  }
})

type DrawerFormValues = z.infer<ReturnType<typeof createDrawerFormSchema>>

interface ItemDrawerEditContentProps {
  item: FullItem
  /** Read-only chips for the draft drawer's shared save target; defaults to `[]` for the editable item drawer. */
  collections?: CollectionPickerItem[]
  onClose: () => void
  onSave: (updated: FullItem) => void
  onCancel: () => void
  /**
   * Ref that this component writes its guarded-close handler into. The parent
   * Sheet reads it on Esc/backdrop so those paths also go through the dirty guard.
   */
  sheetCloseRef?: SheetCloseRef
  /**
   * When provided, Save calls this instead of the real-item `useUpdateItem` flow — letting a
   * non-`Item` consumer (the Brain Dump draft drawer) reuse this exact edit form while routing the
   * write to its own endpoint. The override owns its success toast / cache update / close; this
   * component only awaits it so the Save button shows the saving state. `onSave` is not called in
   * override mode.
   */
  onSubmitOverride?: (payload: UpdateItemInput) => Promise<void>
  /**
   * Hide the Created/Updated "Details" footer. The Brain Dump draft drawer sets this false — a draft is
   * not a saved item, so its timestamps are not meaningful. Defaults to shown for the real item drawer.
   */
  showDetailsSection?: boolean
  /**
   * Override the primary save button's label. The Brain Dump draft drawer passes "Save draft" (a draft
   * is staged, not a committed item). Defaults to "Save" for the real item drawer.
   */
  saveLabel?: string
  /**
   * When set, a tooltip is shown on the primary save button (the Brain Dump draft drawer uses it to
   * clarify "Save draft" vs "Commit"). Omitted for the real item drawer, which renders no save tooltip.
   */
  saveTooltip?: string
  /**
   * Extra action buttons rendered right-aligned in the action bar, after Cancel/Save. The Brain Dump
   * draft drawer injects Delete (→ trash) and Commit (→ live item) here. `disabled` mirrors the saving
   * state so the extras lock during a save.
   */
  renderExtraActions?: (state: { disabled: boolean }) => ReactNode
  /**
   * Render the Collections field as a read-only list of the passed `collections` instead of an editable
   * picker. The Brain Dump draft drawer uses it: a draft has no per-item collections — it inherits the
   * job's "Save items to collection" target — so the field shows that target but can't be changed here.
   */
  collectionsReadOnly?: boolean
  /** Mobile full-screen mode: render as document-flow content so the browser URL bar can collapse. */
  fullScreen?: boolean
}

// The four text types, in canonical order, rendered as the type-switch options.
const TEXT_TYPE_OPTIONS = SYSTEM_TYPE_ORDER.filter((name) => TEXT_ITEM_TYPE_NAMES.has(name))

export function ItemDrawerEditContent({ item, collections = [], onClose, onSave, onCancel, sheetCloseRef, onSubmitOverride, showDetailsSection = true, saveLabel = 'Save', saveTooltip, renderExtraActions, collectionsReadOnly, fullScreen = false }: ItemDrawerEditContentProps) {
  const { itemType } = item
  const committedType = itemType.name
  const updateItem = useUpdateItem()

  // Staged type change: switching the picker updates this local state only — nothing is persisted until
  // Save, which sends `itemTypeName` alongside the other field edits. The type switcher is offered only
  // when the item is already one of the four text types (for file/image/link its absence IS the boundary).
  const canSwitchType = TEXT_ITEM_TYPE_NAMES.has(committedType)
  const [pendingType, setPendingType] = useState(committedType)
  const typeName = pendingType
  const typeChanged = pendingType !== committedType

  // The drawer header icon + accent color follow the PENDING type so a staged switch is reflected
  // before Save (both `ItemIconWrapper` and the `--item-color` var key off `itemType.name`).
  const headerItemType = useMemo(() => ({ ...itemType, name: pendingType }), [itemType, pendingType])

  // The whole edit form re-derives from the pending type (language picker filter, content editor, the
  // per-type fields), so a staged switch is reflected live without persisting.
  const formSchema = useMemo(() => createDrawerFormSchema(typeName), [typeName])

  const form = useForm<DrawerFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: item.title,
      description: item.description ?? '',
      content: item.content ?? '',
      url: item.url ?? '',
      language: item.language ?? '',
      tags: item.tags.join(', '),
      collectionIds: item.collections.map((c) => c.id),
    }
  })

  const watchedLanguage = useWatch({ control: form.control, name: 'language' })
  const saving = form.formState.isSubmitting

  // The language a staged switch dropped (lossy), captured at switch time so the inline warning reflects
  // the value actually being cleared — including one the user edited before switching, not the stale
  // committed `item.language`. null when the switch kept (or remapped) the language.
  const [clearedLanguage, setClearedLanguage] = useState<string | null>(null)

  // The language as it stood the moment the user first switched away from the committed type, so an
  // A→B→A round-trip restores their in-progress edit rather than the stale committed `item.language`.
  const languageBeforeSwitchRef = useRef(item.language ?? '')

  // Switching the type re-derives the language for the new type (shell→bash on →command, cleared on
  // →note, etc.) so the visible field matches what Save will persist — staged, no network.
  const handleTypeChange = (next: string | null) => {
    if (!next || next === pendingType) return
    // Leaving the committed type: snapshot the current language so a later return can restore an edit
    // the user made before switching, not just the committed default.
    if (pendingType === committedType) {
      languageBeforeSwitchRef.current = form.getValues('language') ?? ''
    }
    setPendingType(next)
    // Returning to the original type (A→B→A): restore the snapshotted language. If it matches the
    // committed value, resetField clears the dirty/lossy state; if the user had edited it, keep it dirty.
    if (next === committedType) {
      setClearedLanguage(null)
      const restored = languageBeforeSwitchRef.current
      if (restored.trim() === (item.language ?? '').trim()) {
        form.resetField('language')
      } else {
        form.setValue('language', restored, { shouldDirty: true })
      }
      return
    }
    const current = form.getValues('language')?.trim() || null
    const remapped = remapLanguageForType(current, next)
    setClearedLanguage(current && remapped === null ? current : null)
    form.setValue('language', remapped ?? '', { shouldDirty: true })
  }

  // The pending switch dropped the current language (lossy) — surfaced as an inline note before Save.
  const languageWillClear = typeChanged && clearedLanguage !== null

  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(typeName)

  // A staged type change counts as a dirty edit too, so Cancel/close runs the unsaved guard.
  const isDirty = form.formState.isDirty || typeChanged

  // X button closes the whole drawer; Cancel returns to view mode. Both need
  // the same dirty guard, so a ref tracks which action to run on confirm.
  const pendingActionRef = useRef<(() => void)>(onCancel)
  const { confirmOpen, handleConfirmOpenChange, handleDiscard, handleOpenChange } = useDirtyGuard({
    isDirty,
    onClose: () => pendingActionRef.current(),
  })

  function guardedAction(action: () => void) {
    pendingActionRef.current = action
    handleOpenChange(false)
  }

  // Expose guarded-close to the parent Sheet so Esc/backdrop go through the guard too.
  // Cleared on unmount so view-mode Esc closes normally.
  useRegisterSheetClose(sheetCloseRef, () => guardedAction(onClose))

  const handleSubmit = form.handleSubmit(async (data: DrawerFormValues) => {
    const tagArray = parseTagString(data.tags)
    const payload: UpdateItemInput = {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      content: data.content || null,
      url: data.url?.trim() || null,
      language: data.language?.trim() || null,
      tags: tagArray,
      collectionIds: data.collectionIds,
      // Persist the staged type change with the rest of the edits (omitted when unchanged).
      ...(typeChanged ? { itemTypeName: pendingType as TextItemTypeName } : {}),
    }
    // Brain Dump draft reuse: route the save to the draft endpoint instead of the real-item flow.
    if (onSubmitOverride) {
      await onSubmitOverride(payload)
      return
    }
    await updateItem(item, payload, { onSave })
  })

  // Save is disabled when there's nothing to save (no field edit + no staged type change), so a no-op
  // save can't run. The TooltipTrigger sits on a span wrapper, not the Button — a disabled Button has
  // `pointer-events:none` and would never fire hover, so the explanatory "No changes to save" tooltip
  // would be unreachable on the very state it explains. When dirty, the tooltip falls back to the
  // consumer's `saveTooltip` (the draft drawer's copy); the real item drawer passes none, so the
  // editable button shows no tooltip.
  // When the virtual keyboard opens the browser shrinks the visual viewport without scrolling the focused
  // input into view, so it can sit hidden behind the keyboard. We scroll it back above the keyboard
  // whenever the keyboard height changes. The scroller differs by mode: full-screen mode scrolls the
  // <html> document (document.scrollingElement); Sheet mode scrolls the inner ScrollArea viewport that
  // wraps the focused field. `keyboardHeight` comes from useVisualViewport (its formula is iOS-robust —
  // see that hook; a naive innerHeight-only inset collapses to 0 on some iOS versions). document is
  // required: the focused element and its scroll container are queried from the live DOM.
  const viewport = useVisualViewport()
  const keyboardHeight = viewport?.keyboardHeight ?? 0
  // The keyboard's top edge in client coords — the shared visible-bottom reference from useVisualViewport
  // (offsetTop + height), so the field-reveal math here matches the editor overlay's clip and the bottom
  // sheet's lift instead of each re-deriving it. 0 when the viewport API is unavailable.
  const visibleBottom = viewport?.visibleBottom ?? 0
  useEffect(() => {
    if (keyboardHeight <= 0) return

    // Scroll the focused field above the keyboard. Re-runs when the keyboard height changes AND on every
    // focus change while it is up (focusin) — tapping a different, lower field with the keyboard already
    // open leaves keyboardHeight unchanged, so without this the newly-focused field stays hidden.
    const reveal = () => {
      // document.activeElement: React has no hook for the currently focused element.
      const active = document.activeElement as HTMLElement | null
      // document.body: sentinel for "no real element focused"; no React equivalent.
      if (!active || active === document.body) return

      // Full-screen mode: the document is the scroller. Sheet mode: walk up to the ScrollArea viewport.
      let scroller: HTMLElement | null = null
      if (!fullScreen) {
        scroller = active.parentElement
        while (scroller && scroller.dataset.slot !== 'scroll-area-viewport') {
          scroller = scroller.parentElement
        }
        // No viewport ancestor (e.g. a portaled editor field) — bail. Falling back to the document
        // scroller would be a no-op here: the Sheet locks document scroll, so scrollBy moves nothing
        // and the field would stay hidden behind the keyboard. Full-screen mode has no such lock.
        if (!scroller) return
      } else {
        // document.scrollingElement: the document-level scroll container; no React/Next equivalent.
        scroller = document.scrollingElement as HTMLElement | null
        if (!scroller) return
      }

      const scrollerRect = scroller.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      // Lowest the focused field may rest: above the keyboard (shared visibleBottom) AND within the
      // scroller. 12px breathing room so the field sits just on top of the keyboard, not flush against it.
      const restBottom = Math.min(scrollerRect.bottom, visibleBottom)
      // Amount the focused element overshoots below that line (positive = hidden behind keyboard).
      const overshoot = activeRect.bottom + 12 - restBottom

      if (overshoot > 0) {
        scroller.scrollBy({ top: overshoot, behavior: 'smooth' })
      }
    }

    reveal()
    // document.addEventListener: React has no mechanism for listening to focusin at the document level.
    document.addEventListener('focusin', reveal)
    return () => document.removeEventListener('focusin', reveal)
  }, [keyboardHeight, visibleBottom, fullScreen])

  const hasExtras = Boolean(renderExtraActions)
  // Mobile-only restyle of the regular 2-button edit bar (no injected extras): drop the full-width
  // stretch so both buttons sit compact and left-aligned like the desktop view-mode action bar —
  // instead of two heavy full-bleed blocks. Desktop is unchanged (the `max-sm:` overrides go inert),
  // and the dense draft bar (with extras) keeps flex-1 + w-full so it still wraps into a balanced 2×2.
  // Cancel reads as ghost on mobile by clearing its outline chrome.
  const cancelButtonClass = hasExtras
    ? ACTIONBAR_BUTTON_CLASS
    : 'touch:h-11 max-sm:border-transparent max-sm:bg-transparent max-sm:shadow-none'
  const saveButtonClass = hasExtras ? cn(ACTIONBAR_BUTTON_CLASS, 'max-sm:w-full') : 'touch:h-11'
  const saveWrapperClass = hasExtras ? 'inline-flex max-sm:flex-1' : 'inline-flex'

  // Save's label-reveal threshold: in the dense draft bar (Cancel · Save · Delete · Commit) it sits at
  // position 1, so it reveals progressively as that bar widens. In the regular 2-button edit bar there's
  // only Cancel · Save, which always fits both labels — so Save reveals at the SAME low threshold as
  // Cancel (index 0) instead of staying icon-only while Cancel shows its text.
  const saveButton = (
    <Button size="sm" onClick={handleSubmit} disabled={saving || !isDirty} className={saveButtonClass} aria-label={saveLabel}>
      <Check className="size-4" />
      <span className={actionbarLabelClass(hasExtras ? 1 : 0)}>{saving ? 'Saving…' : saveLabel}</span>
    </Button>
  )
  const saveButtonTooltip = !isDirty ? 'No changes to save' : saveTooltip
  const saveAction = saveButtonTooltip ? (
    <Tooltip>
      <TooltipTrigger render={<span className={saveWrapperClass}>{saveButton}</span>} />
      <TooltipContent>{saveButtonTooltip}</TooltipContent>
    </Tooltip>
  ) : (
    saveButton
  )

  return (
    <>
      <DrawerLayout
        fullScreen={fullScreen}
        itemType={headerItemType}
        onClose={() => guardedAction(onClose)}
        titleArea={
          <>
            <div className="relative w-full">
              <Textarea
                {...form.register('title')}
                placeholder="Item title"
                rows={1}
                // touch:min-h-0 cancels the Textarea primitive's touch upsize so this inline
                // title stays as compact as the read drawer's h2 (no downward shift in edit mode).
                className="-my-1 min-h-0 touch:min-h-0 w-full resize-none border-transparent bg-transparent px-2 py-1 -ml-2 text-base font-semibold leading-snug shadow-none transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:text-sm"
              />
              {form.formState.errors.title && (
                <p className="absolute -bottom-5 left-0 text-red-500 text-[10px]">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div className="mt-1.5 flex flex-nowrap items-center gap-1.5 max-sm:mt-1">
              {canSwitchType ? (
                <Select value={pendingType} onValueChange={handleTypeChange}>
                  <SelectTrigger size="sm" className="h-7 w-auto gap-1.5 rounded-full px-2.5 text-xs capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  {/* alignItemWithTrigger={false}: a plain dropdown-below-trigger with the smooth
                      fade/zoom/slide open, matching the create-item dialog's type picker. */}
                  <SelectContent alignItemWithTrigger={false}>
                    {TEXT_TYPE_OPTIONS.map((name) => (
                      <SelectItem key={name} value={name} className="capitalize">
                        <ItemTypeIcon typeName={name} className="size-3.5" />
                        {getTypeLabel(name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium capitalize text-secondary-foreground">
                  {typeName}
                </span>
              )}
              {showLanguage && (
                <div className="relative">
                  <Controller
                    control={form.control}
                    name="language"
                    render={({ field }) => (
                      <LanguageInput
                        id="drawer-language"
                        value={field.value || ''}
                        onChange={field.onChange}
                        placeholder="Language"
                        itemType={typeName}
                        fit
                        // Match the item-type Select trigger sitting beside it: same h-7 content-sized
                        // box, gap/padding, text-xs, and corner radius. The sm SelectTrigger renders at
                        // rounded-[min(var(--radius-md),10px)] (its size variant overrides rounded-full),
                        // so use that exact radius here instead of rounded-full to get the same shape.
                        className="h-7 touch:h-7 w-auto gap-1.5 rounded-[min(var(--radius-md),10px)] border-border bg-background px-2.5 py-0 text-xs capitalize shadow-none transition-colors dark:bg-input/30 dark:hover:bg-input/50 focus-visible:bg-transparent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      />
                    )}
                  />
                  {form.formState.errors.language && (
                    <p className="absolute top-7 left-0 text-red-500 text-[10px] whitespace-nowrap">{form.formState.errors.language.message}</p>
                  )}
                </div>
              )}
            </div>
            {languageWillClear && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Language “{clearedLanguage}” will be cleared when you save as {getTypeLabel(pendingType)}.
              </p>
            )}
          </>
        }
        actionArea={
          // Tooltips (the optional Save tooltip + any the consumer renders in `renderExtraActions`, e.g.
          // the draft drawer's Commit) are scoped by the single TooltipProvider in DrawerLayout.
          <>
            {/* touch:h-11 matches the view action bar's height (its Delete button is a 44px
                touch target), so the content editor sits at the same vertical position in both modes.
                max-sm:flex-1 lets the buttons share the row evenly on mobile so a dense bar (the draft
                drawer's Cancel · Save draft · Delete · Commit) wraps into a balanced 2×2 instead of
                clipping or right-floating its last buttons. */}
            <Button variant="outline" size="sm" onClick={() => guardedAction(onCancel)} disabled={saving} className={cancelButtonClass} aria-label="Cancel">
              <X className="size-4" />
              <span className={actionbarLabelClass(0)}>Cancel</span>
            </Button>
            {saveAction}
            {/* Consumer-injected extras (Brain Dump draft: Delete → trash, Commit → live item).
                ml-auto floats them to the right edge when there's space; at narrow widths the
                container query collapses all buttons to icon-only so they all fit on one row. */}
            {renderExtraActions && (
              <div className="flex items-center gap-0.5 ml-auto max-sm:contents">{renderExtraActions({ disabled: saving })}</div>
            )}
          </>
        }
      >
        <ItemFormFields
          form={form}
          itemContext={{
            itemType: typeName,
            fileName: item.fileName,
            fileSize: item.fileSize,
          }}
          watchedLanguage={watchedLanguage}
          collections={collections}
          collectionsReadOnly={collectionsReadOnly}
          variant="drawer"
        />

        {showDetailsSection && <DrawerDetailsSection item={item} />}
      </DrawerLayout>
      <UnsavedChangesDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </>
  )
}
