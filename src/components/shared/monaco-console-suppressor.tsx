'use client'

import { useEffect } from 'react'

export function MonacoConsoleSuppressor() {
  useEffect(() => {
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

    return () => {
      console.error = origError
    }
  }, [])

  return null
}
