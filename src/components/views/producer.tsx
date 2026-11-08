'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  myLedger,
  myResources,
  producerIncome,
  saveResource,
  submitResource,
  deleteResourceDraft,
  type ProducerResourceRow,
  type ProducerStats,
  type LedgerRow,
  type ProducerIncomeReport,
} from '@/lib/actions/producer'
import {
  myPlaylists,
  savePlaylist,
  setPlaylistPublished,
  deletePlaylist,
  addPlaylistItem,
  removePlaylistItem,
  movePlaylistItem,
  type ProducerPlaylistRow,
} from '@/lib/actions/playlist'
import { useApp } from '@/components/store'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, ChevronDown, ChevronUp, DollarSign, Eye, Loader2, Plus, Send, ShoppingCart, X } from 'lucide-react'
import type { PricingType, ResourceStatus } from '@/lib/types'
import { formatPrice, GENRES } from '@/lib/types'
import { STATUS_LABEL } from '@/lib/services/moderation'

function StatusChip({ status }: { status: ResourceStatus }) {
  const styles: Record<ResourceStatus, string> = {
    DRAFT: 'bg-zinc-700 text-zinc-200',
    PENDING_REVIEW: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40',
    PUBLISHED: 'bg-emerald-600 text-white',
    REJECTED: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40',
    SUSPENDED: 'bg-red-600 text-white',
  }
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status]}`}>{STATUS_LABEL[status]}</span>
}

// Basis points → display percent (7000 → "70", 7250 → "72.5")
function pctText(bps: number): string {
  const p = bps / 100
  return Number.isInteger(p) ? String(p) : p.toFixed(1)
}

interface FormState {
  id?: string
  title: string
  description: string
  genre: string
  year: string
  youtube: string
  posterUrl: string
  pricingType: PricingType
  price: string
  discount: string
}

const EMPTY_FORM: FormState = {
  title: '', description: '', genre: 'Drama', year: '',
  youtube: '', posterUrl: '', pricingType: 'PPV', price: '2.99', discount: '0',
}

export function ProducerView() {
  const { session, openAuth } = useApp()
  const { toast } = useToast()
  const [rows, setRows] = useState<ProducerResourceRow[] | null>(null)
  const [stats, setStats] = useState<ProducerStats | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [income, setIncome] = useState<ProducerIncomeReport | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [editingPublished, setEditingPublished] = useState(false)

  // Playlists (producer-curated, ordered collections)
  const [playlists, setPlaylists] = useState<ProducerPlaylistRow[] | null>(null)
  const [plFormOpen, setPlFormOpen] = useState(false)
  const [plForm, setPlForm] = useState<{ id?: string; title: string; description: string }>({
    title: '', description: '',
  })
  const [manageId, setManageId] = useState<string | null>(null)
  const [addItemId, setAddItemId] = useState('')
  const [plBusy, setPlBusy] = useState(false)

  const refresh = useCallback(async () => {
    const r = await myResources()
    if (r.ok && r.data) {
      setRows(r.data.rows)
      setStats(r.data.stats)
    }
    const l = await myLedger()
    if (l.ok && l.data) setLedger(l.data)
    const inc = await producerIncome()
    if (inc.ok && inc.data) setIncome(inc.data)
    const pl = await myPlaylists()
    if (pl.ok && pl.data) setPlaylists(pl.data)
  }, [])

  useEffect(() => {
    if (!(session?.role === 'PRODUCER' || session?.role === 'ADMIN')) return
    let alive = true
    void (async () => {
      const [r, l, inc, pl] = await Promise.all([myResources(), myLedger(), producerIncome(), myPlaylists()])
      if (!alive) return
      if (r.ok && r.data) {
        setRows(r.data.rows)
        setStats(r.data.stats)
      }
      if (l.ok && l.data) setLedger(l.data)
      if (inc.ok && inc.data) setIncome(inc.data)
      if (pl.ok && pl.data) setPlaylists(pl.data)
    })()
    return () => {
      alive = false
    }
  }, [session])

  if (!session) {
    return (
      <div className="px-6 py-24 text-center">
        <h1 className="text-xl font-bold">Producer Studio</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with a producer account to manage your titles.</p>
        <Button className="mt-4 bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => openAuth('signin')}>
          Sign in
        </Button>
      </div>
    )
  }

  const openNew = () => {
    setForm(EMPTY_FORM)
    setEditingPublished(false)
    setFormOpen(true)
  }

  const openEdit = (row: ProducerResourceRow) => {
    setForm({
      id: row.id,
      title: row.title,
      description: row.description,
      genre: row.genre,
      year: row.year ? String(row.year) : '',
      youtube: '', // sourceRef never leaves the server; leave blank to keep it
      posterUrl: '',
      pricingType: row.pricingType,
      price: (row.priceCents / 100).toFixed(2),
      discount: String(row.discountPercent),
    })
    setEditingPublished(row.status === 'PUBLISHED')
    setFormOpen(true)
  }

  const submitForm = async (submitForReview: boolean) => {
    setBusy(true)
    const r = await saveResource({
      id: form.id,
      title: form.title,
      description: form.description,
      genre: form.genre,
      year: form.year ? Number(form.year) : null,
      youtube: form.youtube || (form.id ? 'KEEP' : ''), // KEEP → server keeps existing sourceRef on edit
      posterUrl: form.posterUrl,
      pricingType: form.pricingType,
      priceCents: Math.round(Number(form.price) * 100),
      discountPercent: Number(form.discount || '0'),
      submit: submitForReview,
    })
    setBusy(false)
    if (!r.ok) {
      toast({ title: 'Save failed', description: r.error, variant: 'destructive' })
      return
    }
    setFormOpen(false)
    toast({
      title: submitForReview ? 'Submitted for review' : 'Draft saved',
      description: submitForReview
        ? 'The admin will approve or reject it shortly.'
        : 'Finish it later from My Titles.',
    })
    void refresh()
  }

  const doSubmit = async (row: ProducerResourceRow) => {
    const r = await submitResource(row.id)
    if (!r.ok) {
      toast({ title: 'Submit failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Submitted for review' })
    void refresh()
  }

  const doDelete = async (row: ProducerResourceRow) => {
    const r = await deleteResourceDraft(row.id)
    if (!r.ok) {
      toast({ title: 'Delete failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Deleted' })
    void refresh()
  }

  // ── Playlist handlers ──────────────────────────────────────────────
  const openNewPlaylist = () => {
    setPlForm({ title: '', description: '' })
    setPlFormOpen(true)
  }

  const openEditPlaylist = (row: ProducerPlaylistRow) => {
    setPlForm({ id: row.id, title: row.title, description: row.description })
    setPlFormOpen(true)
  }

  const doSavePlaylist = async () => {
    setPlBusy(true)
    const r = await savePlaylist(plForm)
    setPlBusy(false)
    if (!r.ok) {
      toast({ title: 'Save failed', description: r.error, variant: 'destructive' })
      return
    }
    setPlFormOpen(false)
    toast({
      title: plForm.id ? 'Playlist updated' : 'Playlist created',
      description: plForm.id
        ? undefined
        : 'Add published titles, then publish it to the home page.',
    })
    void refresh()
  }

  const doPlaylistPublish = async (row: ProducerPlaylistRow, published: boolean) => {
    setPlBusy(true)
    const r = await setPlaylistPublished(row.id, published)
    setPlBusy(false)
    if (!r.ok) {
      toast({
        title: published ? 'Publish failed' : 'Unpublish failed',
        description: r.error,
        variant: 'destructive',
      })
      return
    }
    toast({
      title: published ? 'Playlist published' : 'Playlist unpublished',
      description: published
        ? 'Viewers see it on the home page now.'
        : 'It is hidden from viewers again.',
    })
    void refresh()
  }

  const doPlaylistDelete = async (row: ProducerPlaylistRow) => {
    setPlBusy(true)
    const r = await deletePlaylist(row.id)
    setPlBusy(false)
    if (!r.ok) {
      toast({ title: 'Delete failed', description: r.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Playlist deleted' })
    void refresh()
  }

  const doAddItem = async () => {
    if (!manageId || !addItemId) return
    setPlBusy(true)
    const r = await addPlaylistItem(manageId, addItemId)
    setPlBusy(false)
    if (!r.ok) {
      toast({ title: 'Add failed', description: r.error, variant: 'destructive' })
      return
    }
    setAddItemId('')
    void refresh()
  }

  const doRemoveItem = async (itemId: string) => {
    setPlBusy(true)
    const r = await removePlaylistItem(itemId)
    setPlBusy(false)
    if (!r.ok) {
      toast({ title: 'Remove failed', description: r.error, variant: 'destructive' })
      return
    }
    void refresh()
  }

  const doMoveItem = async (itemId: string, dir: 'up' | 'down') => {
    setPlBusy(true)
    const r = await movePlaylistItem(itemId, dir)
    setPlBusy(false)
    if (!r.ok) {
      toast({ title: 'Move failed', description: r.error, variant: 'destructive' })
      return
    }
    void refresh()
  }

  if (!rows || !stats || !playlists) {
    return (
      <div className="space-y-4 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  const manageRow = playlists.find((p) => p.id === manageId) ?? null
  const addable = manageRow
    ? rows.filter(
        (r) => r.status === 'PUBLISHED' && !manageRow.items.some((i) => i.resourceId === r.id),
      )
    : []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Producer Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit videos with poster, price and discount — the admin confirms before they go live.
          </p>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 text-white hover:bg-emerald-500">
          <Plus className="mr-1.5 h-4 w-4" /> New title
        </Button>
      </div>

      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Eye, label: 'Views', value: stats.totalViews.toLocaleString() },
          { icon: ShoppingCart, label: 'Purchases', value: stats.totalPurchases.toLocaleString() },
          { icon: DollarSign, label: income ? `Earned (${pctText(income.producerShareBps)}% share)` : 'Earned', value: formatPrice(stats.earnedCents) },
          { icon: Send, label: 'Live / Pending', value: `${stats.publishedCount} / ${stats.pendingCount}` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <s.icon className="h-4 w-4 text-emerald-400" />
            <div className="mt-2 text-xl font-bold">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="titles" className="mt-6">
        <TabsList>
          <TabsTrigger value="titles">My titles ({rows.length})</TabsTrigger>
          <TabsTrigger value="playlists">Playlists ({playlists.length})</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
        </TabsList>

        <TabsContent value="titles" className="mt-4">
          <div className="overflow-hidden rounded-xl border border-white/10">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40%]">Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        { }
                        <img src={row.poster} alt="" className="h-10 w-[72px] shrink-0 rounded bg-zinc-800 object-cover" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{row.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.genre} • {row.pricingType === 'PPV' ? 'Pay-per-view' : row.pricingType === 'MEMBERSHIP' ? 'Members' : 'Free'}
                          </div>
                          {row.status === 'REJECTED' && row.rejectionReason && (
                            <div className="mt-0.5 text-xs text-red-300">Reason: {row.rejectionReason}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><StatusChip status={row.status} /></TableCell>
                    <TableCell>
                      {row.pricingType === 'PPV' ? (
                        row.discountPercent > 0 ? (
                          <span className="text-sm">
                            <span className="mr-1 text-muted-foreground line-through">{formatPrice(row.priceCents)}</span>
                            {formatPrice(row.effectivePriceCents)}
                          </span>
                        ) : (
                          formatPrice(row.priceCents)
                        )
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{row.viewCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        {(row.status === 'DRAFT' || row.status === 'REJECTED') && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => doSubmit(row)}>
                            <Send className="mr-1 h-3 w-3" /> Submit
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        {(row.status === 'DRAFT' || row.status === 'REJECTED') && (
                          <Button size="sm" variant="outline" className="h-7 border-red-500/40 text-xs text-red-300 hover:bg-red-500/10" onClick={() => doDelete(row)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No titles yet — click <span className="font-semibold text-foreground">New title</span> to submit your first video.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="playlists" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Bundle your published titles into ordered playlists — viewers browse them on the home page.
            </p>
            <Button
              size="sm"
              onClick={openNewPlaylist}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <Plus className="mr-1.5 h-4 w-4" /> New playlist
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40%]">Playlist</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {playlists.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="text-sm font-semibold">{row.title}</div>
                      {row.description && (
                        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{row.items.length}</TableCell>
                    <TableCell>
                      {row.status === 'PUBLISHED' ? (
                        <span className="inline-block whitespace-nowrap rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Published</span>
                      ) : (
                        <span className="inline-block whitespace-nowrap rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-200">Draft</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setManageId(row.id)}>
                          Manage
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEditPlaylist(row)}>
                          Edit
                        </Button>
                        {row.status === 'PUBLISHED' ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={plBusy} onClick={() => doPlaylistPublish(row, false)}>
                            Unpublish
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={plBusy} onClick={() => doPlaylistPublish(row, true)}>
                            Publish
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-red-500/40 text-xs text-red-300 hover:bg-red-500/10"
                          disabled={plBusy}
                          onClick={() => doPlaylistDelete(row)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {playlists.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      No playlists yet — group your published titles into a viewing order.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="earnings" className="mt-4 space-y-4">
          {income && income.rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[36%]">Movie</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Gross income</TableHead>
                    <TableHead className="text-right">Your share</TableHead>
                    <TableHead className="text-right">Platform</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {income.rows.map((r) => (
                    <TableRow key={r.resourceId}>
                      <TableCell>
                        <div className="max-w-[280px] truncate text-sm font-semibold">{r.title}</div>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{r.sales}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatPrice(r.grossCents)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums text-emerald-400">
                        {formatPrice(r.earnedCents)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatPrice(r.platformCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{income.totals.sales}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPrice(income.totals.grossCents)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-emerald-400">
                      {formatPrice(income.totals.earnedCents)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-muted-foreground">
                      {formatPrice(income.totals.platformCents)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              <p className="border-t border-white/10 px-4 py-3 text-xs text-muted-foreground">
                Your share is set by the platform (currently {pctText(income.producerShareBps)}%). Each sale keeps the split it was
                sold under — retuning the percentage never changes past entries.
              </p>
            </div>
          )}
          {income && income.rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-muted-foreground">
              No income yet — a summary row appears per movie the moment a viewer buys one of your titles.
            </div>
          )}

          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Transaction history (latest 50)
          </div>
          <div className="rounded-xl border border-white/10">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Title</TableHead>
                  <TableHead>Your share</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{e.title}</TableCell>
                    <TableCell className="text-sm font-semibold text-emerald-400">{formatPrice(e.amountCents)}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === 'PAID' ? 'default' : 'outline'} className="text-xs">
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {ledger.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      No earnings yet — entries appear the moment a viewer buys one of your titles.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* New / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit title' : 'New title'}</DialogTitle>
          </DialogHeader>

          {editingPublished && (
            <Alert className="border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-amber-200">
                This title is live. Saving changes sends it back to the admin for re-approval.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="f-title">Title *</Label>
              <Input id="f-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="The River Remembers" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-yt">YouTube link *</Label>
              <Input id="f-yt" value={form.youtube} onChange={(e) => setForm({ ...form, youtube: e.target.value })} placeholder={form.id ? 'Leave blank to keep the current video' : 'https://www.youtube.com/watch?v=… or video id'} />
              <p className="text-[11px] text-muted-foreground">
                Unlisted videos are recommended. The id is stored server-side and never exposed publicly.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Genre</Label>
                <Select value={form.genre} onValueChange={(v) => setForm({ ...form, genre: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GENRES.map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-year">Year</Label>
                <Input id="f-year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="2024" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label>Access</Label>
                <Select value={form.pricingType} onValueChange={(v) => setForm({ ...form, pricingType: v as PricingType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FREE">Free</SelectItem>
                    <SelectItem value="MEMBERSHIP">Members</SelectItem>
                    <SelectItem value="PPV">Pay-per-view</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-desc">Description</Label>
              <Textarea id="f-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this film about?" />
            </div>
            {form.pricingType === 'PPV' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="f-price">Price (USD) *</Label>
                  <Input id="f-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="f-disc">Discount %</Label>
                  <Input id="f-disc" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} inputMode="numeric" />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="f-poster">Poster URL (optional)</Label>
              <Input id="f-poster" value={form.posterUrl} onChange={(e) => setForm({ ...form, posterUrl: e.target.value })} placeholder="https://…  (blank = use the video thumbnail)" />
            </div>
          </div>

          <DialogFooter className="gap-2">
            {!form.id && (
              <Button variant="outline" onClick={() => submitForm(false)} disabled={busy}>
                Save draft
              </Button>
            )}
            <Button onClick={() => submitForm(true)} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-500">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form.id ? 'Save & send to review' : 'Submit for approval'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Playlist create / edit dialog */}
      <Dialog open={plFormOpen} onOpenChange={setPlFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{plForm.id ? 'Edit playlist' : 'New playlist'}</DialogTitle>
            <DialogDescription>An ordered collection of your published titles.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="p-title">Playlist title *</Label>
              <Input
                id="p-title"
                value={plForm.title}
                onChange={(e) => setPlForm({ ...plForm, title: e.target.value })}
                placeholder="Award-winning shorts"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea
                id="p-desc"
                rows={3}
                value={plForm.description}
                onChange={(e) => setPlForm({ ...plForm, description: e.target.value })}
                placeholder="What ties these titles together?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={doSavePlaylist}
              disabled={plBusy}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {plBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save playlist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage playlist dialog — add / reorder / remove titles */}
      <Dialog open={!!manageId} onOpenChange={(o) => !o && setManageId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage: {manageRow?.title ?? ''}</DialogTitle>
            <DialogDescription>
              Only your published titles can be added. Reorder with the arrows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {manageRow && manageRow.items.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-white/10">
                {manageRow.items.map((it, idx) => (
                  <div
                    key={it.itemId}
                    className={`flex items-center gap-2 p-2 ${idx > 0 ? 'border-t border-white/5' : ''}`}
                  >
                    <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">
                      {idx + 1}
                    </span>
                    <img src={it.poster} alt="" className="h-9 w-16 shrink-0 rounded bg-zinc-800 object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.title}</div>
                      {it.status !== 'PUBLISHED' && (
                        <div className="text-[10px] text-amber-300">
                          back in review — hidden from viewers until re-approved
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        disabled={plBusy || idx === 0}
                        onClick={() => doMoveItem(it.itemId, 'up')}
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        disabled={plBusy || idx === manageRow.items.length - 1}
                        onClick={() => doMoveItem(it.itemId, 'down')}
                        aria-label="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 border-red-500/40 p-0 text-red-300 hover:bg-red-500/10"
                        disabled={plBusy}
                        onClick={() => doRemoveItem(it.itemId)}
                        aria-label="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {manageRow && manageRow.items.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/15 p-6 text-center text-sm text-muted-foreground">
                No titles yet — add one below.
              </div>
            )}
            {manageRow && addable.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={addItemId} onValueChange={setAddItemId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Add a published title…" />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={plBusy || !addItemId}
                  onClick={doAddItem}
                  className="bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Add
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageId(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
