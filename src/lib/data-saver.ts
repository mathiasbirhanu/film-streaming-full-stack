'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Data Saver — one switch for constrained networks & devices ──────
// ON:  low-res posters (?q=m, ~10 KB), no autoplay (poster + tap-to-play),
//      HD hero images suppressed.
// OFF: standard quality (hqdefault), HD hero, autoplay.
// Persisted in localStorage under "sr-datasaver".
interface DataSaverState {
  on: boolean
  toggle: () => boolean
  set: (v: boolean) => void
}

export const useDataSaver = create<DataSaverState>()(
  persist(
    (set, get) => ({
      on: false,
      toggle: () => {
        const next = !get().on
        set({ on: next })
        return next
      },
      set: (v) => set({ on: v }),
    }),
    { name: 'sr-datasaver' },
  ),
)
