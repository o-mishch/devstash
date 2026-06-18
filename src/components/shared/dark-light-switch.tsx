'use client'

import type { MouseEvent } from 'react'
import { Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { startThemeTransition } from '@/lib/utils/theme-transition'

interface DarkLightSwitchProps {
  colorMode: 'light' | 'dark'
  onColorModeChange: (mode: 'light' | 'dark') => void
  className?: string
}

export function DarkLightSwitch({ colorMode, onColorModeChange, className }: DarkLightSwitchProps) {
  const isLight = colorMode === 'light'

  const handleClick = (e: MouseEvent<HTMLButtonElement>, mode: 'light' | 'dark') => {
    startThemeTransition(e, () => onColorModeChange(mode))
  }

  return (
    <div className={cn('relative inline-grid grid-cols-2 rounded-lg border border-border bg-card p-1', className)}>
      <div
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-primary transition-transform duration-500 ease-in-out',
          !isLight && 'translate-x-[calc(100%+0.25rem)]',
        )}
      />
      <button
        type="button"
        className={cn(
          'relative z-10 flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-500',
          isLight ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={(e) => handleClick(e, 'light')}
      >
        <Sun className="size-3.5" />
        Light
      </button>
      <button
        type="button"
        className={cn(
          'relative z-10 flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-500',
          !isLight ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={(e) => handleClick(e, 'dark')}
      >
        <Moon className="size-3.5" />
        Dark
      </button>
    </div>
  )
}
