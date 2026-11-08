'use client'

import { useEffect, useMemo, useState } from 'react'
import { getCatalog, getContinueWatching, type ContinueItem } from '@/lib/actions/catalog'
import { getPlaylists } from '@/lib/actions/playlist'
import { PlaylistRail } from '@/components/playlist-card'
import { useApp } from '@/components/store'
import { useDataSaver } from '@/lib/data-saver'
import { thumbLow, thumbHD } from '@/lib/utils'
import { ContentRow } from '@/components/content-row'
import { PriceBadge } from '@/components/resource-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Play, Search, Sparkles, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ResourceCard } from '@/components/resource-card'
import type { CatalogItem } from '@/lib/types'
import { formatPrice, GENRES } from '@/lib/types'

export function HomeView() {
  const { go, openWatch, session, membership, openAuth } = useApp()
  const saver = useDataSaver((s) => s.on)
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null)
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([])
  const [playlists, setPlaylists] = useState<Awaited<ReturnType<typeof getPlaylists>>>([])
  const [query, setQuery] = useState('')
  const [genreFilter, setGenreFilter] = useState('ALL')

  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await getCatalog()
      if (alive) setCatalog(rows)
    })()
    void (async () => {
      const lists = await getPlaylists()
      if (alive) setPlaylists(lists)
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!session) return
    let alive = true
    void (async () => {
      const items = await getContinueWatching()
      if (alive) setContinueItems(items)
    })()
    return () => {
      alive = false
    }
  }, [session])

  const featured = catalog?.[0]
  const rest = catalog?.slice(1) ?? []

  const byGenre = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of rest) {
      const list = map.get(item.genre) ?? []
      list.push(item)
      map.set(item.genre, list)
    }
    return [...map.entries()].filter(([, items]) => items.length >= 2)
  }, [rest])

  const notable = useMemo(() => {
    const inGenre = new Set(byGenre.flatMap(([, items]) => items.map((i) => i.id)))
    return rest.filter((i) => !inGenre.has(i.id)).slice(0, 10)
  }, [rest, byGenre])

  // Search & filter — runs entirely client-side over the already-loaded
  // catalog: zero extra network requests (Data Saver friendly), instant
  // keystroke response. Title = case-insensitive substring; genre = exact.
  const searching = query.trim().length > 0 || genreFilter !== 'ALL'
  const results = useMemo(() => {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    return catalog.filter((i) => {
      const okTitle = !q || i.title.toLowerCase().includes(q)
      const okGenre = genreFilter === 'ALL' || i.genre === genreFilter
      return okTitle && okGenre
    })
  }, [catalog, query, genreFilter])

  const showMembershipBanner =
    !!session &&
    !membership?.active &&
    (catalog?.some((i) => i.pricingType === 'MEMBERSHIP') ?? false)

  if (!catalog) {
    return (
      <div className="space-y-6 px-4 py-6 sm:px-6">
        <Skeleton className="aspect-video w-full max-h-[420px] rounded-xl" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-[240px] rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (catalog.length === 0) {
    return (
      <div className="px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">The catalog is warming up</h1>
        <p className="mt-2 text-muted-foreground">
          No titles are published yet. Producers can submit from the Producer Studio, and the
          admin approves them in the Admin console.
        </p>
      </div>
    )
  }

  const progressById = Object.fromEntries(continueItems.map((c) => [c.resourceId, c.percent]))

  return (
    <div className="pb-10">
      {/* Hero billboard */}
      {!searching && featured && (
        <div className="relative">
          { }
          <img
            src={saver ? thumbLow(featured.id) : thumbHD(featured.id)}
            alt=""
            className="h-[300px] w-full object-cover sm:h-[420px]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-zinc-950/10" />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-6 sm:px-10 sm:pb-10">
            <div className="max-w-xl">
              <div className="mb-2 flex items-center gap-2">
                <PriceBadge item={featured} />
                <span className="text-xs font-medium uppercase tracking-widest text-white/60">
                  {featured.producerName ? `A film by ${featured.producerName}` : 'Featured today'}
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
                {featured.title}
              </h1>
              {featured.description && (
                <p className="mt-2 line-clamp-2 text-sm text-white/70 sm:text-base">
                  {featured.description}
                </p>
              )}
              <div className="mt-4 flex gap-2.5">
                <Button
                  size="lg"
                  onClick={() => (session ? openWatch(featured.id) : openAuth('signin', featured.id))}
                  className="bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  <Play className="mr-2 h-4 w-4 fill-white" />
                  {featured.pricingType === 'FREE' ? 'Watch now' : 'Watch'}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-black/40 text-white hover:bg-white/10"
                  onClick={() => go('membership')}
                >
                  {formatPrice(799)}/mo • everything
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search & filter — by title and genre */}
      <div className="mt-6 px-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title…"
              aria-label="Search titles"
              className="h-10 border-white/15 bg-black/40 pl-9 text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={genreFilter} onValueChange={setGenreFilter}>
            <SelectTrigger
              className="h-10 w-full border-white/15 bg-black/40 text-sm sm:w-48"
              aria-label="Filter by genre"
            >
              <SelectValue placeholder="All genres" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All genres</SelectItem>
              {GENRES.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {searching && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery('')
                setGenreFilter('ALL')
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {searching ? (
        <div className="mt-6 px-4 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? 'title' : 'titles'} found
            {query.trim() && (
              <>
                {' '}
                for “<span className="font-semibold text-foreground">{query.trim()}</span>”
              </>
            )}
            {genreFilter !== 'ALL' && (
              <>
                {' '}
                in <span className="font-semibold text-foreground">{genreFilter}</span>
              </>
            )}
          </p>
          {results.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-base font-semibold">No titles match</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different title or genre.</p>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              {results.map((item) => (
                <ResourceCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          {continueItems.length > 0 && (
            <ContentRow
              title="Continue watching"
              items={catalog.filter((c) => continueItems.some((ci) => ci.resourceId === c.id))}
              progressById={progressById}
              showProgress
            />
          )}

          {catalog.some((i) => i.discountPercent > 0) && (
            <ContentRow title="Deals" items={catalog.filter((i) => i.discountPercent > 0)} />
          )}

          {playlists.length > 0 && <PlaylistRail title="Curated playlists" playlists={playlists} />}

          {notable.length > 0 && <ContentRow title="New & notable" items={notable} />}

          {byGenre.map(([genre, items]) => (
            <ContentRow key={genre} title={genre} items={items} />
          ))}

          {showMembershipBanner && (
            <div className="mx-4 sm:mx-6">
              <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-emerald-500/25 bg-gradient-to-r from-emerald-950/60 to-zinc-900 p-5 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2 text-base font-bold">
                    <Sparkles className="h-4 w-4 text-emerald-400" />
                    Go Premium — one membership, the whole catalog
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Everything marked <span className="font-semibold text-emerald-300">Members</span> unlocks
                    instantly at {formatPrice(799)}/month. Cancel anytime.
                  </p>
                </div>
                <Button onClick={() => go('membership')} className="bg-emerald-600 text-white hover:bg-emerald-500">
                  See membership
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
