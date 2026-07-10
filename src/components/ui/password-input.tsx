'use client'

import { useState, useCallback, memo } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'>

export const PasswordInput = memo(function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  const toggleVisibility = useCallback(() => {
    setVisible((v) => !v)
  }, [])

  return (
    <div className="relative" suppressHydrationWarning>
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-9', className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={toggleVisibility}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
})
