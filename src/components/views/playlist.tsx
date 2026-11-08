'use client'

import { useEffect, useState } from 'react'
import { getPlaylistDetail, type PlaylistDetail } from '@/lib/actions/playlist'
import { useApp } from '@/components/store'
import { useDataSaver } from '@/lib/data-saver'
import { thumbLow } from '@/lib/utils'
import { PriceBadge } from '@/components/resource-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, ListVideo, Play } from 'lucide-react'

// Playlist detail — ordered, numbered titles. Click-through uses the
// normal watch flow, so per-title entitlement (free / members / PPV)
// is enforced exactly as everywhere else.
export function PlaylistView() {
  const { playlistId, go, openWatch } = useApp()
  const saver = useDataSaver((s) => s.on)
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!playlistId) return
    let alive = true
    setLoading(true)
    void (async () => {
      const d = await getPlaylistDetail(playlistId)
      if (!alive) return
      setDetail(d)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [playlistId])

  if (!playlistId) return null

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <button
        onClick={() => go('home')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </button>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {!loading && !detail && (
        <div className="px-6 py-20 text-center">
          <h1 className="text-xl font-bold">Playlist not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This playlist was unpublished or removed by its producer.
          </p>
        </div>
      )}

      {!loading && detail && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
                <ListVideo className="h-4 w-4" /> Playlist
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                {detail.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {detail.itemCount} {detail.itemCount === 1 ? 'title' : 'titles'}
                {detail.producerName ? ` • curated by ${detail.producerName}` : ''}
              </p>
            </div>
            {detail.items.length > 0 && (
              <Button
                onClick={() => openWatch(detail.items[0].id)}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <Play className="mr-2 h-4 w-4 fill-white" /> Play all
              </Button>
            )}
          </div>

          {detail.description && (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {detail.description}
            </p>
          )}

          <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
            {detail.items.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => openWatch(item.id)}
                className={`flex w-full items-center gap-3 p-3 text-left transition hover:bg-white/5 ${
                  idx > 0 ? 'border-t border-white/5' : ''
                }`}
              >
                <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
                  {idx + 1}
                </span>
                <img
                  src={saver ? thumbLow(item.id) : item.poster}
                  alt=""
                  loading="lazy"
                  className="h-12 w-[88px] shrink-0 rounded bg-zinc-800 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{item.genre}</span>
                    {item.year && <span>• {item.year}</span>}
                    {item.producerName && <span>• {item.producerName}</span>}
                  </div>
                </div>
                <PriceBadge item={item} className="shrink-0" />
                <Play className="h-4 w-4 shrink-0 fill-current text-emerald-400" />
              </button>
            ))}
          </div>

          {detail.items.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-white/15 p-10 text-center text-sm text-muted-foreground">
              No watchable titles in this playlist right now.
            </div>
          )}
        </>
      )}
    </div>
  )
}
