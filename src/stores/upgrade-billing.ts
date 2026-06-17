import { create } from 'zustand'
import type { BillingPeriod } from '@/lib/billing/config/billing-pricing.client'

interface UpgradeBillingStore {
  billing: BillingPeriod
  priceIdMonthly: string | undefined
  priceIdYearly: string | undefined
  checkoutDisabled: boolean
  checkoutDisabledMessage: string | null | undefined
  init: (config: UpgradeBillingInit) => void
  setBilling: (billing: BillingPeriod) => void
}

interface UpgradeBillingInit {
  defaultBilling: BillingPeriod
  priceIdMonthly?: string
  priceIdYearly?: string
  checkoutDisabled: boolean
  checkoutDisabledMessage?: string | null
}

export const useUpgradeBillingStore = create<UpgradeBillingStore>((set) => ({
  billing: 'yearly',
  priceIdMonthly: undefined,
  priceIdYearly: undefined,
  checkoutDisabled: false,
  checkoutDisabledMessage: undefined,
  init: (config) => set({
    billing: config.defaultBilling,
    priceIdMonthly: config.priceIdMonthly,
    priceIdYearly: config.priceIdYearly,
    checkoutDisabled: config.checkoutDisabled,
    checkoutDisabledMessage: config.checkoutDisabledMessage,
  }),
  setBilling: (billing) => set({ billing }),
}))
