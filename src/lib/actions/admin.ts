'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { canTransition } from '@/lib/services/moderation'
import { effectivePriceCents, isDiscountActive } from '@/lib/services/pricing'
import { membershipIsActive } from '@/lib/services/entitlement'
import {
  bpsToPercent,
  getProducerShareBps,
  setProducerShareBps,
} from '@/lib/services/platform-settings'
import { formatPrice } from '@/lib/types'
import type { ActionResult, ResourceStatus } from '@/lib/types'

async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) return { error: 'Please sign in first.' as const }
  if (user.role !== 'ADMIN') return { error: 'Admin access required.' as const }
  return { user }
}

export type ModerationAction = 'approve' | 'reject' | 'suspend' | 'republish'

const TARGET: Record<ModerationAction, ResourceStatus> = {
  approve: 'PUBLISHED',
  reject: 'REJECTED',
  suspend: 'SUSPENDED',
  republish: 'PUBLISHED',
}

export async function moderate(
  resourceId: string,
  action: ModerationAction,
  reason?: string
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const r = await db.resource.findUnique({ where: { id: resourceId } })
  if (!r) return { ok: false, error: 'Title not found.' }
  if (action === 'reject' && (!reason || reason.trim().length < 4))
    return { ok: false, error: 'A rejection reason is required.' }

  const to = TARGET[action]
  if (!canTransition(r.status as ResourceStatus, to))
    return { ok: false, error: `Cannot move ${r.status} → ${to}.` }

  await db.resource.update({
    where: { id: resourceId },
    data: {
      status: to,
      rejectionReason: action === 'reject' ? reason!.trim() : null,
    },
  })
  await db.auditLog.create({
    data: {
      actorId: auth.user.id,
      resourceId,
      action: `MODERATE_${to}`,
      detail: reason?.trim() ?? null,
    },
  })
  return { ok: true }
}

export interface AdminResourceRow {
  id: string
  title: string
  genre: string
  status: ResourceStatus
  pricingType: string
  priceCents: number
  effectivePriceCents: number
  discountPercent: number
  discountEndsAt: string | null
  poster: string
  producerName: string | null
  viewCount: number
  purchases: number
  updatedAt: string
}

export async function adminResources(): Promise<ActionResult<AdminResourceRow[]>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const rows = await db.resource.findMany({
    include: { producer: { select: { name: true } }, _count: { select: { purchases: true } } },
    orderBy: { updatedAt: 'desc' },
  })
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      genre: r.genre,
      status: r.status as ResourceStatus,
      pricingType: r.pricingType,
      priceCents: r.priceCents,
      effectivePriceCents: effectivePriceCents(r),
      discountPercent: isDiscountActive(r) ? r.discountPercent : 0,
      discountEndsAt: r.discountEndsAt?.toISOString() ?? null,
      poster: `/api/thumb/${r.id}`,
      producerName: r.producer?.name ?? null,
      viewCount: r.viewCount,
      purchases: r._count.purchases,
      updatedAt: r.updatedAt.toISOString(),
    })),
  }
}

export interface AdminUserRow {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
  membershipActive: boolean
  purchases: number
}

