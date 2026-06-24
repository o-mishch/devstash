'use client'

import Link from 'next/link'
import { Settings, User, LogOut, Sun, Moon } from 'lucide-react'
import { useResolvedEditorPreferences, useUpdateEditorPreferences } from '@/hooks/use-editor-preferences'
import { startThemeTransition } from '@/lib/dom/theme-transition'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { signOut } from 'next-auth/react'
import { useResetProfile } from '@/hooks/use-profile'

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
  const { colorMode } = useResolvedEditorPreferences()
  const updateEditorPreferences = useUpdateEditorPreferences()
  const resetProfile = useResetProfile()

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
      <DropdownMenuItem onClick={(e) => {
        startThemeTransition(e, () => {
          void updateEditorPreferences({ colorMode: colorMode === 'dark' ? 'light' : 'dark' })
        })
      }}>
        {colorMode === 'dark' ? (
          <>
            <Sun className="size-4" />
            Light Mode
          </>
        ) : (
          <>
            <Moon className="size-4" />
            Dark Mode
          </>
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => {
        // Drop the /profile cache so the next account on this device never sees the prior user's
        // emails (PII).
        resetProfile()
        signOut({ redirectTo: '/' })
        onClose?.()
      }} className="text-red-500 focus:text-red-500">
        <LogOut className="size-4" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
