import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Poster variant helpers (server proxies YouTube ids) ────────────
// m      → mqdefault 320×180 (~10 KB) — Data Saver
// (none) → hqdefault 480×360 — cards / rows
// hd     → maxres → sd → hq ladder — hero / watch backdrop
export function thumbLow(id: string): string {
  return `/api/thumb/${id}?q=m`
}
export function thumbUrl(id: string): string {
  return `/api/thumb/${id}`
}
export function thumbHD(id: string): string {
  return `/api/thumb/${id}?q=hd`
}
