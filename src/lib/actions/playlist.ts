'use server'

import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { toCatalogItem } from '@/lib/services/pricing'
import type { ActionResult, CatalogItem } from '@/lib/types'

// ── Playlists — producer-curated, ordered collections ────────────────
// Curation, not content: only PUBLISHED titles can be attached, so a
// playlist never exposes anything the admin has not already approved.
// The public reads re-filter item status defensively — a title that
// goes back to review after being attached simply drops out of the
// playlist until it is re-approved.

const MAX_ITEMS_PER_PLAYLIST = 50

async function requireProducer() {
  const user = await getSessionUser()
  if (!user) return { error: 'Please sign in first.' as const }
  if (user.role !== 'PRODUCER' && user.role !== 'ADMIN')
    return { error: 'Producer access required.' as const }
  return { user }
}

// ── Public surface (viewer side) ─────────────────────────────────────

export interface PlaylistSummary {
  id: string
  title: string
  description: string
  producerName: string | null
  itemCount: number
  poster: string | null // first item's proxied thumb — null → placeholder
  posterId: string | null // that item's resource id (for Data Saver variant)
}

export interface PlaylistDetail extends PlaylistSummary {
  items: CatalogItem[]
}

// Home rail — published playlists with at least one visible title.
export async function getPlaylists(): Promise<PlaylistSummary[]> {
  const rows = await db.playlist.findMany({
    where: { status: 'PUBLISHED', items: { some: {} } },
    include: {
      producer: { select: { name: true } },
      _count: { select: { items: true } },
      items: {
        orderBy: { position: 'asc' },
        take: 1,
        select: { resourceId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    producerName: p.producer?.name ?? null,
    itemCount: p._count.items,
    poster: p.items[0] ? `/api/thumb/${p.items[0].resourceId}` : null,
    posterId: p.items[0]?.resourceId ?? null,
  }))
}

// Playlist detail page — ordered items as catalog projections.
export async function getPlaylistDetail(id: string): Promise<PlaylistDetail | null> {
  const p = await db.playlist.findUnique({
    where: { id },
    include: {
      producer: { select: { name: true } },
      items: {
        orderBy: { position: 'asc' },
        include: {
          resource: { include: { producer: { select: { name: true } } } },
        },
      },
    },
  })
  if (!p || p.status !== 'PUBLISHED') return null
  const items = p.items
    .filter((i) => i.resource.status === 'PUBLISHED')
    .map((i) => toCatalogItem(i.resource))
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    producerName: p.producer?.name ?? null,
    itemCount: items.length,
    poster: p.items[0] ? `/api/thumb/${p.items[0].resourceId}` : null,
    posterId: p.items[0]?.resourceId ?? null,
    items,
  }
}

// ── Producer surface (dashboard side) ────────────────────────────────

export interface ProducerPlaylistItem {
  itemId: string
  resourceId: string
  title: string
  poster: string
  status: string // current resource status — UI flags titles that left PUBLISHED
  position: number
}

export interface ProducerPlaylistRow {
  id: string
  title: string
  description: string
  status: 'DRAFT' | 'PUBLISHED'
  items: ProducerPlaylistItem[]
  updatedAt: string
}

export async function myPlaylists(): Promise<ActionResult<ProducerPlaylistRow[]>> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }

  const rows = await db.playlist.findMany({
    where: { producerId: auth.user.id },
    include: {
      items: {
        orderBy: { position: 'asc' },
        include: { resource: { select: { title: true, status: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return {
    ok: true,
    data: rows.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status as 'DRAFT' | 'PUBLISHED',
      items: p.items.map((i) => ({
        itemId: i.id,
        resourceId: i.resourceId,
        title: i.resource.title,
        poster: `/api/thumb/${i.resourceId}`,
        status: i.resource.status,
        position: i.position,
      })),
      updatedAt: p.updatedAt.toISOString(),
    })),
  }
}

export interface PlaylistInput {
  id?: string
  title: string
  description: string
}

export async function savePlaylist(input: PlaylistInput): Promise<ActionResult<{ id: string }>> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }

  const title = input.title.trim()
  if (title.length < 2 || title.length > 120)
    return { ok: false, error: 'Playlist title must be 2–120 characters.' }
  const description = input.description.trim().slice(0, 500)

  if (input.id) {
    const existing = await db.playlist.findUnique({ where: { id: input.id } })
    if (!existing) return { ok: false, error: 'Playlist not found.' }
    if (existing.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
      return { ok: false, error: 'You can only edit your own playlists.' }
    const updated = await db.playlist.update({
      where: { id: input.id },
      data: { title, description },
    })
    return { ok: true, data: { id: updated.id } }
  }

  const created = await db.playlist.create({
    data: { title, description, producerId: auth.user.id, status: 'DRAFT' },
  })
  return { ok: true, data: { id: created.id } }
}

// Publish requires at least one attached title — an empty playlist on
// the home rail would just be a dead card.
export async function setPlaylistPublished(
  playlistId: string,
  published: boolean,
): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const p = await db.playlist.findUnique({
    where: { id: playlistId },
    include: { _count: { select: { items: true } } },
  })
  if (!p) return { ok: false, error: 'Playlist not found.' }
  if (p.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your playlist.' }
  if (published && p._count.items === 0)
    return { ok: false, error: 'Add at least one title before publishing.' }
  await db.playlist.update({
    where: { id: playlistId },
    data: { status: published ? 'PUBLISHED' : 'DRAFT' },
  })
  return { ok: true }
}

export async function deletePlaylist(playlistId: string): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const p = await db.playlist.findUnique({ where: { id: playlistId } })
  if (!p) return { ok: false, error: 'Playlist not found.' }
  if (p.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your playlist.' }
  await db.playlist.delete({ where: { id: playlistId } }) // items cascade
  return { ok: true }
}

export async function addPlaylistItem(
  playlistId: string,
  resourceId: string,
): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }

  const p = await db.playlist.findUnique({ where: { id: playlistId } })
  if (!p) return { ok: false, error: 'Playlist not found.' }
  if (p.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your playlist.' }

  const r = await db.resource.findUnique({ where: { id: resourceId } })
  if (!r) return { ok: false, error: 'Title not found.' }
  if (r.status !== 'PUBLISHED')
    return { ok: false, error: 'Only published titles can be added to a playlist.' }
  if (r.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'You can only add your own titles.' }

  const count = await db.playlistItem.count({ where: { playlistId } })
  if (count >= MAX_ITEMS_PER_PLAYLIST)
    return { ok: false, error: `Playlists hold up to ${MAX_ITEMS_PER_PLAYLIST} titles.` }

  try {
    await db.playlistItem.create({
      data: { playlistId, resourceId, position: count + 1 },
    })
  } catch {
    return { ok: false, error: 'That title is already in this playlist.' }
  }
  await db.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } })
  return { ok: true }
}

