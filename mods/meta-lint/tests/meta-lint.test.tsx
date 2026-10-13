import { describe, expect, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } }

const POST = `---
title: "Mods w Claude Code"
seo_title: "Mods w Claude Code i Desktop: wtyczki JS/TS, MCP i repozytorium"
seo_description: "${'x'.repeat(186)}"
---

Intro paragraph with a few words.

![](assets/one.png)

![A described image](assets/two.png)

\`\`\`bash
# a shell comment, not an H1
\`\`\`
`

const PAGE = `<html><head>
<title>Home</title>
<meta name="description" content="A page about mods that is long enough to land inside the recommended range for a description.">
</head><body><h1>One</h1><h1>Two</h1><img src="a.png"><img src="b.png" alt="B"></body></html>`

// Stands for the engine and the disk beneath the mod.
function engine(on: any, opts: { failing?: string } = {}) {
  const disk: Record<string, string> = {}
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'engine band' }))
  on('tool.call', (_$: any, e: any) => {
    if (e.file_path === opts.failing) return { isError: true, result: 'nope', text: 'nope' }
    if (e.tool === 'Write') disk[e.file_path] = e.content
    if (e.tool === 'Edit') disk[e.file_path] = (disk[e.file_path] ?? '').replace(e.old_string, e.new_string)
    return { result: {}, text: 'ok' }
  })
  on('fs.read', (_$: any, e: any) => {
    if (disk[e.path] === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: disk[e.path] }
  })
  return disk
}

async function band($: any) {
  const out: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'meta-lint', surface, ...BAND })
    const t = await ui.find({ type: 'Text', text: /SEO/ })
    out.push(t ? String(t.text) : '')
    await ui.unmount()
  }
  expect(out[0]).toBe(out[1])
  return out[0]
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const run = ($: any, args = '') => $.command.run({ command: 'meta-lint', args } as any)

describe('meta-lint', () => {
  test('stays hidden until Claude edits a page', async ($, on) => {
    engine(on)
    await start($)
    expect(await band($)).toBe('')
    await $.tool.call({ tool: 'Write', file_path: '/work/src/app.ts', content: 'export const a = 1' } as any)
    expect(await band($)).toBe('')
    expect((await run($)).text).toMatch(/No page edited yet/)
  })

  test('a post: the SEO title wins, a long description is flagged, code comments are no H1', async ($, on) => {
    engine(on)
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/drafts/post.md', content: POST } as any)
    expect(await band($)).toMatch(/post\.md {2}title 63\/60 ✗ · description 186\/160 ✗ · H1 0 ✓ · 1 image without alt · \d+ words/)

    const out = (await run($)).text
    expect(out).toMatch(/Title\*\* \(seo_title\): 63 characters, 3 over 60/)
    expect(out).toMatch(/Description\*\* \(seo_description\): 186 characters, 26 over 160/)
    expect(out).toMatch(/> x{159}…/)
  })

  test('an edit that fixes the description turns it green', async ($, on) => {
    engine(on)
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/post.md', content: POST } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/work/post.md', old_string: 'x'.repeat(186), new_string: 'y'.repeat(150) } as any)
    expect(await band($)).toMatch(/description 150\/160 ✓/)
  })

  test('an HTML page: <title>, meta description, two H1s and an img without alt', async ($, on) => {
    engine(on)
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/index.html', content: PAGE } as any)
    expect(await band($)).toMatch(/title 4\/60 ~ · description 93\/160 ✓ · H1 2 ✗ · 1 image without alt/)
    expect((await run($)).text).toMatch(/H1:\*\* 2, keep one per page/)
  })

  test('/meta-lint <file> checks a file Claude has not touched', async ($, on) => {
    const disk = engine(on)
    disk['/work/about.md'] = '# About me\n\nNo frontmatter here.\n'
    await start($)
    const out = (await run($, '/work/about.md')).text
    expect(out).toMatch(/Title\*\* \(H1\): 8 characters, short/)
    expect(out).toMatch(/Description:\*\* missing/)
    expect(await band($)).toMatch(/about\.md {2}title 8\/60 ~ · description missing ✗ · H1 1 ✓/)
  })

  test('a failed edit and a subagent edit leave the band alone', async ($, on) => {
    engine(on, { failing: '/work/bad.md' })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/bad.md', content: POST } as any)
    await $.tool.call({ tool: 'Write', file_path: '/work/sub.md', content: POST, agentId: 'a1' } as any)
    expect(await band($)).toBe('')
  })
})
