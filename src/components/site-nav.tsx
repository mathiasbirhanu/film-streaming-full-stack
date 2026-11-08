'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, LogOut, ShieldCheck, SignalLow, SignalHigh, Sparkles, UserSquare2 } from 'lucide-react'
import { logout } from '@/lib/actions/auth'
import { myNotifications, markAllRead, type NotificationItem } from '@/lib/actions/engage'
import { useDataSaver } from '@/lib/data-saver'
import { StreamRootsLogo } from '@/components/logo'
import { useApp } from '@/components/store'
import { useToast } from '@/hooks/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatPrice, MEMBERSHIP_PRICE_CENTS } from '@/lib/types'

export function SiteNav() {
  const { view, go, session, membership, openAuth, openWatch } = useApp()
  const { toast } = useToast()
  const saver = useDataSaver((s) => s.on)
  const toggleSaver = useDataSaver((s) => s.toggle)
  const [bellOpen, setBellOpen] = useState(false)
  const [notes, setNotes] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)

  const loadNotes = useCallback(async () => {
    if (!session) return
    const r = await myNotifications()
    setNotes(r.items)
    setUnread(r.unread)
  }, [session])

  useEffect(() => {
    void loadNotes()
    const t = setInterval(() => void loadNotes(), 60000)
    return () => clearInterval(t)
  }, [loadNotes])

  const openBell = async () => {
    setBellOpen(true)
    await loadNotes()
    if (unread > 0) {
      await markAllRead()
      setUnread(0)
    }
  }

  const toggleDataSaver = () => {
    const next = toggleSaver()
    toast({
      title: next ? 'Data saver on' : 'Data saver off',
      description: next
        ? 'Low-res posters, no autoplay — built for slow networks.'
        : 'Standard quality restored.',
    })
  }

  const handleLogout = async () => {
    await logout()
    useApp.getState().setSession(null, null)
    go('home')
    toast({ title: 'Signed out' })
  }

  const navBtn = (label: string, target: typeof view, active: boolean) => (
    <button
      key={target}
      onClick={() => go(target)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <button onClick={() => go('home')} aria-label="Home" className="shrink-0">
          <StreamRootsLogo />
        </button>
        <nav className="ml-2 flex items-center gap-0.5 overflow-x-auto" aria-label="Primary">
          {navBtn('Home', 'home', view === 'home')}
          {session && navBtn('Library', 'library', view === 'library')}
          {navBtn('Membership', 'membership', view === 'membership')}
          {session?.role === 'PRODUCER' &&
            navBtn('Producer Studio', 'producer', view === 'producer')}
          {session?.role === 'ADMIN' && navBtn('Admin', 'admin', view === 'admin')}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleDataSaver}
            aria-pressed={saver}
            title={saver ? 'Data saver is ON — low-res posters, no autoplay' : 'Enable Data Saver for slow networks'}
            className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition ${
              saver
                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                : 'border-white/15 text-muted-foreground hover:text-foreground'
            }`}
          >
            {saver ? <SignalLow className="h-4 w-4" /> : <SignalHigh className="h-4 w-4" />}
            <span className="hidden sm:inline">Data saver</span>
          </button>

          {session && (
            <Popover open={bellOpen} onOpenChange={(o) => (o ? void openBell() : setBellOpen(false))}>
              <PopoverTrigger asChild>
                <button
                  className="relative flex h-9 w-9 items-center justify-center rounded-md border border-white/15 text-muted-foreground transition hover:text-foreground"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Notifications
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notes.length === 0 && (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                      Nothing yet — discount campaigns and platform news land here.
                    </div>
                  )}
                  {notes.map((n) => (
                    <button
                      key={n.id}
                      className={`block w-full border-b border-white/5 px-3 py-2.5 text-left transition hover:bg-white/5 ${
                        n.resourceId ? 'cursor-pointer' : 'cursor-default'
                      }`}
                      onClick={() => {
                        setBellOpen(false)
                        if (n.resourceId) openWatch(n.resourceId)
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold leading-snug">{n.title}</div>
                        {n.readAt === null && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground/70">
                        {new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {!session ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => openAuth('signin')}>
                Sign in
              </Button>
              <Button size="sm" onClick={() => go('membership')} className="bg-emerald-600 text-white hover:bg-emerald-500">
                Join Premium
              </Button>
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600/90 text-sm font-bold text-white transition hover:bg-emerald-500"
                  aria-label="Account menu"
                >
                  {session.name.slice(0, 1).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{session.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{session.email}</div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {session.role}
                    </Badge>
                    {membership?.active ? (
                      <Badge className="bg-emerald-600 text-[10px] text-white">
                        <Sparkles className="mr-1 h-2.5 w-2.5" /> Premium
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        Free
                      </Badge>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => go('library')}>
                  <UserSquare2 className="mr-2 h-4 w-4" /> My library
                </DropdownMenuItem>
                {!membership?.active && session.role === 'VIEWER' && (
                  <DropdownMenuItem onClick={() => go('membership')}>
                    <Sparkles className="mr-2 h-4 w-4" /> Get Premium — {formatPrice(MEMBERSHIP_PRICE_CENTS)}/mo
                  </DropdownMenuItem>
                )}
                {session.role === 'ADMIN' && (
                  <DropdownMenuItem onClick={() => go('admin')}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Admin console
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
}
