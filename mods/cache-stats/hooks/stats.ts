import type { CacheMiss, CacheRequest, CacheSession } from '../types'

// The numbers behind the band and /cache. Pure: no engine, so it is tested alone.

/** A prompt smaller than this is not worth calling a miss over. */
const MISS_FLOOR_TOKENS = 5000
/** Below this share of the prompt served from cache, a request counts as a miss. */
const MISS_BELOW = 0.5
const KEEP_RECENT = 20
const KEEP_MISSES = 50

export const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const
export type Ttl = keyof typeof TTL_MS

export const emptySession = (): CacheSession => ({
  startedAt: null,
  workMs: 0,
  turns: 0,
  total: { requests: 0, input: 0, read: 0, created: 0, output: 0 },
  recent: [],
  misses: [],
  lastAt: null,
})

/** The prompt a request sent: everything it read, wrote or sent uncached. */
export const promptTokens = (r: Pick<CacheRequest, 'input' | 'read' | 'created'>) => r.input + r.read + r.created

/** The share of the prompt the cache served, 0 to 1; null for an empty prompt. */
export function hitRate(r: Pick<CacheRequest, 'input' | 'read' | 'created'>): number | null {
  const prompt = promptTokens(r)
  return prompt === 0 ? null : r.read / prompt
}

type Usage = { model: string; input: number; read: number; created: number; output: number }

/** The session after one more request. A miss is a big prompt the cache mostly did not serve. */
export function addRequest(session: CacheSession, usage: Usage, now: number, ttl: Ttl): CacheSession {
  const gapMs = session.lastAt === null ? null : Math.max(0, now - session.lastAt)
  const request: CacheRequest = { at: now, gapMs, ...usage }
  const hit = hitRate(request)
  const isMiss = gapMs !== null && hit !== null && hit < MISS_BELOW && promptTokens(request) >= MISS_FLOOR_TOKENS
  const miss: CacheMiss[] = isMiss
    ? [{ at: now, hit: hit ?? 0, created: usage.created, gapMs, reason: gapMs > TTL_MS[ttl] ? 'expired' : 'changed' }]
    : []
  return {
    ...session,
    startedAt: session.startedAt ?? now,
    lastAt: now,
    total: {
      requests: session.total.requests + 1,
      input: session.total.input + usage.input,
      read: session.total.read + usage.read,
      created: session.total.created + usage.created,
      output: session.total.output + usage.output,
    },
    recent: [...session.recent, request].slice(-KEEP_RECENT),
    misses: [...session.misses, ...miss].slice(-KEEP_MISSES),
  }
}

export type Summary = {
  /** The last request's hit rate and the session's. */
  lastHit: number | null
  sessionHit: number | null
  /** Tokens in the cache now: what the last request's prompt held. */
  cached: number
  /** Milliseconds left before the cache lapses; 0 once it has. null before the first request. */
  leftMs: number | null
  isWarm: boolean
  sessionMs: number
}

export function summarize(session: CacheSession, now: number, ttl: Ttl): Summary {
  const last = session.recent[session.recent.length - 1]
  const all = session.total.input + session.total.read + session.total.created
  const leftMs = session.lastAt === null ? null : Math.max(0, session.lastAt + TTL_MS[ttl] - now)
  return {
    lastHit: last ? hitRate(last) : null,
    sessionHit: all === 0 ? null : session.total.read / all,
    cached: last ? promptTokens(last) : 0,
    leftMs,
    isWarm: leftMs !== null && leftMs > 0,
    sessionMs: session.startedAt === null ? 0 : Math.max(0, now - session.startedAt),
  }
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** The time left on a warm cache: seconds under a minute, minutes after. */
export const fmtLeft = (ms: number) => (ms < 60_000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60_000)}m`)

export const fmtPercent = (share: number | null) => (share === null ? '-' : `${Math.round(share * 100)}%`)

export function fmtClock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** A bar of `width` cells filled to `share`. */
export function bar(share: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The /cache text: what the cache is doing now, how the session went, and every miss with its cause. */
export function report(session: CacheSession, now: number, ttl: Ttl): string {
  if (session.total.requests === 0) return 'No requests yet: the numbers start with the next reply.'
  const s = summarize(session, now, ttl)
  const t = session.total
  const lines: string[] = []

  lines.push(
    s.isWarm
      ? `Cache is warm: about ${fmtLeft(s.leftMs ?? 0)} left (${ttl} lifetime), holding ${fmtTokens(s.cached)} tokens.`
      : `Cache is cold (${ttl} lifetime): the next message re-caches about ${fmtTokens(s.cached)} tokens.`,
  )
  lines.push(
    `Session: ${fmtDuration(s.sessionMs)}, ${fmtDuration(session.workMs)} of it the model working, ${session.turns} turns, ${t.requests} requests.`,
  )
  lines.push(
    `Hit rate: ${fmtPercent(s.sessionHit)} of the session (last request ${fmtPercent(s.lastHit)}). ` +
      `${fmtTokens(t.read)} tokens read from cache, ${fmtTokens(t.created)} written, ${fmtTokens(t.input)} sent uncached, ${fmtTokens(t.output)} generated.`,
  )

  if (session.misses.length === 0) {
    lines.push('Misses: none. Every large request was served from the cache.')
  } else {
    lines.push(`Misses (${session.misses.length}), a large prompt that mostly missed the cache:`)
    for (const m of session.misses.slice(-8)) {
      const why =
        m.reason === 'expired'
          ? `idle ${fmtDuration(m.gapMs ?? 0)}, longer than the ${ttl} the cache lives`
          : `only ${fmtDuration(m.gapMs ?? 0)} after the last request, so the prompt or model changed (/model, /compact, an edited CLAUDE.md or a new MCP tool)`
      lines.push(`  ${fmtClock(m.at)}  hit ${fmtPercent(m.hit)}, re-cached ${fmtTokens(m.created)}: ${why}`)
    }
  }

  lines.push('Last requests:')
  for (const r of session.recent.slice(-8)) {
    lines.push(
      `  ${fmtClock(r.at)}  ${fmtPercent(hitRate(r)).padStart(4)} hit  read ${fmtTokens(r.read).padStart(5)}  wrote ${fmtTokens(r.created).padStart(5)}  new ${fmtTokens(r.input).padStart(5)}  out ${fmtTokens(r.output).padStart(5)}  ${r.model}`,
    )
  }
  lines.push('Subagents have caches of their own and are not counted here.')
  return lines.join('\n')
}