export async function removePlaylistItem(itemId: string): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const item = await db.playlistItem.findUnique({
    where: { id: itemId },
    include: { playlist: { select: { producerId: true } } },
  })
  if (!item) return { ok: false, error: 'Item not found.' }
  if (item.playlist.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your playlist.' }
  await db.playlistItem.delete({ where: { id: itemId } })
  await db.playlist.update({
    where: { id: item.playlistId },
    data: { updatedAt: new Date() },
  })
  return { ok: true }
}

// Move = swap positions with the neighbour in the requested direction.
export async function movePlaylistItem(
  itemId: string,
  dir: 'up' | 'down',
): Promise<ActionResult> {
  const auth = await requireProducer()
  if ('error' in auth) return { ok: false, error: auth.error }
  const item = await db.playlistItem.findUnique({
    where: { id: itemId },
    include: { playlist: { select: { producerId: true } } },
  })
  if (!item) return { ok: false, error: 'Item not found.' }
  if (item.playlist.producerId !== auth.user.id && auth.user.role !== 'ADMIN')
    return { ok: false, error: 'Not your playlist.' }

  const siblings = await db.playlistItem.findMany({
    where: { playlistId: item.playlistId },
    orderBy: { position: 'asc' },
  })
  const idx = siblings.findIndex((s) => s.id === itemId)
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= siblings.length) return { ok: true } // already at edge

  const other = siblings[swapIdx]
  await db.$transaction([
    db.playlistItem.update({ where: { id: item.id }, data: { position: other.position } }),
    db.playlistItem.update({ where: { id: other.id }, data: { position: item.position } }),
  ])
  await db.playlist.update({
    where: { id: item.playlistId },
    data: { updatedAt: new Date() },
  })
  return { ok: true }
}
