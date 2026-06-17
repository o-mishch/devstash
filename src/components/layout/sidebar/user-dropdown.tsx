'use client'

import Link from 'next/link'
import { Settings, User, LogOut } from 'lucide-react'
import { useTheme } from 'next-themes'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { signOut } from 'next-auth/react'
import { DEFAULT_EDITOR_PREFERENCES } from '@/types/editor-preferences'
import { useProfileEmailsStore } from '@/stores/profile-emails'

interface UserDropdownMenuContentProps {
  side: 'top' | 'right' | 'bottom' | 'left'
  align: 'start' | 'center' | 'end'
  onClose?: () => void
}

export function UserDropdownMenuContent({
  side,
  align,
  onClose
}: UserDropdownMenuContentProps) {
  const { setTheme } = useTheme()

  return (
    <DropdownMenuContent
      side={side}
      align={align}
      // Pronounced, mirrored vertical slide: opening from the bottom-left sidebar (side=top) glides
      // up from below; closing glides back down. The -3 distance overrides the base's subtle -2, and
      // the data-closed slide-out (missing from the base) makes the close mirror the open.
      className="w-52 data-[side=top]:slide-in-from-bottom-3 data-[side=top]:data-closed:slide-out-to-bottom-3 data-[side=bottom]:slide-in-from-top-3 data-[side=bottom]:data-closed:slide-out-to-top-3"
    >
      <DropdownMenuItem render={
        <Link href="/profile" onClick={() => onClose?.()} prefetch={false}>
          <User className="size-4" />
          Profile
        </Link>
      } />
      <DropdownMenuItem render={
        <Link href="/settings" onClick={() => onClose?.()} prefetch={false}>
          <Settings className="size-4" />
          Settings
        </Link>
      } />
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => {
        setTheme(DEFAULT_EDITOR_PREFERENCES.appTheme)
        // Clear user-scoped client state so the next account on this device never sees the prior
        // user's emails (PII) from the module-global store.
        useProfileEmailsStore.getState().reset()
        signOut({ redirectTo: '/' })
        onClose?.()
      }} className="text-red-500 focus:text-red-500">
        <LogOut className="size-4" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
