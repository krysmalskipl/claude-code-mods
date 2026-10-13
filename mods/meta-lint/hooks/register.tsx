// Meta Lint: the SEO basics of the page or post Claude just edited, in a band above the prompt.
// Reads Markdown, MDX, Astro and HTML files after each Write or Edit. Nothing leaves your machine.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report } from '../types'

const CONTENT_FILE = /\.(md|mdx|markdown|astro|html?)$/i
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const TITLE_MAX = 60 // characters Google usually shows before cutting the title
const TITLE_MIN = 30
const DESC_MAX = 160 // and the description
const DESC_MIN = 70
const BRAND = '#4ade80'
// Frontmatter keys, most specific first: an SEO title wins over the post's title.
const TITLE_KEYS = ['seo_title', 'seoTitle', 'meta_title', 'metaTitle', 'title']
const DESC_KEYS = ['seo_description', 'seoDescription', 'meta_description', 'metaDescription', 'description', 'excerpt']

// Held by the host, so the band survives a hot reload of this file.
const last = atom({ plugin: 'meta-lint', key: 'last' } as const, null as Report | null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command
      .register({ name: 'meta-lint', description: 'SEO basics of the last edited page, or of a file you name', argumentHint: '[file]' })
      .catch(() => {}) // a name Claude Code already has is refused: start anyway
    return result
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = (e as unknown as { file_path?: unknown }).file_path
    if (!EDIT_TOOLS.has(e.tool) || e.agentId || typeof path !== 'string' || !CONTENT_FILE.test(path)) return ran
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const report = lint(path, String(await $.fs.read(path)))
      await update($, last, () => report)
    } catch {
      // a file that can't be read leaves the band as it was
    }
    return ran
  }).catch(($, e, next) => next(e)) // a hook that failed never holds up the edit

  on('command.run', { command: 'meta-lint' }, async ($, e) => {
    const arg = e.args.trim()
    try {
      const report = arg ? lint(arg, String(await $.fs.read(arg))) : await read($, last)
      if (!report) return { text: 'No page edited yet. Run `/meta-lint <file>` to check one.' }
      if (arg) await update($, last, () => report)
      return { text: detail(report) }
    } catch (err) {
      return { text: `Couldn't read ${arg}: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const r = await read($, last)
    if (e.props.hasSurvey || !r) return rest

    const { Box, Text } = $.ui.resolve(e)
    const isWide = e.props.bodyColumns >= 80
    const sep = <Text dimColor>{' · '}</Text>
    const t = titleTone(r)
    const d = descTone(r)
    const h1Bad = r.h1 > 1 || (r.h1 === 0 && !r.hasTitleField)

    return (
      <Box flexDirection="column">
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            <Text color={BRAND} bold>{'◆ SEO  '}</Text>
            {isWide && <Text dimColor>{`${basename(r.file)}  `}</Text>}
            <Text dimColor>{'title '}</Text>
            <Text color={t}>{r.title ? `${len(r.title.text)}/${TITLE_MAX} ${mark(t)}` : 'missing ✗'}</Text>
            {sep}
            <Text dimColor>{'description '}</Text>
            <Text color={d}>{r.description ? `${len(r.description.text)}/${DESC_MAX} ${mark(d)}` : 'missing ✗'}</Text>
            {sep}
            <Text dimColor>{'H1 '}</Text>
            <Text color={h1Bad ? 'red' : 'green'}>{`${r.h1} ${h1Bad ? '✗' : '✓'}`}</Text>
            {r.noAlt > 0 && sep}
            {r.noAlt > 0 && <Text color="red">{`${r.noAlt} ${r.noAlt === 1 ? 'image' : 'images'} without alt`}</Text>}
            {isWide && sep}
            {isWide && <Text dimColor>{`${r.words.toLocaleString('en-US')} words`}</Text>}
          </Text>
        </Box>
        {rest}
      </Box>
    )
  })
}

// Everything the band and /meta-lint show, from a file's text. Pure, so the tests can feed it anything.
export function lint(file: string, text: string): Report {
  const { fields, body } = frontmatter(text)
  const html = /\.(astro|html?)$/i.test(file) ? text : body
  const titleKey = TITLE_KEYS.find(k => fields[k])
  const descKey = DESC_KEYS.find(k => fields[k])
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const descTag = metaDescription(html)
  const prose = stripCode(body)
  const mdH1 = prose.split('\n').filter(l => /^#\s+\S/.test(l))
  const tagH1 = prose.match(/<h1\b/gi) ?? []
  return {
    file,
    title: titleKey
      ? { text: fields[titleKey], from: titleKey }
      : titleTag?.trim()
        ? { text: clean(titleTag), from: '<title>' }
        : mdH1[0]
          ? { text: mdH1[0].replace(/^#\s+/, '').trim(), from: 'H1' }
          : null,
    description: descKey ? { text: fields[descKey], from: descKey } : descTag ? { text: descTag, from: 'meta description' } : null,
    h1: mdH1.length + tagH1.length,
    hasTitleField: fields.title !== undefined,
    noAlt: (prose.match(/!\[\s*\]\(/g) ?? []).length + (prose.match(/<img\b[^>]*>/gi) ?? []).filter(tag => !/\balt\s*=\s*(["'])\s*[^"'\s]/i.test(tag)).length,
    words: words(prose),
  }
}

function detail(r: Report) {
  const lines = [`## SEO basics: ${basename(r.file)}`, '']
  const t = r.title
  const d = r.description
  lines.push(
    t ? `- **Title** (${t.from}): ${len(t.text)} characters, ${advice(len(t.text), TITLE_MIN, TITLE_MAX)}` : '- **Title:** missing',
    d ? `- **Description** (${d.from}): ${len(d.text)} characters, ${advice(len(d.text), DESC_MIN, DESC_MAX)}` : '- **Description:** missing',
    `- **H1:** ${r.h1}${r.h1 > 1 ? ', keep one per page' : r.h1 === 0 ? (r.hasTitleField ? ' in the body (the frontmatter title is usually the H1)' : ', add one') : ''}`,
    `- **Images without alt:** ${r.noAlt}`,
    `- **Words:** ${r.words.toLocaleString('en-US')}`,
  )
  if (t || d) {
    lines.push('', '**Search snippet preview** (cut by characters; Google cuts by width, so treat it as a guide)', '')
    if (t) lines.push(`> **${cut(t.text, TITLE_MAX)}**`)
    if (t && d) lines.push('>')
    if (d) lines.push(`> ${cut(d.text, DESC_MAX)}`)
  }
  return lines.join('\n')
}

// `key: value` lines between the first two `---` lines. Enough for titles and descriptions; lists are skipped.
function frontmatter(text: string) {
  const fields: Record<string, string> = {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { fields, body: text }
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv || !kv[2]) continue
    const value = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2').trim()
    if (value) fields[kv[1]] = value
  }
  return { fields, body: text.slice(m[0].length) }
}

function metaDescription(html: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']description["']/i.test(tag)) continue
    const content = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2]
    if (content?.trim()) return clean(content)
  }
  return null
}

// Fenced and inline code don't count as prose: a `# comment` in a shell block is no H1.
const stripCode = (s: string) => s.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
const words = (s: string) =>
  (s.replace(/<[^>]+>/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const len = (s: string) => [...s].length
const cut = (s: string, max: number) => (len(s) > max ? `${[...s].slice(0, max - 1).join('').trimEnd()}…` : s)
const basename = (p: string) => p.split('/').pop() ?? p
const tone = (n: number, min: number, max: number) => (n > max ? 'red' : n < min ? 'yellow' : 'green')
const titleTone = (r: Report) => (r.title ? tone(len(r.title.text), TITLE_MIN, TITLE_MAX) : 'red')
const descTone = (r: Report) => (r.description ? tone(len(r.description.text), DESC_MIN, DESC_MAX) : 'red')
const mark = (t: string) => (t === 'green' ? '✓' : t === 'yellow' ? '~' : '✗')
const advice = (n: number, min: number, max: number) =>
  n > max ? `${n - max} over ${max}, Google will likely cut it` : n < min ? `short, there's room up to ${max}` : `fits (${min} to ${max})`
