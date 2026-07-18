import type { ComponentProps, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react'
import { useLogout } from '@/auth/use-logout'
import { useEditorPreferences, useUpdatePreferences } from '@/hooks/use-preferences'
import { normalizeColorMode } from '@/lib/theme'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

// Positioning is the caller's business: the expanded sidebar's user card anchors it above, the
// collapsed rail's settings button anchors it to the right.
type UserDropdownMenuContentProps = Pick<
  ComponentProps<typeof DropdownMenuContent>,
  'side' | 'align'
>

/**
 * The shared user menu: Profile / Settings / color-mode toggle / Sign out. Rendered from both
 * sidebar variants, so it lives here rather than inside either one.
 */
export function UserDropdownMenuContent({
  side,
  align = 'end',
}: UserDropdownMenuContentProps): ReactNode {
  const logout = useLogout()
  const { data: prefs } = useEditorPreferences()
  const updatePrefs = useUpdatePreferences()

  const colorMode = normalizeColorMode(prefs?.colorMode)
  const nextMode = colorMode === 'dark' ? 'light' : 'dark'

  return (
    <DropdownMenuContent side={side} align={align} className="w-56">
      <DropdownMenuItem render={<Link to="/profile" />}>
        <UserRound className="size-4" />
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem render={<Link to="/settings" />}>
        <Settings className="size-4" />
        Settings
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => updatePrefs.mutate({ body: { colorMode: nextMode } })}
        closeOnClick={false}
      >
        {colorMode === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {colorMode === 'dark' ? 'Light mode' : 'Dark mode'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => logout.mutate({})}
        className="text-destructive data-[highlighted]:text-destructive"
      >
        <LogOut className="size-4" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
