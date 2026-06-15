'use client'

import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useOrpcFormAction } from '@/hooks/use-orpc-form-action'
import { orpcClient } from '@/lib/api/client'

interface EditableNameProps {
  name: string | null
}

export function EditableName({ name }: EditableNameProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  // Committed name shown in view mode. We own this client-side so the new name
  // appears instantly on save — the server component re-render lags behind the
  // route handler's stale-while-revalidate cache invalidation.
  const [displayName, setDisplayName] = useState(name ?? '')
  const [value, setValue] = useState(name ?? '')

  const { formAction, isPending } = useOrpcFormAction((body) => orpcClient.profile.updateName({ name: body.name }), {
    onSuccess: () => {
      setDisplayName(value.trim())
      toast.success('Name updated.')
      setEditing(false)
      router.refresh()
    },
  })

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue(displayName)
      setEditing(false)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 font-medium">
      {editing ? (
        <form action={formAction} className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            autoFocus
            name="name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
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
            onClick={() => { setValue(displayName); setEditing(false) }}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            aria-label="Cancel"
          >
            <X className="size-3.5" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex min-w-0 items-center gap-1.5 truncate hover:text-foreground/80"
        >
          <span className="truncate">{displayName || 'No name set'}</span>
          <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      )}
    </div>
  )
}
