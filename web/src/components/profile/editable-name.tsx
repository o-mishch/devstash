import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, SyntheticEvent } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useUpdateProfile } from '@/hooks/use-profile'
import { hasText } from '@/lib/utils'

interface EditableNameProps {
  name: string | null
}

/** The display name with an inline edit affordance; saves via PATCH /me/profile. */
export function EditableName({ name }: EditableNameProps): ReactNode {
  const update = useUpdateProfile()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const currentName = name ?? ''

  // Focus the field when edit mode opens (not on page load) — a ref effect rather than the
  // autoFocus attribute, which the a11y lint rightly flags for load-time focus stealing.
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEditing = (): void => {
    setValue(currentName)
    setEditing(true)
  }

  const cancel = (): void => {
    setValue(currentName)
    setEditing(false)
  }

  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    update.mutate({ body: { name: trimmed } }, { onSuccess: () => setEditing(false) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') cancel()
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={update.isPending}
          maxLength={100}
          className="min-w-0 flex-1 truncate rounded-md border border-input bg-transparent px-2 py-0.5 text-sm font-medium outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={update.isPending || value.trim().length === 0}
          aria-label="Save name"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <Check className="size-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={update.isPending}
          aria-label="Cancel"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <X className="size-4" />
        </button>
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="group flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/80"
    >
      <span className="truncate">{hasText(currentName) ? currentName : 'No name set'}</span>
      <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
    </button>
  )
}
