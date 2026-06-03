'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export type ToastCode = 'linked' | 'already_linked' | 'taken' | 'expired' | 'mismatch'

const MESSAGES: Record<ToastCode, { fn: typeof toast.success; text: string }> = {
  linked:         { fn: toast.success, text: 'Account linked successfully.' },
  already_linked: { fn: toast.info,    text: 'That account is already linked to your profile.' },
  taken:          { fn: toast.error,   text: 'That account is already linked to a different DevStash profile.' },
  expired:        { fn: toast.error,   text: 'The linking session expired. Please try again.' },
  mismatch:       { fn: toast.error,   text: 'Account email mismatch. Please sign in and try again.' },
}

interface ProfileToastProps {
  code: ToastCode
}

export function ProfileToast({ code }: ProfileToastProps) {
  const router = useRouter()
  useEffect(() => {
    const msg = MESSAGES[code]
    if (!msg) return
    msg.fn(msg.text)
    router.replace('/profile')
  }, [])
  return null
}
