'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import type { ActionResult } from '@/lib/types'

// ── Notifications (campaigns land here; the nav bell reads them) ────

export interface NotificationItem {
  id: string
  kind: string
  title: string
  body: string
  resourceId: string | null
  readAt: string | null
  createdAt: string
}

export async function myNotifications(): Promise<{ items: NotificationItem[]; unread: number }> {
  const user = await getSessionUser()
  if (!user) return { items: [], unread: 0 }
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ])
  return {
    items: items.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      resourceId: n.resourceId,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unread,
  }
}

export async function markAllRead(): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Please sign in first.' }
  await db.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  })
  return { ok: true }
}
