'use client'

import { memo, useCallback, type MouseEvent } from 'react'
import { Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { startThemeTransition } from '@/lib/dom/theme-transition'
import { SlideIndicator } from '@/components/shared/slide-indicator'

interface DarkLightSwitchProps {
  colorMode: 'light' | 'dark'
  onColorModeChange: (mode: 'light' | 'dark') => void
  className?: string
}

export const DarkLightSwitch = memo(function DarkLightSwitch({ colorMode, onColorModeChange, className }: DarkLightSwitchProps) {
  const isLight = colorMode === 'light'

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>, mode: 'light' | 'dark') => {
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
      onColorModeChange(mode)
    })
  }, [onColorModeChange])

  const handleLightClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    handleClick(e, 'light')
  }, [handleClick])

  const handleDarkClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    handleClick(e, 'dark')
  }, [handleClick])

  return (
    <div
      className={cn('relative inline-grid grid-cols-2 rounded-lg border border-border bg-card p-1', className)}
    >
      <button
        type="button"
        className={cn(
          'relative z-10 flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-500',
          isLight ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={handleLightClick}
      >
        {isLight && <SlideIndicator layoutId="colorModeIndicator" />}
        <span className="relative z-10 flex items-center gap-1.5">
          <Sun className="size-3.5" />
          Light
        </span>
      </button>
      <button
        type="button"
        className={cn(
          'relative z-10 flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-500',
          !isLight ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={handleDarkClick}
      >
        {!isLight && <SlideIndicator layoutId="colorModeIndicator" />}
        <span className="relative z-10 flex items-center gap-1.5">
          <Moon className="size-3.5" />
          Dark
        </span>
      </button>
    </div>
  )
})
