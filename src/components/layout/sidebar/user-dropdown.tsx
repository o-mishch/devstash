'use client'

import { useCallback, useRef, type MouseEvent } from 'react'
import Link from 'next/link'
import type { HTMLProps } from '@base-ui/react/types'
import { Settings, User, LogOut, Sun, Moon } from 'lucide-react'
import { useResolvedEditorPreferences, useUpdateEditorPreferences } from '@/hooks/editor/use-editor-preferences'
import { startThemeTransition, type TransitionEventCoords } from '@/lib/dom/theme-transition'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { signOut } from 'next-auth/react'
import { useResetProfile } from '@/hooks/profile/use-profile'

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

  const closeMenu = useCallback(() => {
    onClose?.()
  }, [onClose])

  // Base UI's function-form render prop is invoked on every render, so an inline `onClick` that
  // closes over `linkProps` would itself be a new-function-per-render prop on the Link. Instead we
  // stash the latest Base UI-computed onClick (its own closeOnClick/keyboard-nav handler) in a ref —
  // written synchronously on each render, before any click can fire — and hand the Link a single
  // stable callback that reads it at click time and composes our own `closeMenu()` after it.
  const profileLinkOnClickRef = useRef<HTMLProps<HTMLAnchorElement>['onClick']>(undefined)
  const handleProfileLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      profileLinkOnClickRef.current?.(event)
      closeMenu()
    },
    [closeMenu],
  )
  const renderProfileLink = useCallback(
    (linkProps: HTMLProps<HTMLAnchorElement>) => {
      profileLinkOnClickRef.current = linkProps.onClick
      return (
        <Link href="/profile" prefetch={false} {...linkProps} onClick={handleProfileLinkClick}>
          <User className="size-4" />
          Profile
        </Link>
      )
    },
    [handleProfileLinkClick],
  )

  const settingsLinkOnClickRef = useRef<HTMLProps<HTMLAnchorElement>['onClick']>(undefined)
  const handleSettingsLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      settingsLinkOnClickRef.current?.(event)
      closeMenu()
    },
    [closeMenu],
  )
  const renderSettingsLink = useCallback(
    (linkProps: HTMLProps<HTMLAnchorElement>) => {
      settingsLinkOnClickRef.current = linkProps.onClick
      return (
        <Link href="/settings" prefetch={false} {...linkProps} onClick={handleSettingsLinkClick}>
          <Settings className="size-4" />
          Settings
        </Link>
      )
    },
    [handleSettingsLinkClick],
  )

  const handleToggleColorMode = useCallback(
    (event: TransitionEventCoords) => {
      startThemeTransition(event, () => {
        void updateEditorPreferences({ colorMode: colorMode === 'dark' ? 'light' : 'dark' })
      })
    },
    [colorMode, updateEditorPreferences],
  )

  const handleSignOut = useCallback(() => {
    // Drop the /profile cache so the next account on this device never sees the prior user's
    // emails (PII).
    resetProfile()
    void signOut({ redirectTo: '/' })
    onClose?.()
  }, [resetProfile, onClose])

  return (
    <DropdownMenuContent
      side={side}
      align={align}
      // Pronounced, mirrored vertical slide: opening from the bottom-left sidebar (side=top) glides
      // up from below; closing glides back down. The -3 distance overrides the base's subtle -2, and
      // the data-closed slide-out (missing from the base) makes the close mirror the open.
      className="w-52 data-[side=top]:slide-in-from-bottom-3 data-[side=top]:data-closed:slide-out-to-bottom-3 data-[side=bottom]:slide-in-from-top-3 data-[side=bottom]:data-closed:slide-out-to-top-3"
    >
      <DropdownMenuItem render={renderProfileLink} />
      <DropdownMenuItem render={renderSettingsLink} />
      <DropdownMenuItem onClick={handleToggleColorMode}>
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
      <DropdownMenuItem onClick={handleSignOut} className="text-red-500 focus:text-red-500">
        <LogOut className="size-4" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
