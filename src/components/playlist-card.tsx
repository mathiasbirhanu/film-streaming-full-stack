'use client'

import { useRef } from 'react'
import { ChevronLeft, ChevronRight, ListVideo } from 'lucide-react'
import { useApp } from '@/components/store'
import { useDataSaver } from '@/lib/data-saver'
import { thumbLow } from '@/lib/utils'
import type { PlaylistSummary } from '@/lib/actions/playlist'

// Playlist card — cover is the first title's proxied poster (keeps the
// YouTube id server-side), with a count chip like platform playlist bags.
export function PlaylistCard({ p }: { p: PlaylistSummary }) {
  const openPlaylist = useApp((s) => s.openPlaylist)
  const saver = useDataSaver((s) => s.on)
  return (
    <button
      onClick={() => openPlaylist(p.id)}
      className="group w-[240px] shrink-0 snap-start text-left sm:w-[260px]"
      aria-label={`Open playlist ${p.title}`}
    >
      <div className="relative overflow-hidden rounded-lg ring-1 ring-white/10 transition duration-200 group-hover:ring-emerald-400/60 group-hover:shadow-xl group-hover:shadow-emerald-500/10">
        {p.poster ? (
          <img
            src={saver && p.posterId ? thumbLow(p.posterId) : p.poster}
            alt={p.title}
            loading="lazy"
            className="aspect-video w-full bg-zinc-800 object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="aspect-video w-full bg-zinc-800" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white/85 ring-1 ring-white/15">
          <ListVideo className="h-3 w-3" />
          {p.itemCount} {p.itemCount === 1 ? 'title' : 'titles'}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2.5 pr-16">
          <div className="truncate text-sm font-semibold text-white">{p.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-white/60">
            {p.producerName ? `by ${p.producerName}` : 'Curated playlist'}
          </div>
        </div>
      </div>
    </button>
  )
}

// Horizontal rail, same interaction pattern as ContentRow.
export function PlaylistRail({ title, playlists }: { title: string; playlists: PlaylistSummary[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  if (playlists.length === 0) return null
  const scroll = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * 560, behavior: 'smooth' })
  return (
    <section className="group/row relative">
      <h2 className="mb-2.5 px-4 text-[15px] font-bold tracking-tight text-foreground sm:px-6">
        {title}
      </h2>
      <div className="relative">
        <div
          ref={scroller}
          className="flex snap-x gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {playlists.map((p) => (
            <PlaylistCard key={p.id} p={p} />
          ))}
        </div>
        <button
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
          className="absolute left-1 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/row:opacity-100 md:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={() => scroll(1)}
          aria-label="Scroll right"
          className="absolute right-1 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/row:opacity-100 md:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  )
}
