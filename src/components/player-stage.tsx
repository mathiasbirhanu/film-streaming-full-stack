'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { saveProgress } from '@/lib/actions/playback'
import { thumbHD } from '@/lib/utils'

// ── YouTube IFrame API loader (singleton) ─────────────────────────────
let ytApiPromise: Promise<any> | null = null
function loadYTApi(): Promise<any> {
  const w = window as unknown as { YT?: any; onYouTubeIframeAPIReady?: () => void }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const prev = w.onYouTubeIframeAPIReady
      w.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(w.YT!)
      }
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      document.head.appendChild(tag)
    })
  }
  return ytApiPromise
}

function extractVideoId(embedUrl: string): string {
  const m = embedUrl.match(/\/embed\/([A-Za-z0-9_-]{11})/)
  return m ? m[1] : ''
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const GHOST_POSITIONS = [
  { top: '62%', left: '55%' },
  { top: '30%', left: '70%' },
  { top: '72%', left: '12%' },
  { top: '18%', left: '38%' },
  { top: '48%', left: '80%' },
  { top: '76%', left: '45%' },
]

interface Props {
  resourceId: string
  embedUrl: string
  watermark: { name: string; shortId: string; email: string; licenseRef: string }
  saver?: boolean
}

// The hardened playback stage:
//  • embed URL is delivered post-entitlement (never in public payloads)
//  • company logo top-left, per-user forensic watermark top-right
//  • drifting ghost watermark + licensed-to bar (screenshot-traceable)
//  • custom controls (controls=0) so the player chrome is ours, not YouTube's
//  • OPAQUE top/bottom chrome bars — YouTube dropped modestbranding support,
//    so the "Watch on YouTube" badge is physically covered by our chrome
//  • tamper watchdog re-mounts the watermark if it is removed via devtools
//  • Data Saver: no autoplay — poster + tap-to-play instead
//  • 15s watch-time beacons power Continue Watching + producer analytics
export function PlayerStage({ resourceId, embedUrl, watermark: wm, saver = false }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const watermarkRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef(0)
  const durationRef = useRef(0)
  const playingRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(70)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ghostPos, setGhostPos] = useState(0)
  const [wmEpoch, setWmEpoch] = useState(0) // re-mounts watermark nodes

  const persist = useCallback(() => {
    if (!playingRef.current && currentRef.current === 0) return
    void saveProgress(resourceId, currentRef.current, durationRef.current)
  }, [resourceId])

  // Player lifecycle
  useEffect(() => {
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    let beacon: ReturnType<typeof setInterval> | null = null
    const mount = document.createElement('div')
    mount.className = 'absolute inset-0'
    stageRef.current?.appendChild(mount)

    loadYTApi().then((YT) => {
      if (cancelled) return
      playerRef.current = new YT.Player(mount, {
        videoId: extractVideoId(embedUrl),
        width: '100%',
        height: '100%',        playerVars: {
          autoplay: saver ? 0 : 1,
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          fs: 0,
        },
        events: {
          onReady: (e: any) => {
            if (cancelled) return
            e.target.setVolume(volume)
            if (!saver) e.target.playVideo()
            setReady(true)
            poll = setInterval(() => {
              if (!playerRef.current?.getCurrentTime) return
              const t = playerRef.current.getCurrentTime() ?? 0
              const d = playerRef.current.getDuration() ?? 0
              currentRef.current = t
              durationRef.current = d
              setCurrent(t)
              setDuration(d)
            }, 500)
            beacon = setInterval(persist, 15000)
          },
          onStateChange: (e: any) => {
            if (cancelled) return
            const state = e.data // 1 playing, 2 paused, 0 ended
            playingRef.current = state === 1
            setPlaying(state === 1)
            if (state === 2 || state === 0) persist()
          },
        },
      })
    })

    const saveOnExit = () => persist()
    window.addEventListener('beforeunload', saveOnExit)
    return () => {
      cancelled = true
      window.removeEventListener('beforeunload', saveOnExit)
      if (poll) clearInterval(poll)
      if (beacon) clearInterval(beacon)
      persist()
      try {
        playerRef.current?.destroy?.()
      } catch {
        /* noop */
      }
      mount.remove()
    }
     
  }, [resourceId])

  // Ghost watermark drift — every 25s it relocates, defeating crops.
  useEffect(() => {
    const t = setInterval(() => setGhostPos((p) => (p + 1) % GHOST_POSITIONS.length), 25000)
    return () => clearInterval(t)
  }, [])

  // Watermark re-render + tamper watchdog: if the node is deleted from the
  // DOM via devtools, bump the epoch so React re-mounts it.
  useEffect(() => {
    const t = setInterval(() => {
      setWmEpoch((e) => e + 1)
      if (!watermarkRef.current?.isConnected) setWmEpoch((e) => e + 1)
    }, 30000)
    const watchdog = setInterval(() => {
      if (!watermarkRef.current?.isConnected) setWmEpoch((e) => e + 1)
    }, 4000)
    return () => {
      clearInterval(t)
      clearInterval(watchdog)
    }
  }, [])

  const togglePlay = () => {
    const p = playerRef.current
    if (!p) return
    if (playingRef.current) {
      p.pauseVideo()
    } else {
      p.playVideo()
    }
  }
  const seek = (v: number) => playerRef.current?.seekTo(v, true)
  const toggleMute = () => {
    const p = playerRef.current
    if (!p) return
    if (muted) {
      p.unMute()
      p.setVolume(volume)
      setMuted(false)
    } else {
      p.mute()
      setMuted(true)
    }
  }
  const changeVolume = (v: number) => {
    setVolume(v)
    playerRef.current?.setVolume(v)
    if (v > 0 && muted) {
      playerRef.current?.unMute()
      setMuted(false)
    }
  }
  const fullscreen = () => {
    stageRef.current?.parentElement?.requestFullscreen?.()
  }

  const ghost = GHOST_POSITIONS[ghostPos]

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* YT iframe mounts here */}
      <div ref={stageRef} className="absolute inset-0" />

      {/* legibility gradients */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-black/70 to-transparent" />

      {/* Data Saver poster — no autoplay on constrained networks */}
      {saver && !playing && (
        <img
          src={thumbHD(resourceId)}
          alt=""
          className="pointer-events-none absolute inset-0 z-[12] h-full w-full object-cover"
        />
      )}

      {/* company logo — top-left */}
      <div className="pointer-events-none absolute left-3 top-2.5 z-20 flex items-center gap-2 opacity-90">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-400 to-teal-600">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
            <path d="M6 4l14 8-14 8z" />
          </svg>
        </div>
        <span className="text-sm font-bold tracking-tight text-white drop-shadow">
          Stream<span className="text-emerald-400">Roots</span>
        </span>
      </div>

      {/* per-user forensic watermark — top-right (re-mounted by watchdog) */}
      <div
        key={wmEpoch}
        ref={watermarkRef}
        className="pointer-events-none absolute right-3 top-2.5 z-20 select-none text-right"
      >
        <div
          className="text-[13px] font-semibold text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
        >
          {wm.name}
        </div>
        <div className="text-[9px] font-medium uppercase tracking-widest text-white/55">
          ID {wm.shortId} • {wm.licenseRef} •{' '}
          {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>

      {/* drifting ghost watermark */}
      <div
        className="pointer-events-none absolute z-10 select-none text-[10px] font-medium tracking-wide text-white/30 transition-all duration-1000"
        style={{ top: ghost.top, left: ghost.left, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
      >
        Licensed to {wm.name} • {wm.licenseRef}
      </div>

      {/* center play button when autoplay is blocked */}
      {ready && !playing && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 transition hover:bg-black/10"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/95 shadow-xl">
            <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-white">
              <path d="M6 4l14 8-14 8z" />
            </svg>
          </span>
        </button>
      )}

      {/* licensed-to strip + custom controls (OPAQUE — physically covers
          YouTube's "Watch on YouTube" badge; modestbranding is dead) */}
      <div className="absolute inset-x-0 bottom-0 z-30">
        <div className="flex items-center justify-between bg-black px-3 py-1 text-[10px] text-white/60">
          <span>
            Licensed to <span className="font-semibold text-white/80">{wm.name}</span> ({wm.email}) • {wm.licenseRef}
          </span>
          <span>Copying, recording or sharing this stream is prohibited</span>
        </div>
        <div className="flex items-center gap-2 bg-gradient-to-t from-black via-black to-black/90 px-3 pb-2 pt-1.5">
          <button
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-white transition hover:bg-white/15"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M7 4l13 8-13 8z" /></svg>
            )}
          </button>
          <span className="w-10 text-right text-[11px] tabular-nums text-white/80">{fmt(current)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-white/25 accent-emerald-400 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400"
          />
          <span className="w-10 text-[11px] tabular-nums text-white/80">{fmt(duration)}</span>
          <button
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-white transition hover:bg-white/15"
          >
            {muted || volume === 0 ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M4 9v6h4l5 4V5L8 9H4zm12.6 3l2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4L13.8 12l-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4L16.6 12z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M4 9v6h4l5 4V5L8 9H4zm12 3a4 4 0 00-2-3.46v6.92A4 4 0 0016 12zm-2-7.6v2.1a6 6 0 010 11v2.1a8 8 0 000-15.2z" /></svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
            className="hidden h-1 w-16 cursor-pointer appearance-none rounded bg-white/25 sm:block [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
          <button
            onClick={fullscreen}
            aria-label="Fullscreen"
            className="flex h-8 w-8 items-center justify-center rounded-md text-white transition hover:bg-white/15"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
