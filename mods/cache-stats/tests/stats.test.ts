import { describe, expect, test } from 'claude-code/testing'

import { addRequest, emptySession, fmtDuration, fmtLeft, fmtTokens, hitRate, report, summarize } from '../hooks/stats'

const MIN = 60_000
const usage = (read: number, created: number, input = 0) => ({ model: 'claude-opus-5-5', input, read, created, output: 500 })

describe('hit rate', () => {
  test('is the share of the prompt the cache served', async () => {
    expect(hitRate({ input: 100, read: 900, created: 0 })).toBe(0.9)
    expect(hitRate({ input: 0, read: 0, created: 0 })).toBeNull()
  })
})

describe('addRequest', () => {
  test('sums the session and keeps the first request as its start', async () => {
    let s = addRequest(emptySession(), usage(0, 100_000), 1000, '5m')
    s = addRequest(s, usage(100_000, 2000), 1000 + MIN, '5m')
    expect(s.startedAt).toBe(1000)
    expect(s.total).toEqual({ requests: 2, input: 0, read: 100_000, created: 102_000, output: 1000 })
    expect(s.misses).toEqual([])
  })

  test('the first request is never a miss, nor is a small prompt', async () => {
    let s = addRequest(emptySession(), usage(0, 80_000), 0, '5m')
    expect(s.misses).toEqual([])
    s = addRequest(s, usage(0, 800), MIN, '5m')
    expect(s.misses).toEqual([])
  })

  test('a miss after the cache lived out is expired, one soon after is changed', async () => {
    let s = addRequest(emptySession(), usage(0, 90_000), 0, '5m')
    s = addRequest(s, usage(0, 90_000), 7 * MIN, '5m')
    s = addRequest(s, usage(0, 95_000), 8 * MIN, '5m')
    expect(s.misses.map(m => m.reason)).toEqual(['expired', 'changed'])
    expect(s.misses[0]?.gapMs).toBe(7 * MIN)
    // The same 7 minutes is still warm on a 1h cache: the prompt changed.
    let long = addRequest(emptySession(), usage(0, 90_000), 0, '1h')
    long = addRequest(long, usage(0, 90_000), 7 * MIN, '1h')
    expect(long.misses[0]?.reason).toBe('changed')
  })

  test('keeps only the latest requests and misses', async () => {
    let s = emptySession()
    for (let i = 0; i < 80; i++) s = addRequest(s, usage(0, 20_000), i * MIN, '5m')
    expect(s.recent).toHaveLength(20)
    expect(s.misses).toHaveLength(50)
    expect(s.total.requests).toBe(80)
  })
})

describe('summarize', () => {
  test('counts down while warm and goes cold at the lifetime', async () => {
    const s = addRequest(emptySession(), usage(60_000, 40_000), 0, '5m')
    expect(summarize(s, 2 * MIN, '5m')).toMatchObject({ isWarm: true, leftMs: 3 * MIN, cached: 100_000, lastHit: 0.6 })
    expect(summarize(s, 5 * MIN, '5m')).toMatchObject({ isWarm: false, leftMs: 0 })
    expect(summarize(s, 5 * MIN, '1h').isWarm).toBe(true)
  })

  test('has nothing to say before the first request', async () => {
    expect(summarize(emptySession(), 0, '5m')).toMatchObject({ leftMs: null, isWarm: false, lastHit: null })
  })
})

describe('formatting', () => {
  test('tokens, durations and the countdown', async () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(142_300)).toBe('142k')
    expect(fmtTokens(4_100_000)).toBe('4.1M')
    expect(fmtDuration(45_000)).toBe('45s')
    expect(fmtDuration(23 * MIN)).toBe('23m')
    expect(fmtDuration(72 * MIN)).toBe('1h 12m')
    expect(fmtLeft(30_000)).toBe('30s')
    expect(fmtLeft(3 * MIN + 1)).toBe('4m')
  })
})

describe('report', () => {
  test('says why each miss happened', async () => {
    let s = addRequest(emptySession(), usage(0, 90_000), 0, '5m')
    s = addRequest(s, usage(0, 90_000), 9 * MIN, '5m')
    const text = report(s, 20 * MIN, '5m')
    expect(text).toContain('Cache is cold')
    expect(text).toContain('idle 9m, longer than the 5m the cache lives')
    expect(report(emptySession(), 0, '5m')).toContain('No requests yet')
  })
})
