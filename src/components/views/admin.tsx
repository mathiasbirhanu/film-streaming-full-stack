'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  moderate, adminOverview, adminResources, adminUsers, adminIncomeReport, setDiscount, sendDiscountCampaign, setRevenueSplit,
  type AdminOverview, type AdminResourceRow, type AdminUserRow, type AdminIncomeReport,
} from '@/lib/actions/admin'
import { useApp } from '@/components/store'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Check, Crown, DollarSign, Eye, Loader2, Megaphone, ShieldCheck, X } from 'lucide-react'
import type { ResourceStatus } from '@/lib/types'
import { formatPrice } from '@/lib/types'

function StatusChip({ status }: { status: ResourceStatus }) {
  const styles: Record<ResourceStatus, string> = {
    DRAFT: 'bg-zinc-700 text-zinc-200',
    PENDING_REVIEW: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40',
    PUBLISHED: 'bg-emerald-600 text-white',
    REJECTED: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40',
    SUSPENDED: 'bg-red-600 text-white',
  }
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status]}`}>{status.replace('_', ' ')}</span>
}

// Basis points → display percent (7000 → "70", 7250 → "72.5")
function pctText(bps: number): string {
  const p = bps / 100
  return Number.isInteger(p) ? String(p) : p.toFixed(1)
}

// ── Graphical revenue report ────────────────────────────────────────────

function RevenueDonut({ producerCents, platformCents }: { producerCents: number; platformCents: number }) {
  const total = producerCents + platformCents
  const share = total > 0 ? producerCents / total : 0.7
  const R = 42
  const C = 2 * Math.PI * R
  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row">
      <svg viewBox="0 0 110 110" className="h-36 w-36 shrink-0">
        <circle cx="55" cy="55" r={R} fill="none" stroke="#f59e0b" strokeWidth="14" />
        <circle
          cx="55" cy="55" r={R} fill="none" stroke="#10b981" strokeWidth="14"
          strokeDasharray={`${(C * share).toFixed(1)} ${C.toFixed(1)}`}
          transform="rotate(-90 55 55)"
        />
        <text x="55" y="51" textAnchor="middle" fill="white" fontSize="12" fontWeight="800">
          {formatPrice(total)}
        </text>
        <text x="55" y="63" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="6.5">
          total settled revenue
        </text>
      </svg>
      <div className="w-full min-w-0 flex-1 space-y-2.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-sm bg-emerald-500" />
          <span className="font-semibold text-emerald-300">Producers</span>
          <span className="ml-auto shrink-0 tabular-nums">{formatPrice(producerCents)} · {(share * 100).toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-sm bg-amber-500" />
          <span className="font-semibold text-amber-300">Platform</span>
          <span className="ml-auto shrink-0 tabular-nums">{formatPrice(platformCents)} · {((1 - share) * 100).toFixed(0)}%</span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Ledger-recorded 70/30 split of every settled charge (EARNED vs PLATFORM_FEE entries).
        </p>
      </div>
    </div>
  )
}

function RevenueBars({ membershipCents, purchaseCents }: { membershipCents: number; purchaseCents: number }) {
  const max = Math.max(membershipCents, purchaseCents, 1)
  const row = (label: string, cents: number, color: string) => (
    <div key={label}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{formatPrice(cents)}</span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, (cents / max) * 100)}%` }} />
      </div>
    </div>
  )
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Revenue streams</div>
      {row('Memberships (active MRR)', membershipCents, 'bg-emerald-500')}
      {row('Pay-per-view (lifetime)', purchaseCents, 'bg-sky-500')}
    </div>
  )
}