export async function adminUsers(): Promise<ActionResult<AdminUserRow[]>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  const rows = await db.user.findMany({
    include: { memberships: true, _count: { select: { purchases: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return {
    ok: true,
    data: rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      membershipActive: u.memberships.some((m) => membershipIsActive(m)),
      purchases: u._count.purchases,
    })),
  }
}

export interface AdminOverview {
  users: number
  producers: number
  activeMemberships: number
  published: number
  pending: number
  purchaseRevenueCents: number
  membershipRevenueCents: number
  producerPayableCents: number
  producerEarnedCents: number
  platformFeesCents: number
  topTitles: { id: string; title: string; revenueCents: number }[]
}

export async function adminOverview(): Promise<ActionResult<AdminOverview>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const [users, memberships, published, pending, purchases, ledger, top] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: 'PRODUCER' } }),
    db.resource.count({ where: { status: 'PUBLISHED' } }),
    db.resource.count({ where: { status: 'PENDING_REVIEW' } }),
    db.purchase.findMany({ where: { status: 'COMPLETED' }, select: { amountCents: true } }),
    db.payoutEntry.findMany({ select: { type: true, amountCents: true, status: true } }),
    db.purchase.groupBy({
      by: ['resourceId'],
      where: { status: 'COMPLETED' },
      _sum: { amountCents: true },
      orderBy: { _sum: { amountCents: 'desc' } },
      take: 5,
    }),
  ])

  const ms = await db.membership.findMany({
    where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: { priceCents: true },
  })

  const topIds = top.map((t) => t.resourceId)
  const topRows = topIds.length
    ? await db.resource.findMany({ where: { id: { in: topIds } }, select: { id: true, title: true } })
    : []
  const titleById = new Map(topRows.map((r) => [r.id, r.title]))
  const topTitles = top
    .map((t) => ({
      id: t.resourceId,
      title: titleById.get(t.resourceId) ?? 'Removed title',
      revenueCents: t._sum.amountCents ?? 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)

  const purchaseRevenueCents = purchases.reduce((s, p) => s + p.amountCents, 0)
  const membershipRevenueCents = ms.reduce((s, m) => s + m.priceCents, 0)
  return {
    ok: true,
    data: {
      users,
      producers: memberships,
      activeMemberships: ms.length,
      published,
      pending,
      purchaseRevenueCents,
      membershipRevenueCents,
      producerPayableCents: ledger
        .filter((e) => e.type === 'EARNED' && e.status !== 'PAID')
        .reduce((s, e) => s + e.amountCents, 0),
      producerEarnedCents: ledger
        .filter((e) => e.type === 'EARNED')
        .reduce((s, e) => s + e.amountCents, 0),
      platformFeesCents: ledger
        .filter((e) => e.type === 'PLATFORM_FEE')
        .reduce((s, e) => s + e.amountCents, 0),
      topTitles,
    },
  }
}

// ── Promotions: discounts + campaigns ────────────────────────────────

export async function setDiscount(
  resourceId: string,
  percent: number,
  days: number,
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const p = Math.round(percent)
  if (!Number.isFinite(p) || p < 0 || p > 90)
    return { ok: false, error: 'Discount must be between 0 and 90 percent.' }
  const d = Math.round(days)
  if (p > 0 && (d < 1 || d > 90))
    return { ok: false, error: 'Duration must be between 1 and 90 days.' }

  const r = await db.resource.findUnique({ where: { id: resourceId } })
  if (!r) return { ok: false, error: 'Title not found.' }
  if (r.status !== 'PUBLISHED')
    return { ok: false, error: 'Only published titles can carry a discount.' }

  const data =
    p === 0
      ? { discountPercent: 0, discountEndsAt: null }
      : { discountPercent: p, discountEndsAt: new Date(Date.now() + d * 24 * 60 * 60 * 1000) }
  await db.resource.update({ where: { id: resourceId }, data })
  await db.auditLog.create({
    data: {
      actorId: auth.user.id,
      resourceId,
      action: 'SET_DISCOUNT',
      detail: p === 0 ? 'cleared discount' : `${p}% for ${d} days`,
    },
  })
  return { ok: true }
}

// ── Revenue split (admin decides the producer/platform dividend) ─────

export async function setRevenueSplit(
  producerSharePercent: number,
): Promise<ActionResult<{ producerShareBps: number }>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const p = Number(producerSharePercent)
  if (!Number.isFinite(p) || p < 10 || p > 95)
    return { ok: false, error: 'Producer share must be between 10 and 95 percent.' }

  const bps = await setProducerShareBps(Math.round(p * 100))
  await db.auditLog.create({
    data: {
      actorId: auth.user.id,
      action: 'SET_REVENUE_SPLIT',
      detail: `${bpsToPercent(bps)}% producer / ${(100 - bpsToPercent(bps)).toFixed(2).replace(/\.?0+$/, '')}% platform — future sales only`,
    },
  })
  return { ok: true, data: { producerShareBps: bps } }
}

// ── Per-movie income report (admin view) ────────────────────────────
// Built from the ledger, not from prices: each sale's split was frozen
// at charge time, so the table stays correct even after the admin
// changes the percentage. Memberships are platform-only income and are
// reported separately — there is no producer share on a subscription.

