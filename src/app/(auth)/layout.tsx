import type { WithChildren } from '@/types/common'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function AuthLayout({ children }: WithChildren) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <Link 
        href="/"
        className="absolute left-4 top-4 flex items-center justify-center size-10 rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors md:hidden"
        aria-label="Back to home"
      >
        <ArrowLeft className="size-5" />
      </Link>
      {children}
    </div>
  )
}
