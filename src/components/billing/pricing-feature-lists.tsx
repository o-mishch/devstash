import { Check, X } from 'lucide-react'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'

export interface PricingFeature {
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
  included: boolean
  text: string
}

function FeatureRow({ included, text }: FeatureRowProps) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {included
        ? <Check className="size-4 shrink-0 text-emerald-400" />
        : <X className="size-4 shrink-0 text-muted-foreground/50" />
      }
      <span className={included ? 'text-foreground' : 'text-foreground/50'}>{text}</span>
    </li>
  )
}

interface PricingFeatureListProps {
  features: readonly PricingFeature[]
}

function PricingFeatureList({ features }: PricingFeatureListProps) {
  return (
    <ul className="mb-8 flex flex-col gap-3">
      {features.map((feature) => (
        <FeatureRow key={feature.text} included={feature.included} text={feature.text} />
      ))}
    </ul>
  )
}

export function FreePricingFeatures() {
  return <PricingFeatureList features={FREE_PRICING_FEATURES} />
}

export function ProPricingFeatures() {
  return <PricingFeatureList features={PRO_PRICING_FEATURES} />
}
