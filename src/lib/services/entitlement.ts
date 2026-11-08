// ── Entitlement service — the CanView(userId, resourceId) core ────────
// One place decides who can watch what. Payments, the player and the
// paywall UI all defer to this resolution — exactly the seam a .NET
// AuthorizationPolicy would sit behind.
import type { Membership, Purchase } from '@prisma/client'
import type { AccessReason, SessionUser } from '@/lib/types'
import { priceView, type PriceView } from '@/lib/services/pricing'

interface ResourceCore {
  status: string
  pricingType: string
  priceCents: number
  discountPercent: number
  discountEndsAt: Date | null
}

export interface AccessCheck extends PriceView {
  canWatch: boolean
  reason: AccessReason
}

export function membershipIsActive(m: Membership | null | undefined): boolean {
  return !!m && m.status === 'ACTIVE' && m.expiresAt.getTime() > Date.now()
}

export function resolveEntitlement(args: {
  user: SessionUser | null
  resource: ResourceCore
  membership?: Membership | null
  purchase?: Purchase | null
}): AccessCheck {
  const { user, resource, membership, purchase } = args
  const price = priceView(resource)

  if (resource.status !== 'PUBLISHED') {
    return { canWatch: false, reason: 'UNAVAILABLE', ...price }
  }
  // Login is required for every playback so the per-user watermark is
  // always meaningful and watch analytics are attributable.
  if (!user) {
    return { canWatch: false, reason: 'LOGIN_REQUIRED', ...price }
  }
  if (resource.pricingType === 'FREE') {
    return { canWatch: true, reason: 'ENTITLED', ...price }
  }
  if (resource.pricingType === 'MEMBERSHIP') {
    if (membershipIsActive(membership)) {
      return { canWatch: true, reason: 'ENTITLED', ...price }
    }
    return { canWatch: false, reason: 'NEED_SUBSCRIPTION', ...price }
  }
  // PPV — a completed purchase grants access.
  if (purchase && purchase.status === 'COMPLETED') {
    return { canWatch: true, reason: 'ENTITLED', ...price }
  }
  return { canWatch: false, reason: 'NEED_PURCHASE', ...price }
}
