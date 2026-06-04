import type { ReactNode } from 'react'

interface WarningBannerProps {
  children: ReactNode
}

export function WarningBanner({ children }: WarningBannerProps) {
  return (
    <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-sm text-yellow-600 dark:text-yellow-400">
      {children}
    </div>
  )
}
