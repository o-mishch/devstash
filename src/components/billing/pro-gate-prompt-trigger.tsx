'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { PRO_GATE_COPY, isProGateFeature } from '@/lib/utils/pro-gate'

// Opens the shared "Pro Feature" dialog when a non-Pro user is redirected to /upgrade from a Pro-only
// page (?gate=<feature>), then strips the param so a refresh or back-nav doesn't re-open it. Mounted on
// the upgrade page; the dialog itself is rendered app-wide by UpgradePromptProvider.
export function ProGatePromptTrigger() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { openPrompt } = useUpgradePromptStore()

  const gate = searchParams.get('gate')
  const description = isProGateFeature(gate) ? PRO_GATE_COPY[gate] : undefined

  useEffect(() => {
    if (!description) return

    openPrompt({ title: 'Pro Feature', description })

    const params = new URLSearchParams(searchParams)
    params.delete('gate')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [description, openPrompt, pathname, router, searchParams])

  return null
}
