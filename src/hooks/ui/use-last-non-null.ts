'use client'

import { useState } from 'react'

/**
 * Keeps track of and returns the last non-null value.
 * Useful for preserving UI state during transition animations (e.g. closing a dialog/sheet).
 */
export function useLastNonNull<T>(value: T | null): T | null {
  const [prevValue, setPrevValue] = useState<T | null>(value)
  const [lastValue, setLastValue] = useState<T | null>(value)

  if (value !== prevValue) {
    setPrevValue(value)
    if (value !== null) {
      setLastValue(value)
    }
  }

  return value ?? lastValue
}