export interface AdminIncomeRow {
  resourceId: string
  title: string
  producerName: string | null
  sales: number
  grossCents: number
  producerCents: number
  platformCents: number
}

export interface AdminIncomeReport {
  rows: AdminIncomeRow[]
  totals: {
    sales: number
    grossCents: number
    producerCents: number
    platformCents: number
  }
  membershipRevenueCents: number
  producerShareBps: number
}

export async function adminIncomeReport(): Promise<ActionResult<AdminIncomeReport>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const [sales, ledger, resources, membershipTotal, producerShareBps] = await Promise.all([
    db.purchase.groupBy({
      by: ['resourceId'],
      where: { status: 'COMPLETED' },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    db.payoutEntry.groupBy({
      by: ['resourceId', 'type'],
      _sum: { amountCents: true },
    }),
    db.resource.findMany({
      select: { id: true, title: true, producer: { select: { name: true } } },
    }),
    db.membership.aggregate({ _sum: { priceCents: true } }),
    getProducerShareBps(),
  ])

  const ledgerByResource = new Map<string, { producer: number; platform: number }>()
  for (const e of ledger) {
    const cur = ledgerByResource.get(e.resourceId) ?? { producer: 0, platform: 0 }
    if (e.type === 'EARNED') cur.producer += e._sum.amountCents ?? 0
    else if (e.type === 'PLATFORM_FEE') cur.platform += e._sum.amountCents ?? 0
    ledgerByResource.set(e.resourceId, cur)
  }

  const salesByResource = new Map(
    sales.map((s) => [s.resourceId, { count: s._count._all, gross: s._sum.amountCents ?? 0 }]),
  )
  const titleById = new Map(resources.map((r) => [r.id, r]))

  const ids = new Set<string>([...salesByResource.keys(), ...ledgerByResource.keys()])
  const rows: AdminIncomeRow[] = [...ids]
    .map((resourceId) => {
      const s = salesByResource.get(resourceId) ?? { count: 0, gross: 0 }
      const l = ledgerByResource.get(resourceId) ?? { producer: 0, platform: 0 }
      const r = titleById.get(resourceId)
      return {
        resourceId,
        title: r?.title ?? 'Removed title',
        producerName: r?.producer?.name ?? null,
        sales: s.count,
        grossCents: s.gross,
        producerCents: l.producer,
        platformCents: l.platform,
      }
    })
    .sort((a, b) => b.grossCents - a.grossCents || b.sales - a.sales)

  const totals = rows.reduce(
    (t, r) => ({
      sales: t.sales + r.sales,
      grossCents: t.grossCents + r.grossCents,
      producerCents: t.producerCents + r.producerCents,
      platformCents: t.platformCents + r.platformCents,
    }),
    { sales: 0, grossCents: 0, producerCents: 0, platformCents: 0 },
  )

  return {
    ok: true,
    data: {
      rows,
      totals,
      membershipRevenueCents: membershipTotal._sum.priceCents ?? 0,
      producerShareBps,
    },
  }
}

export async function sendDiscountCampaign(
  resourceId: string,
): Promise<ActionResult<{ recipients: number }>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const r = await db.resource.findUnique({ where: { id: resourceId } })
  if (!r || r.status !== 'PUBLISHED')
    return { ok: false, error: 'Only published titles can be promoted.' }
  if (!isDiscountActive(r))
    return { ok: false, error: 'Set an active discount first — there is nothing to announce.' }

  const users = await db.user.findMany({ where: { role: { not: 'ADMIN' } }, select: { id: true } })
  const ends = r.discountEndsAt
    ? new Date(r.discountEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const price = effectivePriceCents(r)
  const title = `${r.title} — ${r.discountPercent}% off`
  const body = `"${r.title}" is ${r.discountPercent}% off${ends ? ` through ${ends}` : ''} — now ${formatPrice(price)}. Grab it before the deal ends.`

  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, kind: 'CAMPAIGN', title, body, resourceId: r.id })),
  })
  await db.auditLog.create({
    data: {
      actorId: auth.user.id,
      resourceId,
      action: 'DISCOUNT_CAMPAIGN',
      detail: `${users.length} recipients • ${r.discountPercent}% off`,
    },
  })
  return { ok: true, data: { recipients: users.length } }
}
