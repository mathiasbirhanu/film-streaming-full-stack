'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { effectivePriceCents } from '@/lib/services/pricing'
import { canTransition } from '@/lib/services/moderation'
import { getProducerShareBps } from '@/lib/services/platform-settings'
import type { ActionResult, PricingType, ResourceStatus } from '@/lib/types'

// Accepts full YouTube URLs (watch / youtu.be / embed / shorts) or a bare id.
function parseYouTubeId(raw: string): string | null {
  const s = raw.trim()
  const urlMatch = s.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  if (urlMatch) return urlMatch[1]
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  return null
}

export interface ProducerResourceRow {
  id: string
  title: string
  genre: string
  year: number | null
  status: ResourceStatus
  pricingType: PricingType
  priceCents: number
  discountPercent: number
  effectivePriceCents: number
  poster: string
  description: string
  viewCount: number
  purchases: number
  earnedCents: number
  rejectionReason: string | null
  updatedAt: string
}

export interface ProducerStats {
  totalViews: number
  totalPurchases: number
  earnedCents: number
  publishedCount: number
  pendingCount: number
}

async function requireProducer() {
  const user = await getSessionUser()
  if (!user) return { error: 'Please sign in first.' as const }
  if (user.role !== 'PRODUCER' && user.role !== 'ADMIN')
    return { error: 'Producer access required.' as const }
  return { user }
}

export async function myResources(): Promise<
  ActionResult<{ rows: ProducerResourceRow[]; stats: ProducerStats }>
> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }

  const resources = await db.resource.findMany({
    where: { producerId: auth.user.id },
    include: {
      _count: { select: { purchases: true } },
      ledgerEntries: { where: { type: 'EARNED' }, select: { amountCents: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const rows: ProducerResourceRow[] = resources.map((r) => ({
    id: r.id,
    title: r.title,
    genre: r.genre,
    year: r.year,
    status: r.status as ResourceStatus,
    pricingType: r.pricingType as PricingType,
    priceCents: r.priceCents,
    discountPercent: r.discountPercent,
    effectivePriceCents: effectivePriceCents(r),
    poster: `/api/thumb/${r.id}`,
    description: r.description,
    viewCount: r.viewCount,
    purchases: r._count.purchases,
    earnedCents: r.ledgerEntries.reduce((s, e) => s + e.amountCents, 0),
    rejectionReason: r.rejectionReason,
    updatedAt: r.updatedAt.toISOString(),
  }))

  const stats: ProducerStats = {
    totalViews: rows.reduce((s, r) => s + r.viewCount, 0),
    totalPurchases: rows.reduce((s, r) => s + r.purchases, 0),
    earnedCents: rows.reduce((s, r) => s + r.earnedCents, 0),
    publishedCount: rows.filter((r) => r.status === 'PUBLISHED').length,
    pendingCount: rows.filter((r) => r.status === 'PENDING_REVIEW').length,
  }
  return { ok: true, data: { rows, stats } }
}

export interface ResourceInput {
  id?: string
  title: string
  description: string
  genre: string
  year?: number | null
  youtube: string
  posterUrl?: string
  pricingType: PricingType
  priceCents: number
  discountPercent: number
  submit: boolean
}

function validateInput(input: ResourceInput, keepSource: boolean): { error: string } | { ok: true } {
  if (input.title.trim().length < 2) return { error: 'Title is required.' }
  if (!keepSource && !parseYouTubeId(input.youtube))
    return { error: 'Enter a valid YouTube link or 11-character video id.' }
  if (input.pricingType === 'PPV' && input.priceCents < 99)
    return { error: 'Pay-per-view price must be at least $0.99.' }
  if (input.discountPercent < 0 || input.discountPercent > 90)
    return { error: 'Discount must be between 0 and 90%.' }
  if (input.posterUrl && !/^https?:\/\/.+/.test(input.posterUrl.trim()))
    return { error: 'Poster URL must start with http(s)://.' }
  return { ok: true }
}

export async function saveResource(input: ResourceInput): Promise<ActionResult<{ id: string }>> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const keepSource = !!input.id && !input.youtube.trim()
  const v = validateInput(input, keepSource)
  if ('error' in v) return { ok: false, error: v.error }

  const base = {
    title: input.title.trim(),
    description: input.description.trim().slice(0, 2000),
    genre: input.genre,
    year: input.year && input.year > 1900 && input.year < 2100 ? input.year : null,
    videoSourceType: 'YOUTUBE',
    sourceRef: keepSource ? '' : parseYouTubeId(input.youtube)!,
    posterUrl: input.posterUrl?.trim() || null,
    pricingType: input.pricingType,
    priceCents: Math.max(0, Math.round(input.priceCents)),
    discountPercent: Math.round(input.discountPercent),
  }

  if (input.id) {
    const existing = await db.resource.findUnique({ where: { id: input.id } })
    if (!existing) return { ok: false, error: 'Title not found.' }
    if (existing.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
      return { ok: false, error: 'You can only edit your own titles.' }

    // Edit semantics: blank youtube / posterUrl keeps the stored values
    // (the server never re-exposes sourceRef for the client to re-send).
    const keepSource = !input.youtube.trim()
    if (keepSource && !parseYouTubeId(existing.sourceRef)) {
      return { ok: false, error: 'Existing video reference is invalid — please provide a link.' }
    }

    // Re-approval rule: an edit to a PUBLISHED title goes back to review.
    const nextStatus: ResourceStatus =
      input.submit || existing.status === 'PUBLISHED'
        ? 'PENDING_REVIEW'
        : existing.status === 'SUSPENDED'
          ? 'SUSPENDED'
          : 'DRAFT'

    const updated = await db.resource.update({
      where: { id: input.id },
      data: {
        ...base,
        sourceRef: keepSource ? existing.sourceRef : base.sourceRef,
        posterUrl: input.posterUrl?.trim() ? base.posterUrl : existing.posterUrl,
        status: nextStatus,
        rejectionReason: null,
      },
    })
    return { ok: true, data: { id: updated.id } }
  }

  const created = await db.resource.create({
    data: {
      ...base,
      producerId: auth.user.id,
      status: input.submit ? 'PENDING_REVIEW' : 'DRAFT',
    },
  })
  return { ok: true, data: { id: created.id } }
}

export async function submitResource(resourceId: string): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const r = await db.resource.findUnique({ where: { id: resourceId } })
  if (!r) return { ok: false, error: 'Title not found.' }
  if (r.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your title.' }
  const from = r.status as ResourceStatus
  if (!canTransition(from, 'PENDING_REVIEW'))
    return { ok: false, error: `Cannot submit a title that is ${from}.` }
  await db.resource.update({
    where: { id: resourceId },
    data: { status: 'PENDING_REVIEW', rejectionReason: null },
  })
  return { ok: true }
}

export async function deleteResourceDraft(resourceId: string): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const r = await db.resource.findUnique({ where: { id: resourceId } })
  if (!r) return { ok: false, error: 'Title not found.' }
  if (r.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your title.' }
  if (r.status !== 'DRAFT' && r.status !== 'REJECTED')
    return { ok: false, error: 'Only drafts or rejected titles can be deleted.' }
  await db.resource.delete({ where: { id: resourceId } })
  return { ok: true }
}

export interface LedgerRow {
  id: string
  title: string
  amountCents: number
  status: string
  createdAt: string
}

export async function myLedger(): Promise<ActionResult<LedgerRow[]>> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const rows = await db.payoutEntry.findMany({
    where: { producerId: auth.user.id, type: 'EARNED' },
    include: { resource: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return {
    ok: true,
    data: rows.map((e) => ({
      id: e.id,
      title: e.resource.title,
      amountCents: e.amountCents,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

// ── Per-movie income summary (producer view) ─────────────────────────
// Identity-scoped at the query level, not the UI: purchases are joined
// through resource.producerId and ledger entries through producerId, so
// a producer can only ever aggregate their own titles. Each sale keeps
// the split it was sold under (snapshot at charge time) — the summary
// therefore stays correct even when the admin retunes the percentage.
export interface ProducerIncomeRow {
  resourceId: string
  title: string
  sales: number
  grossCents: number
  earnedCents: number
  platformCents: number
}

export interface ProducerIncomeReport {
  rows: ProducerIncomeRow[]
  totals: {
    sales: number
    grossCents: number
    earnedCents: number
    platformCents: number
  }
  producerShareBps: number
}

export async function producerIncome(): Promise<ActionResult<ProducerIncomeReport>> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }

  const [sales, earned, titles, producerShareBps] = await Promise.all([
    db.purchase.groupBy({
      by: ['resourceId'],
      where: { status: 'COMPLETED', resource: { producerId: auth.user.id } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    db.payoutEntry.groupBy({
      by: ['resourceId'],
      where: { producerId: auth.user.id, type: 'EARNED' },
      _sum: { amountCents: true },
    }),
    db.resource.findMany({
      where: { producerId: auth.user.id },
      select: { id: true, title: true },
    }),
    getProducerShareBps(),
  ])

  const salesByResource = new Map<string, { count: number; gross: number }>(
    sales.map(
      (s): [string, { count: number; gross: number }] => [
        s.resourceId,
        { count: s._count._all, gross: s._sum.amountCents ?? 0 },
      ],
    ),
  )
  const earnedByResource = new Map<string, number>(
    earned.map((e): [string, number] => [e.resourceId, e._sum.amountCents ?? 0]),
  )
  const titleById = new Map(titles.map((t) => [t.id, t]))

  const ids = new Set<string>([...salesByResource.keys(), ...earnedByResource.keys()])
  const rows: ProducerIncomeRow[] = [...ids]
    .map((resourceId) => {
      const s = salesByResource.get(resourceId) ?? { count: 0, gross: 0 }
      const mine = earnedByResource.get(resourceId) ?? 0
      return {
        resourceId,
        title: titleById.get(resourceId)?.title ?? 'Removed title',
        sales: s.count,
        grossCents: s.gross,
        earnedCents: mine,
        platformCents: Math.max(0, s.gross - mine), // what the platform kept on this title
      }
    })
    .filter((r) => r.sales > 0 || r.earnedCents > 0)
    .sort((a, b) => b.grossCents - a.grossCents || b.sales - a.sales)

  const totals = rows.reduce(
    (t, r) => ({
      sales: t.sales + r.sales,
      grossCents: t.grossCents + r.grossCents,
      earnedCents: t.earnedCents + r.earnedCents,
      platformCents: t.platformCents + r.platformCents,
    }),
    { sales: 0, grossCents: 0, earnedCents: 0, platformCents: 0 },
  )

  return { ok: true, data: { rows, totals, producerShareBps } }
}
