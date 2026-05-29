import type { WithChildren } from '@/types/common'

export default function AuthLayout({ children }: WithChildren) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {children}
    </div>
  )
}
