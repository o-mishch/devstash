'use client'

import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'

interface ResendVerificationButtonProps {
  email: string
}

const RESEND_ERROR = 'Failed to send verification email. Please try again later.'

export function ResendVerificationButton({ email }: ResendVerificationButtonProps) {
  const router = useRouter()
  const resendMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/auth/resend-verification', { body: { email } })
      if (error) throw new Error(error.message || RESEND_ERROR)
    },
    onSuccess: () => router.push('/sign-in?resent=1'),
    onError: (error: Error) => toast.error(error.message || RESEND_ERROR),
  })
  const { mutate } = resendMutation
  const handleClick = useCallback(() => mutate(), [mutate])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={resendMutation.isPending}
      className="text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
    >
      Resend verification email
    </button>
  )
}
