import { describe, expect, it } from 'vitest'
import {
  buildCheckoutReturnRedirectPath,
  checkoutNotificationFromSearchParams,
} from './checkout-return-params'

describe('checkoutNotificationFromSearchParams', () => {
  it('maps checkout=canceled to canceled notification', () => {
    expect(checkoutNotificationFromSearchParams({ checkout: 'canceled' })).toEqual({ type: 'canceled' })
  })

  it('maps checkout=success to success notification', () => {
    expect(checkoutNotificationFromSearchParams({ checkout: 'success' })).toEqual({ type: 'success' })
  })

  it('maps checkout=syncing to syncing notification', () => {
    expect(checkoutNotificationFromSearchParams({ checkout: 'syncing' })).toEqual({ type: 'syncing' })
  })

  it('maps checkout=info with allowlisted reason to info notification', () => {
    expect(
      checkoutNotificationFromSearchParams({ checkout: 'info', reason: 'sync_pending' }),
    ).toEqual({ type: 'info', messageKey: 'sync_pending' })
  })

  it('returns null for checkout=info without reason', () => {
    expect(checkoutNotificationFromSearchParams({ checkout: 'info' })).toBeNull()
  })

  it('returns null for unknown checkout info reason', () => {
    expect(
      checkoutNotificationFromSearchParams({ checkout: 'info', reason: 'crafted message' }),
    ).toBeNull()
  })

  it('returns null for unknown checkout param', () => {
    expect(checkoutNotificationFromSearchParams({ checkout: 'unknown' })).toBeNull()
    expect(checkoutNotificationFromSearchParams({})).toBeNull()
  })
})

describe('buildCheckoutReturnRedirectPath', () => {
  it('builds path for non-info notifications', () => {
    expect(buildCheckoutReturnRedirectPath({ type: 'success' })).toBe('/settings?checkout=success')
    expect(buildCheckoutReturnRedirectPath({ type: 'syncing' })).toBe('/settings?checkout=syncing')
    expect(buildCheckoutReturnRedirectPath({ type: 'canceled' })).toBe('/settings?checkout=canceled')
  })

  it('uses allowlisted reason key in query param', () => {
    expect(
      buildCheckoutReturnRedirectPath({ type: 'info', messageKey: 'session_owner_mismatch' }),
    ).toBe('/settings?checkout=info&reason=session_owner_mismatch')
  })
})
