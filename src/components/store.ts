'use client'

import { create } from 'zustand'
import type { MembershipSummary, SessionUser } from '@/lib/types'

export type View = 'home' | 'watch' | 'playlist' | 'membership' | 'library' | 'producer' | 'admin'

interface AppState {
  view: View
  watchId: string | null
  playlistId: string | null
  session: SessionUser | null
  membership: MembershipSummary | null
  authOpen: boolean
  authTab: 'signin' | 'register'
  authRedirectWatch: string | null
  go: (v: View) => void
  openWatch: (resourceId: string) => void
  openPlaylist: (playlistId: string) => void
  setSession: (user: SessionUser | null, membership: MembershipSummary | null) => void
  openAuth: (tab?: 'signin' | 'register', redirectWatch?: string | null) => void
  closeAuth: () => void
}

export const useApp = create<AppState>((set) => ({
  view: 'home',
  watchId: null,
  playlistId: null,
  session: null,
  membership: null,
  authOpen: false,
  authTab: 'signin',
  authRedirectWatch: null,
  go: (v) => set({ view: v, watchId: null, playlistId: null }),
  openWatch: (resourceId) => set({ view: 'watch', watchId: resourceId, playlistId: null }),
  openPlaylist: (playlistId) => set({ view: 'playlist', playlistId, watchId: null }),
  setSession: (user, membership) => set({ session: user, membership }),
  openAuth: (tab = 'signin', redirectWatch = null) =>
    set({ authOpen: true, authTab: tab, authRedirectWatch: redirectWatch }),
  closeAuth: () => set({ authOpen: false, authRedirectWatch: null }),
}))

// Debug handle (dev only): window.__sr lets tooling inspect app state.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__sr = useApp
}
