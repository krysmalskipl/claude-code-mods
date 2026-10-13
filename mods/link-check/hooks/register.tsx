// Link Check: checks the external links Claude adds to pages, posts and templates.
// Only links new in an edit are asked for; each URL once per session. Broken ones go back to Claude with the
// edit's result, so it can fix them, and stay above the prompt until they're gone from the file.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Line, Problem } from '../types'

const CONTENT_FILE = /\.(md|mdx|markdown|astro|html?|tsx|jsx|vue|svelte|php|njk|liquid|twig)$/i
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const WAIT_MS = 6_000 // how long an edit may wait for its links; later answers come as a toast
const FILE_WAIT_MS = 20_000 // /links <file> waits longer: you asked for it
const PER_EDIT = 25 // links checked per edit at most
const PER_FILE = 100
const PARALLEL = 6
const BRAND = '#60a5fa'
const AGENT = 'Mozilla/5.0 (compatible; link-check; +https://github.com/krysmalskipl/claude-code-mods)'
// Hosts that are never real pages: local servers, examples and reserved names.
const SKIP_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|([\w-]+\.)*(example\.(com|org|net)|local|test|invalid|localhost))$/i
const EMPTY: Line = { problems: [], checked: 0 }

type Result = { kind: 'ok' | 'redirect' | 'blocked' | 'broken' | 'unreachable'; status: number | null }

// Held by the host, so the band survives a hot reload of this file.
const line = atom({ plugin: 'link-check', key: 'line' } as const, EMPTY)

const cache = new Map<string, Promise<Result>>() // url → its answer, once per session
let running = 0
const queue: (() => void)[] = []

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command
      .register({ name: 'links', description: 'Broken links Claude added, or check every link in a file', argumentHint: '[file]' })
      .catch(() => {}) // a name Claude Code already has is refused: start anyway
    return result
  })

  on('tool.call', async ($, e, next) => {
    const path = (e as unknown as { file_path?: unknown }).file_path
    if (!EDIT_TOOLS.has(e.tool) || typeof path !== 'string' || !CONTENT_FILE.test(path)) return next(e)
    const before = e.tool === 'Write' ? await $.fs.read(path).then(String, () => '') : ''
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    const added = newLinks(e as unknown as Record<string, unknown>, before).slice(0, PER_EDIT)
    if (added.length === 0) return ran
    const checks = added.map(url => ({ url, answer: check($, url) }))
    const timeUp = $.clock.sleep(WAIT_MS).then(() => null)
    const inTime = await Promise.all(checks.map(c => Promise.race([c.answer, timeUp]).then(r => ({ url: c.url, r }))))
    await refresh($, path, added.length)

    const bad = inTime.filter(x => x.r && isProblem(x.r))
    const late = checks.filter((_, i) => !inTime[i].r)
    if (late.length > 0) void reportLate($, path, late) // in the background: the edit doesn't wait for slow hosts
    if (bad.length === 0) return ran
    const list = bad.map(x => `${x.url} (${label(x.r!)})`).join(', ')
    const note = `link-check: ${bad.length === 1 ? 'a link' : `${bad.length} links`} just added to ${basename(path)} ${bad.length === 1 ? "doesn't" : "don't"} work: ${list}. Fix or remove ${bad.length === 1 ? 'it' : 'them'} if wrong.`
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e)) // a hook that failed never holds up the edit

  on('command.run', { command: 'links' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) {
      const now = await read($, line)
      if (now.problems.length === 0) return { text: `No broken links. ${now.checked} checked this session.` }
      return { text: ['## Links that don\'t work', '', ...now.problems.map(p => `- ${p.url} (${label(p)}) in \`${basename(p.file)}\``)].join('\n') }
    }
    let text: string
    try {
      text = String(await $.fs.read(arg))
    } catch (err) {
      return { text: `Couldn't read ${arg}: ${err instanceof Error ? err.message : String(err)}` }
    }
    const urls = links(text).slice(0, PER_FILE)
    if (urls.length === 0) return { text: `No external links in ${basename(arg)}.` }
    const timeUp = $.clock.sleep(FILE_WAIT_MS).then(() => null)
    const answers = await Promise.all(urls.map(url => Promise.race([check($, url), timeUp]).then(r => ({ url, r }))))
    await refresh($, arg, urls.length)
    const rows = answers.map(({ url, r }) => `- ${r ? icon(r) : '…'} ${url}${r && r.kind !== 'ok' ? ` (${label(r)})` : r ? '' : ' (still waiting)'}`)
    const bad = answers.filter(a => a.r && isProblem(a.r)).length
    return { text: [`## Links in ${basename(arg)}: ${urls.length} checked, ${bad} not working`, '', ...rows].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const now = { ...EMPTY, ...(await read($, line)) }
    if (e.props.hasSurvey || now.problems.length === 0) return rest

    const { Box, Text } = $.ui.resolve(e)
    const first = now.problems[0]
    const n = now.problems.length
    return (
      <Box flexDirection="column">
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            <Text color={BRAND} bold>{'◆ Links  '}</Text>
            <Text color="red" bold>{`${n} not working`}</Text>
            <Text dimColor>{` · ${first.url} (${label(first)}) in ${basename(first.file)}`}</Text>
            {n > 1 && <Text dimColor>{` and ${n - 1} more`}</Text>}
            <Text dimColor>{' · /links'}</Text>
          </Text>
        </Box>
        {rest}
      </Box>
    )
  })
}

