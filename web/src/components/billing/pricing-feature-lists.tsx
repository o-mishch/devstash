import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/limits'

interface PricingFeature {
  included: boolean
  text: string
}

export const FREE_PRICING_FEATURES: readonly PricingFeature[] = [
  { included: true, text: `${FREE_TIER_ITEM_LIMIT} items total` },
  { included: true, text: `${FREE_TIER_COLLECTION_LIMIT} collections` },
  { included: true, text: 'Snippets, Prompts, Commands, Notes, Links' },
  { included: true, text: 'Full-text search' },
  { included: false, text: 'File & Image uploads' },
  { included: false, text: 'AI features' },
  { included: false, text: 'Data export' },
]

export const PRO_PRICING_FEATURES: readonly PricingFeature[] = [
  { included: true, text: 'Unlimited items' },
  { included: true, text: 'Unlimited collections' },
  { included: true, text: 'All item types including Files & Images' },
  { included: true, text: 'Full-text search' },
  { included: true, text: 'File & Image uploads' },
  { included: true, text: 'AI auto-tagging & summaries' },
  { included: true, text: 'Data export (JSON/ZIP)' },
]

interface FeatureRowProps {
  feature: PricingFeature
}

function FeatureRow({ feature: { included, text } }: FeatureRowProps): ReactNode {
  return (
    <li className="flex items-center gap-2 text-sm">
      {included ? (
        <Check className="size-4 shrink-0 text-emerald-400" />
      ) : (
        <X className="size-4 shrink-0 text-muted-foreground/50" />
      )}
      <span className={included ? 'text-foreground' : 'text-foreground/50'}>{text}</span>
    </li>
  )
}

interface PricingFeatureListProps {
  features: readonly PricingFeature[]
}

export function PricingFeatureList({ features }: PricingFeatureListProps): ReactNode {
  return (
    <ul className="mb-8 flex flex-col gap-3">
      {features.map((feature) => (
        <FeatureRow key={feature.text} feature={feature} />
      ))}
    </ul>
  )
}
