'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'

interface ResendVerificationButtonProps {
  email: string
}

export function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleResend() {
    startTransition(async () => {
      const { error } = await api.POST('/auth/resend-verification', { body: { email } })
      if (!error) {
        router.push('/sign-in?resent=1')
      } else {
        toast.error(error.message || 'Failed to send verification email. Please try again later.')
      }
    })
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
