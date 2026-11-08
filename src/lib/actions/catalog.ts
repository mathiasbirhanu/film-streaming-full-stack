'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { membershipIsActive } from '@/lib/services/entitlement'
import { toCatalogItem } from '@/lib/services/pricing'
import type { CatalogItem } from '@/lib/types'

// Public catalog — sourceRef (video id) is never included in this payload.
export async function getCatalog(): Promise<CatalogItem[]> {
  const rows = await db.resource.findMany({
    where: { status: 'PUBLISHED' },
    include: { producer: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((r) => toCatalogItem(r))
}

// Up Next — same genre first, then the newest published titles.
export async function getUpNext(excludeId: string): Promise<CatalogItem[]> {
  const [current, rows] = await Promise.all([
    db.resource.findUnique({ where: { id: excludeId }, select: { genre: true } }),
    db.resource.findMany({
      where: { status: 'PUBLISHED', id: { not: excludeId } },
      include: { producer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
  ])
  const genre = current?.genre
  const items = rows.map((r) => toCatalogItem(r))
  const sameGenre = genre ? items.filter((i) => i.genre === genre) : []
  const others = genre ? items.filter((i) => i.genre !== genre) : items
  return [...sameGenre, ...others].slice(0, 8)
}

export interface ContinueItem {
  resourceId: string
  title: string
  poster: string
  percent: number
  positionSeconds: number
  genre: string
  pricingType: string
}

export async function getContinueWatching(): Promise<ContinueItem[]> {
  const user = await getSessionUser()
  if (!user) return []
  const rows = await db.viewingProgress.findMany({
    where: { userId: user.id, resource: { status: 'PUBLISHED' } },
    include: { resource: true },
    orderBy: { updatedAt: 'desc' },
    take: 12,
  })
  return rows
    .filter((r) => r.durationSeconds > 0)
    .map((r) => ({
      resourceId: r.resourceId,
      title: r.resource.title,
      poster: `/api/thumb/${r.resourceId}`,
      percent: Math.min(100, Math.round((r.positionSeconds / r.durationSeconds) * 100)),
      positionSeconds: r.positionSeconds,
      genre: r.resource.genre,
      pricingType: r.resource.pricingType,
    }))
}

export interface LibraryItem extends CatalogItem {
  purchasedAt: string
  amountCents: number
}

export async function getLibrary(): Promise<{
  purchases: LibraryItem[]
  membershipActive: boolean
}> {
  const user = await getSessionUser()
  if (!user) return { purchases: [], membershipActive: false }
  const rows = await db.purchase.findMany({
    where: { userId: user.id, status: 'COMPLETED' },
    include: { resource: { include: { producer: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  const membership = await db.membership.findFirst({
    where: { userId: user.id },
    orderBy: { startedAt: 'desc' },
  })
  return {
    purchases: rows.map((p) => ({
      ...toCatalogItem(p.resource),
      purchasedAt: p.createdAt.toISOString(),
      amountCents: p.amountCents,
    })),
    membershipActive: membershipIsActive(membership),
  }
}
