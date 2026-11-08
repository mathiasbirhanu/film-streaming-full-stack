'use client'

import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ResourceCard } from '@/components/resource-card'
import type { CatalogItem } from '@/lib/types'

interface RowProps {
  title: string
  items: CatalogItem[]
  progressById?: Record<string, number>
  showProgress?: boolean
}

export function ContentRow({ title, items, progressById, showProgress }: RowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  if (items.length === 0) return null
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
          {items.map((item) => (
            <ResourceCard
              key={`${title}-${item.id}`}
              item={item}
              showProgress={showProgress}
              progress={progressById?.[item.id]}
            />
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
