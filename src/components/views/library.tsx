'use client'

import { useEffect, useState } from 'react'
import { getCatalog, getContinueWatching, getLibrary, type ContinueItem as CW, type LibraryItem } from '@/lib/actions/catalog'
import { useApp } from '@/components/store'
import { ContentRow } from '@/components/content-row'
import { ResourceCard } from '@/components/resource-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Crown } from 'lucide-react'
import type { CatalogItem } from '@/lib/types'

export function LibraryView() {
  const { go, session, membership, openAuth } = useApp()
  const [purchases, setPurchases] = useState<LibraryItem[] | null>(null)
  const [continueItems, setContinueItems] = useState<CW[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])

  useEffect(() => {
    if (!session) return
    void getLibrary().then((l) => setPurchases(l.purchases))
    void getContinueWatching().then(setContinueItems)
    void getCatalog().then(setCatalog)
  }, [session])

  if (!session) {
    return (
      <div className="px-6 py-24 text-center">
        <h1 className="text-xl font-bold">Your library</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to see your titles and progress.</p>
        <Button className="mt-4 bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => openAuth('signin')}>
          Sign in
        </Button>
      </div>
    )
  }

  const progressById = Object.fromEntries(continueItems.map((c) => [c.resourceId, c.percent]))
  const continueCatalog = catalog.filter((c) => continueItems.some((ci) => ci.resourceId === c.id))

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Purchases are yours forever. Membership titles stream while Premium is active.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {membership?.active ? (
            <Badge className="bg-emerald-600 text-white">
              <Crown className="mr-1 h-3 w-3" /> Premium
            </Badge>
          ) : (
            <Button size="sm" onClick={() => go('membership')} className="bg-emerald-600 text-white hover:bg-emerald-500">
              Go Premium
            </Button>
          )}
        </div>
      </div>

      {continueItems.length > 0 && (
        <ContentRow
          title="Continue watching"
          items={continueCatalog}
          progressById={progressById}
          showProgress
        />
      )}

      <section>
        <h2 className="mb-3 text-[15px] font-bold tracking-tight">Owned titles</h2>
        {!purchases ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-[240px] rounded-lg" />
            ))}
          </div>
        ) : purchases.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No purchases yet — titles you buy appear here forever.
            </p>
            <Button className="mt-3 bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => go('home')}>
              Browse catalog
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {purchases.map((p) => (
              <ResourceCard key={p.id} item={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
