'use client'

import { useState } from 'react'
import { buyMembership, cancelMembership } from '@/lib/actions/checkout'
import { etbFromCents, type PaymentMethod } from '@/lib/payments-gateway'
import { PaymentPicker } from '@/components/payment-picker'
import { useApp } from '@/components/store'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Crown, Loader2 } from 'lucide-react'
import { formatPrice, MEMBERSHIP_PRICE_CENTS } from '@/lib/types'

export function MembershipView() {
  const { session, membership, openAuth, setSession } = useApp()
  const { toast } = useToast()
  const [busy, setBusy] = useState<'buy' | 'cancel' | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('TELEBIRR')

  const subscribe = async () => {
    if (!session) {
      openAuth('register')
      return
    }
    setBusy('buy')
    const r = await buyMembership(method)
    setBusy(null)
    if (!r.ok) {
      toast({ title: 'Membership', description: r.error, variant: 'destructive' })
      return
    }
    setSession(session, {
      active: true,
      status: 'ACTIVE',
      expiresAt: r.data!.expiresAt,
      provider: method,
    })
    toast({ title: 'Welcome to Premium 🎉', description: `Paid via ${method} (demo). The full catalog is unlocked.` })
  }

  const cancel = async () => {
    setBusy('cancel')
    const r = await cancelMembership()
    setBusy(null)
    if (!r.ok) {
      toast({ title: 'Membership', description: r.error, variant: 'destructive' })
      return
    }
    setSession(session, { active: false, status: 'CANCELED', expiresAt: null, provider: null })
    toast({ title: 'Membership canceled', description: 'Access ends immediately in this demo.' })
  }

  const active = membership?.active

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-950/50 to-zinc-900">
        <div className="border-b border-white/10 bg-black/20 p-6 text-center sm:p-8">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <Crown className="h-6 w-6 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">StreamRoots Premium</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            One membership. Every Members title. Cancel anytime.
          </p>
          <div className="mt-4 flex items-baseline justify-center gap-1">
            <span className="text-4xl font-black text-white">{formatPrice(MEMBERSHIP_PRICE_CENTS)}</span>
            <span className="text-sm text-muted-foreground">/month</span>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <ul className="mx-auto grid max-w-md gap-2.5 text-sm">
            {[
              'Unlimited access to every Members title',
              'New releases from your region, weekly',
              'Watch on any device — progress follows you',
              'Directly supports the creators you watch',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 text-center">
            {!session ? (
              <Button size="lg" onClick={subscribe} className="bg-emerald-600 text-white hover:bg-emerald-500">
                Create an account to join
              </Button>
            ) : active ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <Badge className="bg-emerald-600 text-white">Premium active</Badge>
                  {membership?.expiresAt && (
                    <span className="text-sm text-muted-foreground">
                      until {new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </div>
                <Button variant="outline" onClick={cancel} disabled={busy !== null}>
                  {busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Cancel membership
                </Button>
              </div>
            ) : (
              <div className="mx-auto max-w-sm space-y-3 text-left">
                <div className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Pay with
                </div>
                <PaymentPicker value={method} onChange={setMethod} disabled={busy !== null} />
                <p className="text-center text-[11px] text-muted-foreground">
                  ≈ ETB {etbFromCents(MEMBERSHIP_PRICE_CENTS)} / month • demo charge, no real money moves
                </p>
                <Button
                  size="lg"
                  onClick={subscribe}
                  disabled={busy !== null}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  {busy === 'buy' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Join Premium — {formatPrice(MEMBERSHIP_PRICE_CENTS)}/mo
                </Button>
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              telebirr • CBE Birr • Chapa • card — via the authorizeCharge() seam. No real charge.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
