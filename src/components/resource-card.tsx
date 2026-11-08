'use client'

import { Crown, Play } from 'lucide-react'
import type { CatalogItem } from '@/lib/types'
import { formatPrice } from '@/lib/types'
import { useApp } from '@/components/store'
import { useDataSaver } from '@/lib/data-saver'
import { thumbLow } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function PriceBadge({ item, className }: { item: CatalogItem; className?: string }) {
  if (item.pricingType === 'FREE')
    return (
      <span className={cn('inline-flex items-center rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white', className)}>
        Free
      </span>
    )
  if (item.pricingType === 'MEMBERSHIP')
    return (
      <span className={cn('inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-500/40', className)}>
        <Crown className="h-2.5 w-2.5" /> Members
      </span>
    )
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white ring-1 ring-white/20', className)}>
      {item.discountPercent > 0 && (
        <span className="text-[10px] font-medium text-white/50 line-through">
          {formatPrice(item.priceCents)}
        </span>
      )}
      {formatPrice(item.effectivePriceCents)}
    </span>
  )
}

export function ResourceCard({
  item,
  progress,
  showProgress = false,
}: {
  item: CatalogItem
  progress?: number
  showProgress?: boolean
}) {
  const openWatch = useApp((s) => s.openWatch)
  const saver = useDataSaver((s) => s.on)
  return (
    <button
      onClick={() => openWatch(item.id)}
      className="group w-[240px] shrink-0 snap-start text-left sm:w-[260px]"
      aria-label={`Watch ${item.title}`}
    >
      <div className="relative overflow-hidden rounded-lg ring-1 ring-white/10 transition duration-200 group-hover:ring-emerald-400/60 group-hover:shadow-xl group-hover:shadow-emerald-500/10">
        { }
        <img
          src={saver ? thumbLow(item.id) : item.poster}
          alt={item.title}
          loading="lazy"
          className="aspect-video w-full bg-zinc-800 object-cover transition duration-300 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute left-2 top-2">
          <PriceBadge item={item} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-200 group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/95 shadow-lg">
            <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <div className="truncate text-sm font-semibold text-white">{item.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/60">
            <span>{item.genre}</span>
            {item.year && <span>• {item.year}</span>}
          </div>
          {showProgress && typeof progress === 'number' && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