// The file's problems are the known-bad links still in it, so a link Claude fixed drops off the band.
async function refresh($: EngineInterface, path: string, checkedNow: number) {
  const text = await $.fs.read(path).then(String, () => '')
  const inFile = new Set(links(text))
  const mine: Problem[] = []
  for (const url of inFile) {
    const r = await settled(url)
    if (r && isProblem(r)) mine.push({ url, file: path, kind: r.kind as Problem['kind'], status: r.status })
  }
  await update($, line, l => ({ checked: l.checked + checkedNow, problems: [...l.problems.filter(p => p.file !== path), ...mine] }))
}

async function reportLate($: EngineInterface, path: string, late: { url: string; answer: Promise<Result> }[]) {
  const answers = await Promise.all(late.map(c => c.answer.then(r => ({ url: c.url, r }))))
  await refresh($, path, 0)
  const bad = answers.filter(a => isProblem(a.r))
  if (bad.length > 0) $.ui.toast(`link-check: ${bad.map(a => `${a.url} (${label(a.r)})`).join(', ')} in ${basename(path)}`)
}

// Links in what the edit wrote that weren't in what it replaced.
export function newLinks(input: Record<string, unknown>, before: string) {
  const pairs: [string, string][] = []
  if (typeof input.content === 'string') pairs.push([input.content, before])
  if (typeof input.new_string === 'string') pairs.push([input.new_string, String(input.old_string ?? '')])
  if (Array.isArray(input.edits)) for (const x of input.edits as Record<string, unknown>[]) pairs.push([String(x.new_string ?? ''), String(x.old_string ?? '')])
  const out = new Set<string>()
  for (const [now, was] of pairs) {
    const old = new Set(links(was))
    for (const url of links(now)) if (!old.has(url)) out.add(url)
  }
  return [...out]
}

// Every external http(s) link in a text, once, without trailing punctuation and template placeholders.
export function links(text: string) {
  const out = new Set<string>()
  for (const m of text.match(/https?:\/\/[^\s<>"'`)\]}|\\]+/g) ?? []) {
    const url = m.replace(/[.,;:!?*_~]+$/, '')
    if (/\$\{|\{\{|\.\.\.|…/.test(url)) continue
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      continue
    }
    if (!host.includes('.') || SKIP_HOST.test(host)) continue
    out.add(url)
  }
  return [...out]
}

// HEAD first; a host that refuses HEAD gets a GET. Each URL is asked once per session.
function check($: EngineInterface, url: string): Promise<Result> {
  let answer = cache.get(url)
  if (!answer) {
    answer = slot(async () => {
      const ask = (method: string) => $.http.fetch(url, { method, headers: { 'user-agent': AGENT } })
      let res = await ask('HEAD').catch(() => null)
      if (!res || [403, 405, 501].includes(res.status)) res = (await ask('GET').catch(() => null)) ?? res
      return classify(res?.status ?? null)
    })
    cache.set(url, answer)
  }
  return answer
}

// An answer that already came, without waiting for one that hasn't.
async function settled(url: string) {
  const answer = cache.get(url)
  if (!answer) return null
  return Promise.race([answer, Promise.resolve(null)])
}

// At most PARALLEL requests at once, so a page with many links doesn't flood anyone.
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>(go => queue.push(go))
  running++
  try {
    return await job()
  } finally {
    running--
    queue.shift()?.()
  }
}

// 401, 403 and 429 are bot walls and rate limits: the page likely works in a browser, so they don't count.
export const classify = (status: number | null): Result =>
  status === null
    ? { kind: 'unreachable', status }
    : status < 300
      ? { kind: 'ok', status }
      : status < 400
        ? { kind: 'redirect', status }
        : [401, 403, 429, 999].includes(status)
          ? { kind: 'blocked', status }
          : { kind: 'broken', status }

const isProblem = (r: Result) => r.kind === 'broken' || r.kind === 'unreachable'
const label = (r: { kind: string; status: number | null }) =>
  r.kind === 'unreachable' ? 'no answer' : r.kind === 'blocked' ? `${r.status}, blocks bots` : String(r.status)
const icon = (r: Result) => (r.kind === 'ok' ? '✓' : r.kind === 'redirect' ? '↪' : r.kind === 'blocked' ? '~' : '✗')
const basename = (p: string) => p.split('/').pop() ?? p
