'use client'

import type { MouseEvent } from 'react'
import { useRef } from 'react'
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
  const containerRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: MouseEvent<HTMLButtonElement>, mode: 'light' | 'dark') => {
    startThemeTransition(e, () => {
      // Update the DOM synchronously so startViewTransition captures the new theme in its
      // "new" snapshot. ThemeInitializer's useEffect runs asynchronously after the React
      // render cycle, too late for the view-transition snapshot.
      const root = document.documentElement
      if (mode === 'dark') {
        root.classList.add('dark')
        root.classList.remove('light')
      } else {
        root.classList.add('light')
        root.classList.remove('dark')
      }
      // Also update the container attribute synchronously so the thumb CSS transition
      // reflects the new position in the view-transition "new" snapshot, before React
      // re-renders and applies the new className.
      containerRef.current?.setAttribute('data-mode', mode)
      onColorModeChange(mode)
    })
  }

  return (
    <div
      ref={containerRef}
      data-mode={colorMode}
      className={cn('relative inline-grid grid-cols-2 rounded-lg border border-border bg-card p-1', className)}
    >
      <div className="dark-light-switch-thumb absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-primary transition-transform duration-500 ease-in-out" />
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