function TopTitles({ titles }: { titles: { id: string; title: string; revenueCents: number }[] }) {
  const max = Math.max(...titles.map((t) => t.revenueCents), 1)
  if (titles.length === 0)
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
        No purchases yet — the revenue leaderboard fills in as titles sell.
      </div>
    )
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Top titles by revenue</div>
      {titles.map((t) => (
        <div key={t.id}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium">{t.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatPrice(t.revenueCents)}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width: `${Math.max(2, (t.revenueCents / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdminView() {
  const { session, openAuth, go } = useApp()
  const { toast } = useToast()
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [resources, setResources] = useState<AdminResourceRow[] | null>(null)
  const [users, setUsers] = useState<AdminUserRow[] | null>(null)
  const [income, setIncome] = useState<AdminIncomeReport | null>(null)
  const [shareInput, setShareInput] = useState('70')
  const [rejectTarget, setRejectTarget] = useState<AdminResourceRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [discountTarget, setDiscountTarget] = useState<AdminResourceRow | null>(null)
  const [discountPercent, setDiscountPercent] = useState('30')
  const [discountDays, setDiscountDays] = useState('14')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [o, r, u, inc] = await Promise.all([adminOverview(), adminResources(), adminUsers(), adminIncomeReport()])
    if (o.ok && o.data) setOverview(o.data)
    if (r.ok && r.data) setResources(r.data)
    if (u.ok && u.data) setUsers(u.data)
    if (inc.ok && inc.data) {
      setIncome(inc.data)
      setShareInput(String(inc.data.producerShareBps / 100))
    }
  }, [])

  useEffect(() => {
    if (session?.role !== 'ADMIN') return
    let alive = true
    void (async () => {
      const [o, r, u, inc] = await Promise.all([adminOverview(), adminResources(), adminUsers(), adminIncomeReport()])
      if (!alive) return
      if (o.ok && o.data) setOverview(o.data)
      if (r.ok && r.data) setResources(r.data)
      if (u.ok && u.data) setUsers(u.data)
      if (inc.ok && inc.data) {
        setIncome(inc.data)
        setShareInput(String(inc.data.producerShareBps / 100))
      }
    })()
    return () => {
      alive = false
    }
  }, [session])

  if (!session || session.role !== 'ADMIN') {
    return (
      <div className="px-6 py-24 text-center">
        <h1 className="text-xl font-bold">Admin console</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with the admin account.</p>
        {!session ? (
          <Button className="mt-4 bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => openAuth('signin')}>
            Sign in
          </Button>
        ) : (
          <Button variant="outline" className="mt-4" onClick={() => go('home')}>
            Back to catalog
          </Button>
        )}
      </div>
    )
  }

  const act = async (row: AdminResourceRow, action: 'approve' | 'suspend' | 'republish') => {
    setBusy(`${action}-${row.id}`)
    const r = await moderate(row.id, action)
    setBusy(null)
    if (!r.ok) {
      toast({ title: 'Action failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: `✅ ${row.title} → ${action === 'approve' ? 'published' : action === 'suspend' ? 'suspended' : 'published'}` })
    void refresh()
  }

  const reject = async () => {
    if (!rejectTarget) return
    setBusy(`reject-${rejectTarget.id}`)
    const r = await moderate(rejectTarget.id, 'reject', rejectReason)
    setBusy(null)
    setRejectTarget(null)
    setRejectReason('')
    if (!r.ok) {
      toast({ title: 'Rejection failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Title rejected', description: 'The producer sees the reason in their studio.' })
    void refresh()
  }

  const pending = resources?.filter((r) => r.status === 'PENDING_REVIEW') ?? []

  const applyDiscount = async () => {
    if (!discountTarget) return
    setBusy(`discount-${discountTarget.id}`)
    const r = await setDiscount(discountTarget.id, Number(discountPercent), Number(discountDays))
    setBusy(null)
    setDiscountTarget(null)
    if (!r.ok) {
      toast({ title: 'Discount failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Discount live', description: `${discountTarget.title} now sells at ${Math.round(Number(discountPercent))}% off.` })
    void refresh()
  }

  const campaign = async (row: AdminResourceRow) => {
    setBusy(`campaign-${row.id}`)
    const r = await sendDiscountCampaign(row.id)
    setBusy(null)
    if (!r.ok) {
      toast({ title: 'Campaign failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Campaign sent', description: `${r.data!.recipients} users notified about ${row.title}.` })
  }

  const applyShare = async () => {
    setBusy('share')
    const r = await setRevenueSplit(Number(shareInput))
    setBusy(null)
    if (!r.ok) {
      toast({ title: 'Split not saved', description: r.error, variant: 'destructive' })
      return
    }
    toast({
      title: 'Revenue split updated',
      description: `Producers now earn ${pctText(r.data!.producerShareBps)}% of each future sale.`,
    })
    void refresh()
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="h-6 w-6 text-emerald-400" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin console</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Approvals, catalog, users and money — everything lands here.
          </p>
        </div>
      </div>

      <Tabs defaultValue="approvals" className="mt-6">
        <TabsList>
          <TabsTrigger value="approvals">
            Approvals {pending.length > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="promotions">Promotions</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        {/* ── Approvals ── */}
        <TabsContent value="approvals" className="mt-4 space-y-3">
          {!resources && <Skeleton className="h-40 w-full rounded-xl" />}
          {resources && pending.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-sm text-muted-foreground">
              Nothing waiting — the review queue is clear.
            </div>
          )}
          {pending.map((row) => (
            <div key={row.id} className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 sm:flex-row sm:items-center">
              { }
              <img src={row.poster} alt="" className="h-16 w-28 shrink-0 rounded bg-zinc-800 object-cover" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{row.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  by {row.producerName ?? '—'} • {row.genre} •{' '}
                  {row.pricingType === 'PPV'
                    ? `PPV ${formatPrice(row.effectivePriceCents)}`
                    : row.pricingType === 'MEMBERSHIP'
                      ? 'Members only'
                      : 'Free'}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => act(row, 'approve')}
                  disabled={busy === `approve-${row.id}`}
                >
                  {busy === `approve-${row.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                  Approve & publish
                </Button>
                <Button
                  size="sm" variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10"
                  onClick={() => setRejectTarget(row)}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>

        {/* ── Catalog ── */}
        <TabsContent value="catalog" className="mt-4">
          {!resources ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[36%]">Title</TableHead>
                    <TableHead>Producer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resources.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          { }
                          <img src={row.poster} alt="" className="h-9 w-16 shrink-0 rounded bg-zinc-800 object-cover" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{row.title}</div>
                            <div className="text-xs text-muted-foreground">{row.genre}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{row.producerName ?? <span className="text-muted-foreground">platform</span>}</TableCell>
                      <TableCell><StatusChip status={row.status} /></TableCell>
                      <TableCell className="text-sm">
                        {row.pricingType === 'PPV' ? formatPrice(row.effectivePriceCents) : row.pricingType === 'MEMBERSHIP' ? 'Members' : 'Free'}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{row.viewCount}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {(row.status === 'SUSPENDED' || row.status === 'REJECTED' || row.status === 'DRAFT') && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => act(row, 'republish')} disabled={busy === `republish-${row.id}`}>
                              Publish
                            </Button>
                          )}
                          {row.status === 'PUBLISHED' && (
                            <Button size="sm" variant="outline" className="h-7 border-red-500/40 text-xs text-red-300 hover:bg-red-500/10" onClick={() => act(row, 'suspend')} disabled={busy === `suspend-${row.id}`}>
                              Suspend
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Promotions ── */}
        <TabsContent value="promotions" className="mt-4">
          {!resources ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[34%]">Title</TableHead>
                    <TableHead>Base price</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Sells at</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resources
                    .filter((r) => r.status === 'PUBLISHED' && (r.pricingType === 'PPV' || r.pricingType === 'MEMBERSHIP'))
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <img src={r.poster} alt="" className="h-9 w-16 shrink-0 rounded bg-zinc-800 object-cover" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{r.title}</div>
                              <div className="text-xs text-muted-foreground">{r.pricingType}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{formatPrice(r.priceCents)}</TableCell>
                        <TableCell>
                          {r.discountPercent > 0 ? (
                            <Badge className="bg-amber-500 text-black">
                              -{r.discountPercent}%
                              {r.discountEndsAt && (
                                <span className="ml-1 font-medium opacity-80">
                                  till {new Date(r.discountEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </span>
                              )}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-semibold tabular-nums text-emerald-400">
                          {r.pricingType === 'PPV' ? formatPrice(r.effectivePriceCents) : 'Members'}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDiscountTarget(r)}>
                              Set discount
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                              disabled={r.discountPercent === 0 || busy === `campaign-${r.id}`}
                              onClick={() => campaign(r)}
                            >
                              {busy === `campaign-${r.id}` ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Megaphone className="mr-1 h-3 w-3" />
                              )}
                              Announce
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Income ── */}
        <TabsContent value="income" className="mt-4 space-y-4">
          {!income ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Revenue split</div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Producers earn <span className="font-semibold text-emerald-300">{pctText(income.producerShareBps)}%</span> and the platform keeps{' '}
                    <span className="font-semibold text-amber-300">{pctText(10000 - income.producerShareBps)}%</span> of every sale. Applies to future sales —{' '}
                    each past sale keeps the split it was sold under.
                  </p>
                </div>
                <div className="flex shrink-0 items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="producer-share">Producer share %</Label>
                    <Input
                      id="producer-share"
                      type="number"
                      min={10}
                      max={95}
                      className="w-28"
                      value={shareInput}
                      onChange={(e) => setShareInput(e.target.value)}
                    />
                  </div>
                  <Button
                    className="bg-emerald-600 text-white hover:bg-emerald-500"
                    disabled={busy !== null || Number(shareInput) < 10 || Number(shareInput) > 95}
                    onClick={applyShare}
                  >
                    {busy === 'share' ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <DollarSign className="mr-1 h-3.5 w-3.5" />
                    )}
                    Save split
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[36%]">Movie</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Gross income</TableHead>
                      <TableHead className="text-right">Producer ({pctText(income.producerShareBps)}%)</TableHead>
                      <TableHead className="text-right">Platform ({pctText(10000 - income.producerShareBps)}%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {income.rows.map((r) => (
                      <TableRow key={r.resourceId}>
                        <TableCell>
                          <div className="max-w-[280px] truncate text-sm font-semibold">{r.title}</div>
                          <div className="text-xs text-muted-foreground">{r.producerName ?? 'platform title'}</div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.sales}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{formatPrice(r.grossCents)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums text-emerald-400">
                          {formatPrice(r.producerCents)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums text-amber-400">
                          {formatPrice(r.platformCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {income.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                          No sales yet — one row appears per movie the moment a title sells.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  {income.rows.length > 0 && (
                    <TableFooter>
                      <TableRow className="hover:bg-transparent">
                        <TableCell>Total — all movies</TableCell>
                        <TableCell className="text-right tabular-nums">{income.totals.sales}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPrice(income.totals.grossCents)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-emerald-400">
                          {formatPrice(income.totals.producerCents)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-amber-400">
                          {formatPrice(income.totals.platformCents)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Membership income of <span className="font-semibold text-foreground">{formatPrice(income.membershipRevenueCents)}</span> is platform-only — subscriptions carry no producer share.
              </p>
            </>
          )}
        </TabsContent>

        {/* ── Users ── */}
        <TabsContent value="users" className="mt-4">
          {!users ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="text-sm font-medium">{u.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{u.role}</Badge></TableCell>
                      <TableCell>
                        {u.membershipActive ? (
                          <Badge className="bg-emerald-600 text-white text-xs"><Crown className="mr-1 h-3 w-3" /> Premium</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{u.purchases}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {!overview ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <RevenueDonut producerCents={overview.producerEarnedCents} platformCents={overview.platformFeesCents} />
                <RevenueBars membershipCents={overview.membershipRevenueCents} purchaseCents={overview.purchaseRevenueCents} />
              </div>
              <TopTitles titles={overview.topTitles} />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { icon: Eye, label: 'Users', value: String(overview.users), sub: `${overview.producers} producers` },
                  { icon: Crown, label: 'Active memberships', value: String(overview.activeMemberships), sub: formatPrice(overview.membershipRevenueCents) + '/mo MRR' },
                  { icon: Check, label: 'Published titles', value: String(overview.published), sub: `${overview.pending} pending review` },
                  { icon: DollarSign, label: 'PPV revenue', value: formatPrice(overview.purchaseRevenueCents), sub: `platform fees ${formatPrice(overview.platformFeesCents)}` },
                  { icon: ShieldCheck, label: 'Producer payouts due', value: formatPrice(overview.producerPayableCents), sub: income ? `${pctText(income.producerShareBps)}% share, unpaid` : 'producer share, unpaid' },
                  { icon: Eye, label: 'Total revenue', value: formatPrice(overview.membershipRevenueCents + overview.purchaseRevenueCents), sub: 'memberships + PPV' },
                ].map((s, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <s.icon className="h-4 w-4 text-emerald-400" />
                    <div className="mt-2 text-xl font-bold">{s.value}</div>
                    <div className="text-xs font-medium">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground">{s.sub}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => (!o ? setRejectTarget(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject “{rejectTarget?.title}”</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason (shown to the producer) *</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Thumbnail resolution too low; audio clipping at 03:20."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={busy !== null || rejectReason.trim().length < 4}>
              {busy === `reject-${rejectTarget?.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject title
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discount dialog */}
      <Dialog open={!!discountTarget} onOpenChange={(o) => (!o ? setDiscountTarget(null) : null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Discount “{discountTarget?.title}”</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="discount-percent">Percent off</Label>
              <Input
                id="discount-percent"
                type="number"
                min={0}
                max={90}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount-days">Days active</Label>
              <Input
                id="discount-days"
                type="number"
                min={1}
                max={90}
                value={discountDays}
                onChange={(e) => setDiscountDays(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Applies immediately across catalog, paywall and checkout. Set 0% to clear it.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscountTarget(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={applyDiscount}
              disabled={busy !== null || Number(discountPercent) < 0 || Number(discountPercent) > 90}
            >
              {busy === `discount-${discountTarget?.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply discount
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
