'use client'

import { useEffect } from 'react'
import { me } from '@/lib/actions/auth'
import { useApp } from '@/components/store'
import { SiteNav } from '@/components/site-nav'
import { AuthDialog } from '@/components/auth-dialog'
import { StreamRootsLogo } from '@/components/logo'
import { HomeView } from '@/components/views/home'
import { WatchView } from '@/components/views/watch'
import { PlaylistView } from '@/components/views/playlist'
import { MembershipView } from '@/components/views/membership'
import { LibraryView } from '@/components/views/library'
import { ProducerView } from '@/components/views/producer'
import { AdminView } from '@/components/views/admin'

// Client application shell. page.tsx stays a server component so it can
// export generateMetadata (OG/Twitter cards) while this tree is fully
// interactive.
export function AppShell() {
  const view = useApp((s) => s.view)

  useEffect(() => {
    void me().then(({ user, membership }) => useApp.getState().setSession(user, membership))
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-foreground">
      <SiteNav />

      <main className="flex-1">
        {view === 'home' && <HomeView />}
        {view === 'watch' && <WatchView />}
        {view === 'playlist' && <PlaylistView />}
        {view === 'membership' && <MembershipView />}
        {view === 'library' && <LibraryView />}
        {view === 'producer' && <ProducerView />}
        {view === 'admin' && <AdminView />}
      </main>

      <footer className="mt-auto border-t border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-5 sm:flex-row sm:items-center sm:px-6">
          <StreamRootsLogo />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            All playback is per-user watermarked and licensed to the signed-in account •
            telebirr / CBE Birr / Chapa / card (demo charges) • © {new Date().getFullYear()} StreamRoots
          </p>
        </div>
      </footer>

      <AuthDialog />
    </div>
  )
}
