'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { post } from '@/lib/api/api-fetch'

interface ResendVerificationButtonProps {
  email: string
}

export function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  async function handleResend() {
    setIsPending(true)
    const result = await post('/api/auth/resend-verification', { email })
    setIsPending(false)
    if (result.status === 'ok') {
      router.push('/sign-in?resent=1')
    } else {
      toast.error(result.message ?? 'Failed to send verification email. Please try again later.')
    }
  }

  return (
    <button
      type="button"
      onClick={handleResend}
      disabled={isPending}
      className="text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
    >
      Resend verification email
    </button>
  )
}
