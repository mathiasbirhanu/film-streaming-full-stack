// ── Shared domain types & constants (mirrors the .NET domain layer 1:1) ──

export type Role = 'VIEWER' | 'PRODUCER' | 'ADMIN'

export type ResourceStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'SUSPENDED'

export type PricingType = 'FREE' | 'MEMBERSHIP' | 'PPV'

// Phase-1 ships YOUTUBE only; UPLOAD/EXTERNAL exist so delivery can be
// swapped without touching catalog, orders or entitlement logic.
export type VideoSourceType = 'YOUTUBE' | 'UPLOAD' | 'EXTERNAL'

export const GENRES = [
  'Animation',
  'Drama',
  'Comedy',
  'Documentary',
  'Action',
  'Family',
  'Music',
  'Sci-Fi',
  'General',
] as const

export const MEMBERSHIP_PRICE_CENTS = 799

export type AccessReason =
  | 'ENTITLED'
  | 'LOGIN_REQUIRED'
  | 'NEED_SUBSCRIPTION'
  | 'NEED_PURCHASE'
  | 'UNAVAILABLE'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}

export interface MembershipSummary {
  active: boolean
  status: string
  expiresAt: string | null
  provider: string | null
}

// ── DTOs across the client/server boundary (ISO strings, no Dates) ──
export interface CatalogItem {
  id: string
  title: string
  description: string
  genre: string
  year: number | null
  pricingType: PricingType
  priceCents: number
  discountPercent: number
  discountEndsAt: string | null
  effectivePriceCents: number
  poster: string
  producerName: string | null
  viewCount: number
}

export interface PlaybackPayload {
  ok: boolean
  reason?: AccessReason
  title?: string
  description?: string
  genre?: string
  producerName?: string | null
  embedUrl?: string
  resumeAt?: number
  watermark?: { name: string; shortId: string; email: string; licenseRef: string }
  item?: CatalogItem
}

export interface ActionResult<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function shortId(id: string): string {
  return id.slice(-8).toUpperCase()
}
