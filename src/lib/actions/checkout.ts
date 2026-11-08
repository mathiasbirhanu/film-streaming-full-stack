'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { membershipIsActive } from '@/lib/services/entitlement'
import { effectivePriceCents } from '@/lib/services/pricing'
import { authorizeCharge, type PaymentMethod } from '@/lib/payments-gateway'
import { MEMBERSHIP_PRICE_CENTS } from '@/lib/types'
import { getProducerShareBps } from '@/lib/services/platform-settings'
import type { ActionResult } from '@/lib/types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export async function buyMembership(
  method: PaymentMethod = 'TELEBIRR',
): Promise<ActionResult<{ expiresAt: string }>> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Please sign in first.' }

  const current = await db.membership.findFirst({
    where: { userId: user.id },
    orderBy: { startedAt: 'desc' },
  })
  if (membershipIsActive(current)) {
    return { ok: false, error: 'Your membership is already active.' }
  }

  const c = await authorizeCharge(MEMBERSHIP_PRICE_CENTS, method, 'StreamRoots membership')

  const base =
    current && current.expiresAt.getTime() > Date.now()
      ? current.expiresAt.getTime()
      : Date.now()
  const expiresAt = new Date(base + THIRTY_DAYS_MS)
  const m = await db.membership.create({
    data: {
      userId: user.id,
      status: 'ACTIVE',
      plan: 'MONTHLY',
      priceCents: MEMBERSHIP_PRICE_CENTS,
      expiresAt,
      provider: c.provider,
      providerRef: c.providerRef,
    },
  })
  return { ok: true, data: { expiresAt: m.expiresAt.toISOString() } }
}

export async function cancelMembership(): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Please sign in first.' }
  const current = await db.membership.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  })
  if (!current) return { ok: false, error: 'No active membership to cancel.' }
  await db.membership.update({ where: { id: current.id }, data: { status: 'CANCELED' } })
  return { ok: true }
}

export interface PurchaseSummary {
  amountCents: number
  title: string
}

export async function purchaseResource(
  resourceId: string,
  method: PaymentMethod = 'TELEBIRR',
): Promise<ActionResult<PurchaseSummary>> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Please sign in first.' }

  const resource = await db.resource.findUnique({ where: { id: resourceId } })
  if (!resource || resource.status !== 'PUBLISHED')
    return { ok: false, error: 'This title is not available for purchase.' }
  if (resource.pricingType !== 'PPV')
    return { ok: false, error: 'This title is not a pay-per-view item.' }

  const existing = await db.purchase.findUnique({
    where: { userId_resourceId_kind: { userId: user.id, resourceId, kind: 'PPV_LIFETIME' } },
  })
  if (existing && existing.status === 'COMPLETED')
    return { ok: false, error: 'You already own this title.' }

  const amount = effectivePriceCents(resource)
  const c = await authorizeCharge(amount, method, `StreamRoots: ${resource.title}`)

  // Snapshot the admin-configured share at charge time — the ledger rows
  // below freeze this split forever, so later retunes never re-history.
  const shareBps = await getProducerShareBps()
  const producerCents = Math.round((amount * shareBps) / 10000)

  const purchase = await db.purchase.create({
    data: {
      userId: user.id,
      resourceId,
      kind: 'PPV_LIFETIME',
      amountCents: amount,
      status: 'COMPLETED',
      provider: c.provider,
      providerRef: c.providerRef,
    },
  })

  // Day-one ledger: producer share + platform fee recorded at charge time.
  if (resource.producerId) {
    await db.payoutEntry.create({
      data: {
        producerId: resource.producerId,
        resourceId,
        purchaseId: purchase.id,
        type: 'EARNED',
        amountCents: producerCents,
        status: 'PAYABLE',
      },
    })
  }
  await db.payoutEntry.create({
    data: {
      resourceId,
      purchaseId: purchase.id,
      type: 'PLATFORM_FEE',
      amountCents: amount - producerCents, // producer + platform always == charge
      status: 'PAYABLE',
    },
  })

  return {
    ok: true,
    data: { amountCents: amount, title: resource.title },
  }
}
