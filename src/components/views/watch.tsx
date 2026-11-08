'use client'

import { useCallback, useEffect, useState } from 'react'
import { getPlayback } from '@/lib/actions/playback'
import { getUpNext } from '@/lib/actions/catalog'
import { buyMembership, purchaseResource } from '@/lib/actions/checkout'
import { etbFromCents, type PaymentMethod } from '@/lib/payments-gateway'
import { PlayerStage } from '@/components/player-stage'
import { PaymentPicker } from '@/components/payment-picker'
import { ContentRow } from '@/components/content-row'
import { useApp } from '@/components/store'
import { useDataSaver } from '@/lib/data-saver'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Crown, Loader2, Lock, ShieldCheck } from 'lucide-react'
import type { CatalogItem, PlaybackPayload } from '@/lib/types'
import { formatPrice } from '@/lib/types'

export function WatchView() {
  const { watchId, go, session, openAuth, setSession } = useApp()
  const saver = useDataSaver((s) => s.on)
  const { toast } = useToast()
  const [payload, setPayload] = useState<PlaybackPayload | null>(null)
  const [upNext, setUpNext] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('TELEBIRR')
  const [subMethod, setSubMethod] = useState<PaymentMethod>('TELEBIRR')

  const load = useCallback(async () => {
    if (!watchId) return
    setLoading(true)
    const p = await getPlayback(watchId)
    setPayload(p)
    setLoading(false)
    void getUpNext(watchId).then((rows) => setUpNext(rows))
  }, [watchId])

  useEffect(() => {
    if (!watchId) return
    let alive = true
    void (async () => {
      const p = await getPlayback(watchId)
      if (!alive) return
      setPayload(p)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [watchId, session])

  if (!watchId) return null

  const handleSubscribe = async () => {
    if (!session) {
      openAuth('signin', watchId)
      return
    }
    setBusy(true)
    const r = await buyMembership(subMethod)
    setBusy(false)
    if (!r.ok) {
      toast({ title: 'Membership', description: r.error, variant: 'destructive' })
      return
    }
    await useApp.getState().setSession(session, {
      active: true,
      status: 'ACTIVE',
      expiresAt: r.data!.expiresAt,
      provider: subMethod,
    })
    toast({ title: 'Welcome to Premium', description: `Paid via ${subMethod} (demo). Every Members title is now unlocked.` })
    void load()
  }

  const handlePurchase = async () => {
    setBusy(true)
    const r = await purchaseResource(watchId, method)
    setBusy(false)
    setCheckoutOpen(false)
    if (!r.ok) {
      toast({ title: 'Purchase failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({
      title: 'Purchase complete',
      description: `Paid via ${method} (demo) — ${r.data!.title} is yours to watch, anytime.`,
    })
    void load()
  }

  const item = payload?.item

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <button
        onClick={() => go('home')}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </button>

      {loading && <Skeleton className="aspect-video w-full rounded-xl" />}

      {!loading && payload?.ok && payload.embedUrl && payload.watermark && (
        <>
          <PlayerStage
            resourceId={watchId}
            embedUrl={payload.embedUrl}
            watermark={payload.watermark}
            saver={saver}
          />
          <div className="mt-4">
            <h1 className="text-2xl font-bold tracking-tight">{payload.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{payload.genre}</Badge>
              {payload.producerName && <span>by {payload.producerName}</span>}
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" /> playback licensed to {payload.watermark.name}
              </span>
            </div>
            {payload.description && (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {payload.description}
              </p>
            )}
          </div>
        </>
      )}

      {!loading && payload && !payload.ok && (
        <div className="relative overflow-hidden rounded-xl">
          {item && (
            <>
              { }
              <img src={item.poster} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />
              <div className="absolute inset-0 bg-black/70" />
            </>
          )}
          <div className="relative z-10 mx-auto max-w-md p-8 text-center sm:p-10">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40">
              <Lock className="h-5 w-5 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold text-white">{payload.title ?? 'This title'}</h1>
            <p className="mt-1.5 text-sm text-white/70">
              {payload.reason === 'LOGIN_REQUIRED' &&
                'Sign in to watch — playback is watermarked to your account.'}
              {payload.reason === 'NEED_SUBSCRIPTION' &&
                'Part of your StreamRoots Premium membership.'}
              {payload.reason === 'NEED_PURCHASE' && 'Unlock with a one-time purchase.'}
              {payload.reason === 'UNAVAILABLE' && 'This title is not available right now.'}
            </p>

            {item && item.pricingType === 'PPV' && payload.reason === 'NEED_PURCHASE' && (
              <div className="mt-4 flex items-baseline justify-center gap-2">
                {item.discountPercent > 0 && (
                  <>
                    <span className="text-lg text-white/40 line-through">
                      {formatPrice(item.priceCents)}
                    </span>
                    <Badge className="bg-amber-500 text-black">-{item.discountPercent}%</Badge>
                  </>
                )}
                <span className="text-3xl font-black text-white">
                  {formatPrice(item.effectivePriceCents)}
                </span>
              </div>
            )}

            <div className="mt-5 space-y-2">
              {payload.reason === 'LOGIN_REQUIRED' && (
                <Button
                  size="lg"
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => openAuth('signin', watchId)}
                >
                  Sign in to watch
                </Button>
              )}
              {payload.reason === 'NEED_SUBSCRIPTION' && (
              <div className="space-y-2">
                <PaymentPicker value={subMethod} onChange={setSubMethod} disabled={busy} />
                <Button
                  size="lg"
                  disabled={busy}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={handleSubscribe}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Crown className="mr-2 h-4 w-4" />
                  )}
                  Subscribe — {formatPrice(799)}/month
                </Button>
              </div>
              )}
              {payload.reason === 'NEED_PURCHASE' && item && (
                <Button
                  size="lg"
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => setCheckoutOpen(true)}
                >
                  Buy & watch — {formatPrice(item.effectivePriceCents)}
                </Button>
              )}
              <p className="text-[11px] text-white/45">
                Every playback is stamped with your name, account id and license ref.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Demo checkout (Stripe-shaped seam) */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Checkout</DialogTitle>
            <DialogDescription>
              One-time purchase • lifetime access to this title.
            </DialogDescription>
          </DialogHeader>
          {item && (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.genre}</div>
                </div>
                <div className="text-right">
                  {item.discountPercent > 0 && (
                    <div className="text-xs text-muted-foreground line-through">
                      {formatPrice(item.priceCents)}
                    </div>
                  )}
                  <div className="text-lg font-bold text-emerald-400">
                    {formatPrice(item.effectivePriceCents)}
                  </div>
                </div>
              </div>
              <PaymentPicker value={method} onChange={setMethod} disabled={busy} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                ≈ ETB {etbFromCents(item.effectivePriceCents)} • demo charge — no real money
                moves. The authorizeCharge() seam behind this dialog drops in live telebirr /
                CBE Birr / Chapa / Stripe without touching catalog, entitlements or the ledger.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={busy}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Pay {item ? formatPrice(item.effectivePriceCents) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Up Next — same genre first, then newest */}
      {!loading && upNext.length > 0 && (
        <div className="mt-8">
          <ContentRow title="Up next" items={upNext} />
        </div>
      )}
    </div>
  )
}
