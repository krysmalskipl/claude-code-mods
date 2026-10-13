// One external link that didn't answer as it should.
export type Problem = {
  url: string
  file: string // the file it's in, as Claude edited it
  kind: 'broken' | 'unreachable' // 4xx/5xx, or no answer at all
  status: number | null
}

// What the band above the prompt draws.
export type Line = {
  problems: Problem[] // links still in their files that don't work
  checked: number // links checked this session
}

declare module 'claude-code' {
  interface PluginState {
    'link-check': { line: Line }
  }
}
