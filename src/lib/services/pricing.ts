// ── Pricing service (pure functions) ─────────────────────────────────
import type { CatalogItem, PricingType } from '@/lib/types'

interface Priceable {
  priceCents: number
  discountPercent: number
  discountEndsAt?: Date | string | null
}

export function isDiscountActive(r: Priceable, now: number = Date.now()): boolean {
  if (r.discountPercent <= 0) return false
  if (!r.discountEndsAt) return true
  return new Date(r.discountEndsAt).getTime() > now
}

export function effectivePriceCents(r: Priceable, now: number = Date.now()): number {
  if (isDiscountActive(r, now)) {
    return Math.max(0, Math.round((r.priceCents * (100 - r.discountPercent)) / 100))
  }
  return r.priceCents
}

export interface PriceView {
  hasDiscount: boolean
  originalPriceCents: number
  effectivePriceCents: number
  discountPercent: number
}

export function priceView(r: Priceable, now: number = Date.now()): PriceView {
  const active = isDiscountActive(r, now)
  return {
    hasDiscount: active,
    originalPriceCents: r.priceCents,
    effectivePriceCents: effectivePriceCents(r, now),
    discountPercent: active ? r.discountPercent : 0,
  }
}

// Public catalog projection — never includes sourceRef (the video id).
export function toCatalogItem(
  r: {
    id: string
    title: string
    description: string
    genre: string
    year: number | null
    pricingType: string
    priceCents: number
    discountPercent: number
    discountEndsAt: Date | null
    viewCount: number
    producer?: { name: string } | null
  },
  now: number = Date.now()
): CatalogItem {
  const pv = priceView(r, now)
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    genre: r.genre,
    year: r.year,
    pricingType: r.pricingType as PricingType,
    priceCents: pv.originalPriceCents,
    discountPercent: pv.discountPercent,
    discountEndsAt: r.discountEndsAt ? r.discountEndsAt.toISOString() : null,
    effectivePriceCents: pv.effectivePriceCents,
    poster: `/api/thumb/${r.id}`,
    producerName: r.producer?.name ?? null,
    viewCount: r.viewCount,
  }
}
