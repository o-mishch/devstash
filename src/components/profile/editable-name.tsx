'use client'

import { useCallback, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useApiFormAction } from '@/hooks/ui/use-api-form-action'
import { api } from '@/lib/api/client'
import { useUserProfile, usePatchUserProfile } from '@/hooks/profile/use-user-profile'
import { usePatchProfile } from '@/hooks/profile/use-profile'

interface EditableNameProps {
  name: string | null
}

export function EditableName({ name }: EditableNameProps) {
  const { data: profile } = useUserProfile()
  const patchUserProfile = usePatchUserProfile()
  const patchProfile = usePatchProfile()
  const [editing, setEditing] = useState(false)
  const currentName = profile?.name ?? name ?? ''
  const [value, setValue] = useState(currentName)

  const { formAction, isPending } = useApiFormAction(async (body) => {
    const { error } = await api.PATCH('/profile/name', { body: { name: body.name } })
    if (error) throw new Error(error.message)
  }, {
    onSuccess: () => {
      // Patch /profile/me (sidebar) and /profile (page avatar/name) so both reflect the rename instantly.
      patchUserProfile({ name: value.trim() })
      patchProfile({ name: value.trim() })
      toast.success('Name updated.')
      setEditing(false)
    },
  })

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setValue(currentName)
      setEditing(false)
    }
  }, [currentName])

  const handleValueChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value)
  }, [])

  const handleCancel = useCallback(() => {
    setValue(currentName)
    setEditing(false)
  }, [currentName])

  const handleStartEditing = useCallback(() => {
    setValue(currentName)
    setEditing(true)
  }, [currentName])

  return (
    <div className="flex min-w-0 items-center gap-1.5 font-medium">
      {editing ? (
        <form action={formAction} className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            // This input only renders after the user clicks edit, so autoFocus follows their
            // explicit action rather than surprising them on page load — an accepted UX pattern
            // despite the rule's page-load-focused warning.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            name="name"
            value={value}
            onChange={handleValueChange}
            onKeyDown={handleKeyDown}
            disabled={isPending}
            maxLength={64}
            className="min-w-0 flex-1 truncate rounded border border-input bg-transparent px-2 py-0.5 text-sm font-medium outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isPending || !value.trim()}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            aria-label="Save"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancel}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            aria-label="Cancel"
          >
            <X className="size-3.5" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={handleStartEditing}
          className="group flex min-w-0 items-center gap-1.5 truncate hover:text-foreground/80"
        >
          <span className="truncate">{currentName || 'No name set'}</span>
          <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      )}
    </div>
  )
}
