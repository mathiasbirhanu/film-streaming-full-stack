'use client'

import { Clapperboard } from 'lucide-react'
import { cn } from '@/lib/utils'

// Company logo — swap the mark/wordmark here and it rebrands the app,
// the player overlay and the watermark strip everywhere.
export function StreamRootsLogo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 select-none', className)}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/20">
        <Clapperboard className="h-4.5 w-4.5 text-white" strokeWidth={2.2} />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-tight text-foreground">
            Stream<span className="text-emerald-400">Roots</span>
          </div>
          <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            stories from home
          </div>
        </div>
      )}
    </div>
  )
}
