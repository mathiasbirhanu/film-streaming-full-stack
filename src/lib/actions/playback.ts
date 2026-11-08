'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { membershipIsActive, resolveEntitlement } from '@/lib/services/entitlement'
import { toCatalogItem } from '@/lib/services/pricing'
import type { PlaybackPayload } from '@/lib/types'

function buildEmbedUrl(sourceRef: string, startAt: number): string {
  // youtube-nocookie + chrome minimised: no related videos, no annotations.
  // Custom player controls (controls=0) keep the UI ours — brand overlays
  // and the user watermark render on top of the stage.
  const params = new URLSearchParams({
    controls: '0',
    rel: '0',
    iv_load_policy: '3',
    modestbranding: '1',
    playsinline: '1',
    autoplay: '1',
    color: 'white',
  })
  if (startAt > 0) params.set('start', String(Math.floor(startAt)))
  return `https://www.youtube-nocookie.com/embed/${sourceRef}?${params.toString()}`
}

// Authenticated playback endpoint. The embed URL is only constructed and
// returned AFTER the entitlement check passes — public catalog payloads
// never contain the video id.
export async function getPlayback(resourceId: string): Promise<PlaybackPayload> {
  const user = await getSessionUser()
  const resource = await db.resource.findUnique({
    where: { id: resourceId },
    include: { producer: { select: { name: true } } },
  })
  if (!resource) return { ok: false, reason: 'UNAVAILABLE' }
  const item = toCatalogItem(resource)

  const [membership, purchase, progress] = await Promise.all([
    db.membership.findFirst({ where: { userId: user?.id ?? 'none' }, orderBy: { startedAt: 'desc' } }),
    user
      ? db.purchase.findUnique({
          where: {
            userId_resourceId_kind: {
              userId: user.id,
              resourceId,
              kind: 'PPV_LIFETIME',
            },
          },
        })
      : Promise.resolve(null),
    user
      ? db.viewingProgress.findUnique({
          where: { userId_resourceId: { userId: user.id, resourceId } },
        })
      : Promise.resolve(null),
  ])

  const check = resolveEntitlement({
    user,
    resource,
    membership,
    purchase,
  })
  if (!check.canWatch) {
    return { ok: false, reason: check.reason, title: resource.title, item }
  }

  await db.resource.update({
    where: { id: resourceId },
    data: { viewCount: { increment: 1 } },
  })

  const licenseRef =
    resource.pricingType === 'FREE'
      ? `FREE-${user!.id.slice(-8).toUpperCase()}`
      : resource.pricingType === 'MEMBERSHIP' && membershipIsActive(membership)
        ? `MEM-${membership!.id.slice(-8).toUpperCase()}`
        : `PPV-${purchase!.id.slice(-8).toUpperCase()}`

  return {
    ok: true,
    title: resource.title,
    description: resource.description,
    genre: resource.genre,
    producerName: resource.producer?.name ?? null,
    embedUrl: buildEmbedUrl(resource.sourceRef, progress?.positionSeconds ?? 0),
    resumeAt: progress?.positionSeconds ?? 0,
    watermark: {
      name: user!.name,
      shortId: user!.id.slice(-8).toUpperCase(),
      email: user!.email,
      licenseRef,
    },
    item,
  }
}

// Playback beacon from the custom player controls (15s cadence while playing).
export async function saveProgress(
  resourceId: string,
  positionSeconds: number,
  durationSeconds: number
): Promise<{ ok: boolean }> {
  const user = await getSessionUser()
  if (!user) return { ok: false }
  const resource = await db.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, status: true, pricingType: true, priceCents: true, discountPercent: true, discountEndsAt: true },
  })
  if (!resource || resource.status !== 'PUBLISHED') return { ok: false }

  const [membership, purchase] = await Promise.all([
    db.membership.findFirst({ where: { userId: user.id }, orderBy: { startedAt: 'desc' } }),
    db.purchase.findUnique({
      where: { userId_resourceId_kind: { userId: user.id, resourceId, kind: 'PPV_LIFETIME' } },
    }),
  ])
  const check = resolveEntitlement({ user, resource, membership, purchase })
  if (!check.canWatch) return { ok: false }

  const pos = Math.max(0, Math.floor(positionSeconds))
  const dur = Math.max(0, Math.floor(durationSeconds))
  await db.viewingProgress.upsert({
    where: { userId_resourceId: { userId: user.id, resourceId } },
    create: { userId: user.id, resourceId, positionSeconds: pos, durationSeconds: dur },
    update: { positionSeconds: pos, durationSeconds: dur },
  })
  return { ok: true }
}
