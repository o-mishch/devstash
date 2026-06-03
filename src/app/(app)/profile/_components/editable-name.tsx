'use client'

import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'
import { updateNameAction } from '@/actions/profile'

interface EditableNameProps {
  name: string | null
}

export function EditableName({ name }: EditableNameProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name ?? '')

  const { formAction, isPending } = useActionStateWithToast(updateNameAction, {
    onSuccess: () => {
      toast.success('Name updated.')
      setEditing(false)
    },
  })

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue(name ?? '')
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
            onClick={() => { setValue(name ?? ''); setEditing(false) }}
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
          <span className="truncate">{name ?? 'No name set'}</span>
          <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      )}
    </div>
  )
}
