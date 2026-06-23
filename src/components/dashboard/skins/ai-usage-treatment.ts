import type { UiSkin } from '@/types/ui-skins'

export interface AiUsageSkinTreatment {
  card: string
  bar: string
}

export const AI_USAGE_DEFAULT_TREATMENT: AiUsageSkinTreatment = {
  card: 'border-border bg-foreground/[0.02]',
  bar: 'bg-primary',
}

// Per-skin meter-card treatment, shared by AiUsageWidget and its Suspense fallback so the loaded
// section and skeleton keep the same border/background treatment.
export const AI_USAGE_SKIN_TREATMENTS: Partial<Record<UiSkin, AiUsageSkinTreatment>> = {
  'mission-control': { card: 'border-primary/20 bg-primary/[0.04]', bar: 'bg-primary' },
  orbital: { card: 'border-primary/20 bg-foreground/[0.03]', bar: 'bg-primary' },
  'command-deck': { card: 'border-primary/25 bg-foreground/[0.03] font-mono', bar: 'bg-primary' },
  'neon-grid': {
    card: 'border-primary/30 bg-foreground/[0.03]',
    bar: 'bg-primary shadow-[0_0_10px_-2px_var(--primary)]',
  },
  holographic: { card: 'border-primary/20 bg-foreground/[0.03]', bar: 'bg-primary' },
  spatial: { card: 'border-border bg-foreground/[0.04]', bar: 'bg-primary' },
}

export function aiUsageSkinTreatment(skin: UiSkin): AiUsageSkinTreatment {
  return AI_USAGE_SKIN_TREATMENTS[skin] ?? AI_USAGE_DEFAULT_TREATMENT
}
