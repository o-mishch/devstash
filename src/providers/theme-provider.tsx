'use client'

import { type ComponentProps } from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

// Using window check to ensure console monkeypatching only occurs on the client,
// where the next-themes script tag hydration warning and Monaco editor errors occur.
if (typeof window !== 'undefined') {
  const origError = console.error
  console.error = (...args) => {
    const isScriptError = typeof args[0] === 'string' && args[0].includes('Encountered a script tag')
    const isMonacoCanceledError = (() => {
      if (!args[0]) return false
      if (typeof args[0] === 'string' && args[0].includes('Canceled')) return true
      if (args[0] instanceof Error && args[0].message.includes('Canceled')) return true
      if (typeof args[0] === 'object') {
        const obj = args[0] as Record<string, unknown>
        if (obj.name === 'Canceled' || (typeof obj.message === 'string' && obj.message.includes('Canceled'))) {
          return true
        }
      }
      return false
    })()

    if (isScriptError || isMonacoCanceledError) {
      return
    }
    origError.apply(console, args)
  }
}

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
