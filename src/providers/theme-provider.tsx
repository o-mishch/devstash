'use client'

import { type ComponentProps } from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

// Using window check to ensure console monkeypatching only occurs on the client,
// where the next-themes script tag hydration warning and Monaco editor errors occur.
if (typeof window !== 'undefined') {
  const origError = console.error
  console.error = (...args) => {
    const isScriptError = typeof args[0] === 'string' && args[0].includes('Encountered a script tag')
    // Monaco emits "Canceled" errors as known noise (github.com/microsoft/monaco-editor/issues/4859).
    // Check all args because Turbopack may spread the error across multiple arguments.
    const isMonacoCanceledError = args.some((arg) => {
      if (!arg) return false
      if (typeof arg === 'string') return arg.includes('Canceled')
      if (arg instanceof Error) return arg.message.includes('Canceled')
      if (typeof arg === 'object') {
        const obj = arg as Record<string, unknown>
        return obj.name === 'Canceled' || (typeof obj.message === 'string' && obj.message.includes('Canceled'))
      }
      return false
    })

    if (isScriptError || isMonacoCanceledError) {
      return
    }
    origError.apply(console, args)
  }
}

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
