import { describe, expect, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } }
const wait = (ms: number) => new Promise(done => (globalThis as any).setTimeout(done, ms))

// Stands for the engine, the disk and the web beneath the mod. `status` maps a URL to its answer;
// null is a host that never answers, a missing URL answers 200.
function engine(on: any, opts: { status?: Record<string, number | null>; slow?: string[]; headRefused?: boolean } = {}) {
  const disk: Record<string, string> = {}
  const asked: string[] = []
  const toasts: string[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'engine band' }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('clock.sleep', async (_$: any, e: any) => {
    await wait(Math.min(e.ms, 60)) // the edit's wait, shortened
    return { value: undefined }
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'Write') disk[e.file_path] = e.content
    if (e.tool === 'Edit') disk[e.file_path] = (disk[e.file_path] ?? '').replace(e.old_string, e.new_string)
    return { result: {}, text: 'ok' }
  })
  on('fs.read', (_$: any, e: any) => {
    if (disk[e.path] === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: disk[e.path] }
  })
  on('http.fetch', async (_$: any, e: any) => {
    const method = e.init?.method ?? 'GET'
    asked.push(`${method} ${e.url}`)
    if (opts.slow?.includes(e.url)) await wait(150)
    if (method === 'HEAD' && opts.headRefused) return { value: { status: 405, ok: false, headers: {}, text: '' } }
    const status = opts.status && e.url in opts.status ? opts.status[e.url] : 200
    if (status === null) throw new Error('ECONNREFUSED')
    return { value: { status, ok: status < 300, headers: {}, text: '' } }
  })
  return { disk, asked, toasts }
}

async function band($: any) {
  const out: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'link-check', surface, ...BAND })
    const t = await ui.find({ type: 'Text', text: /Links/ })
    out.push(t ? String(t.text) : '')
    await ui.unmount()
  }
  expect(out[0]).toBe(out[1])
  return out[0]
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const run = ($: any, args = '') => $.command.run({ command: 'links', args } as any)
const POST = 'See [docs](https://docs.good.dev/start), [old](https://gone.dev/page) and https://down.dev.\n'

describe('link-check', () => {
  test('tells Claude which new links are broken, and shows them above the prompt', async ($, on) => {
    engine(on, { status: { 'https://gone.dev/page': 404, 'https://down.dev': null } })
    await start($)
    const r: any = await $.tool.call({ tool: 'Write', file_path: '/work/post.md', content: POST } as any)
    expect(r.context?.[0]).toMatch(/2 links just added to post\.md don't work: https:\/\/gone\.dev\/page \(404\), https:\/\/down\.dev \(no answer\)/)
    expect(await band($)).toMatch(/Links {2}2 not working · https:\/\/gone\.dev\/page \(404\) in post\.md and 1 more · \/links/)
    expect((await run($)).text).toMatch(/- https:\/\/down\.dev \(no answer\) in `post\.md`/)
  })

  test('a link Claude fixes drops off the band', async ($, on) => {
    engine(on, { status: { 'https://gone.dev/page': 404 } })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/post.md', content: POST } as any)
    const r: any = await $.tool.call({ tool: 'Edit', file_path: '/work/post.md', old_string: 'https://gone.dev/page', new_string: 'https://docs.good.dev/moved' } as any)
    expect(r.context).toBeUndefined()
    expect(await band($)).toBe('')
  })

  test('only new links are asked for, each once; local and example hosts never', async ($, on) => {
    const h = engine(on)
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/a.md', content: 'https://x.dev/a http://localhost:3000 https://example.com/x https://${host}/p' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.md', old_string: 'https://x.dev/a', new_string: 'https://x.dev/a https://y.dev/b' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/work/b.md', content: 'https://y.dev/b' } as any)
    expect(h.asked).toEqual(['HEAD https://x.dev/a', 'HEAD https://y.dev/b'])
  })

  test('a host that refuses HEAD gets a GET; a bot wall is not a broken link', async ($, on) => {
    const h = engine(on, { headRefused: true, status: { 'https://walled.dev/p': 403 } })
    await start($)
    const r: any = await $.tool.call({ tool: 'Write', file_path: '/work/c.html', content: '<a href="https://walled.dev/p">x</a>' } as any)
    expect(h.asked).toEqual(['HEAD https://walled.dev/p', 'GET https://walled.dev/p'])
    expect(r.context).toBeUndefined()
  })

  test('a slow host does not hold up the edit: its answer comes as a toast', async ($, on) => {
    const h = engine(on, { slow: ['https://slow.dev/x'], status: { 'https://slow.dev/x': 500 } })
    await start($)
    const r: any = await $.tool.call({ tool: 'Write', file_path: '/work/d.md', content: 'https://slow.dev/x' } as any)
    expect(r.context).toBeUndefined()
    await wait(200)
    expect(h.toasts[0]).toMatch(/https:\/\/slow\.dev\/x \(500\) in d\.md/)
    expect(await band($)).toMatch(/1 not working/)
  })

  test('/links <file> checks every link in it', async ($, on) => {
    const h = engine(on, { status: { 'https://gone.dev/page': 410 } })
    h.disk['/work/old.md'] = POST
    await start($)
    const out = (await run($, '/work/old.md')).text
    expect(out).toMatch(/3 checked, 1 not working/)
    expect(out).toMatch(/- ✗ https:\/\/gone\.dev\/page \(410\)/)
    expect(out).toMatch(/- ✓ https:\/\/down\.dev$/)
  })

  test('ignores files that are not pages, posts or templates', async ($, on) => {
    const h = engine(on)
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/notes.txt', content: 'https://x.dev' } as any)
    expect(h.asked).toEqual([])
  })
})
