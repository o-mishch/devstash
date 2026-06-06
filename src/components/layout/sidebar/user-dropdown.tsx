'use client'

import Link from 'next/link'
import { Settings, User, LogOut } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { signOut } from 'next-auth/react'
import { THEME_STORAGE_KEY } from '@/lib/utils/constants'
import { DEFAULT_EDITOR_PREFERENCES } from '@/types/editor-preferences'

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
    <DropdownMenuContent side={side} align={align} className="w-52">
      <DropdownMenuItem render={
        <Link href="/profile" onClick={() => onClose?.()}>
          <User className="size-4" />
          Profile
        </Link>
      } />
      <DropdownMenuItem render={
        <Link href="/settings" onClick={() => onClose?.()}>
          <Settings className="size-4" />
          Settings
        </Link>
      } />
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => {
        localStorage.removeItem(THEME_STORAGE_KEY)
        setTheme(DEFAULT_EDITOR_PREFERENCES.appTheme)
        signOut({ redirectTo: '/' })
        onClose?.()
      }} className="text-red-500 focus:text-red-500">
        <LogOut className="size-4" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
