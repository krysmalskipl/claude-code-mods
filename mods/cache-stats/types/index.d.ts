/** One request to the model, as the API reported its usage. */
export type CacheRequest = {
  at: number
  model: string
  /** Prompt tokens neither read from nor written to the cache. */
  input: number
  /** Prompt tokens the cache served. */
  read: number
  /** Prompt tokens written to the cache. */
  created: number
  output: number
  /** Time since the previous request, null for the first. */
  gapMs: number | null
}

/** A request that should have hit the cache and mostly did not. */
export type CacheMiss = {
  at: number
  /** Share of the prompt the cache served, 0 to 1. */
  hit: number
  /** Tokens written to the cache again. */
  created: number
  gapMs: number | null
  /** `expired`: idle longer than the cache lives. `changed`: the prompt or model changed under it. */
  reason: 'expired' | 'changed'
}

export type CacheSession = {
  startedAt: number | null
  /** Time the model spent on turns, summed. */
  workMs: number
  turns: number
  total: { requests: number; input: number; read: number; created: number; output: number }
  recent: CacheRequest[]
  misses: CacheMiss[]
  lastAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-stats': {
      session: CacheSession
      tick: number
      isHidden: boolean
    }
  }
}
