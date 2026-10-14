import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { addRequest, bar, emptySession, fmtDuration, fmtLeft, fmtPercent, fmtTokens, report, summarize } from './stats'
import type { Ttl } from './stats'

const session = atom({ plugin: 'cache-stats', key: 'session' } as const, emptySession())
const tick = atom({ plugin: 'cache-stats', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'cache-stats', key: 'isHidden' } as const, false)

// How often the countdown redraws. Fine enough for minutes, cheap enough to leave on.
const TICK_MS = 15_000
const USAGE = 'Usage: /cache [hide|show]'

type Segment = { text: string; color?: string }

export const register: Register = (on, options) => {
  const ttl: Ttl = options.ttl === '5m' ? '5m' : '1h'

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'cache',
        description: 'Prompt cache: time left, hit rate, misses and why, session time',
        argumentHint: '[hide|show]',
      })
      .catch(() => {}) // a name Claude Code already has is refused: the band still works
    const now = await $.clock.now()
    await update($, session, s => ({ ...s, startedAt: s.startedAt ?? now }))
    $.clock.every(TICK_MS, () => void update($, tick, n => n + 1).catch(() => {}))
    return next(e)
  })

  // One stop chunk per request to the model, with that request's own usage.
  // Subagents run on caches of their own, so only the main loop is counted.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    for await (const chunk of stream) {
      if (chunk.kind === 'stop' && chunk.usage && !e.agentId) {
        const u = chunk.usage
        const now = await $.clock.now()
        await update($, session, s =>
          addRequest(
            s,
            { model: u.model, input: u.input_tokens, read: u.cache_read_input_tokens, created: u.cache_creation_input_tokens, output: u.output_tokens },
            now,
            ttl,
          ),
        ).catch(() => {})
      }
      yield chunk
    }
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, session, s => ({ ...s, turns: s.turns + 1, workMs: s.workMs + e.durationMs })).catch(() => {})
    }
    return next(e)
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'hide') {
      await update($, isHidden, () => true)
      return { text: 'Cache line hidden. /cache show brings it back.' }
    }
    if (word === 'show') {
      await update($, isHidden, () => false)
      return { text: 'Cache line shown.' }
    }
    if (word !== '') return { text: USAGE }
    return { text: report(await read($, session), await $.clock.now(), ttl) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, session)
    await read($, tick) // subscribes the band to the timer
    if (e.props.hasSurvey || data.total.requests === 0 || (await read($, isHidden))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const s = summarize(data, now, ttl)
    const tone = (hit: number | null) => (hit === null ? 'inactive' : hit >= 0.8 ? 'success' : hit >= 0.5 ? 'warning' : 'error')

    const segments: Segment[] = [
      { text: `${bar(s.lastHit ?? 0)} ${fmtPercent(s.lastHit)} hit`, color: tone(s.lastHit) },
      s.isWarm
        ? { text: `warm ${fmtLeft(s.leftMs ?? 0)}`, color: (s.leftMs ?? 0) < 60_000 ? 'warning' : 'success' }
        : { text: `cold, next message re-caches ${fmtTokens(s.cached)}`, color: 'error' },
      { text: `session ${fmtDuration(s.sessionMs)} (${fmtDuration(data.workMs)} working)` },
      { text: `avg ${fmtPercent(s.sessionHit)}`, color: 'inactive' },
      { text: `${data.total.requests} requests`, color: 'inactive' },
    ]
    if (s.isWarm) segments.splice(2, 0, { text: `${fmtTokens(s.cached)} cached`, color: 'inactive' })

    // Drop the least important segments from the end until the line fits.
    const room = Math.max(20, (e.props.bodyColumns ?? 100) - 10)
    const shown = [...segments]
    const width = () => shown.reduce((sum, seg) => sum + seg.text.length + 3, 0)
    while (shown.length > 2 && width() > room) shown.pop()

    return (
      <Box>
        <Text color="claude">◆ Cache </Text>
        {shown.map((seg, i) => (
          <Text color={seg.color}>
            {i > 0 ? ' · ' : ''}
            {seg.text}
          </Text>
        ))}
      </Box>
    )
  })
}
