import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ImageCheck, PageMeta, Preview, PreviewSource } from '../types'
import { cardValues, checkMeta } from './checks'
import type { Level } from './checks'
import { GOOGLE, SOCIAL, cutToChars, cutToWidth } from './measure'
import { PREVIEWABLE, hasAnyMeta, parseMeta } from './parse'

const PANE = 'share-preview'
const preview = atom({ plugin: 'share-preview', key: 'preview' } as const, null)
const lastFile = atom({ plugin: 'share-preview', key: 'lastFile' } as const, null)
const tab = atom({ plugin: 'share-preview', key: 'tab' } as const, 'google')

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const PUBLIC_DIRS = ['public', 'static', 'assets', '.']

const USAGE = [
  'Usage: /preview [url | file]',
  '  /preview                       the page Claude edited last',
  '  /preview src/app/page.tsx      a page, template or Markdown file',
  '  /preview localhost:3000/about  the rendered page (most accurate)',
  '  /preview https://example.com   a live page',
].join('\n')

const isUrlLike = (target: string) => /^(https?:\/\/|localhost\b|127\.0\.0\.1\b|\[::1\])/i.test(target)

function hostAndPath(url: string | undefined): { host?: string; path?: string } {
  if (!url) return {}
  try {
    const parsed = new URL(url.startsWith('//') ? `https:${url}` : url)
    return { host: parsed.host, path: parsed.pathname === '/' ? '' : parsed.pathname }
  } catch {
    return {}
  }
}

async function checkRemoteImage($: EngineInterface, url: string): Promise<ImageCheck> {
  try {
    let response = await $.http.fetch(url, { method: 'HEAD' })
    if (response.status === 405 || response.status === 403) response = await $.http.fetch(url)
    if (!response.ok) return { status: 'broken', note: `og:image answers HTTP ${response.status}: shares show no picture` }
    const type = response.headers['content-type'] ?? ''
    if (type && !type.startsWith('image/')) return { status: 'broken', note: `og:image is ${type.split(';')[0]}, not an image` }
    const bytes = Number(response.headers['content-length'] ?? 0)
    if (bytes > 5_000_000) return { status: 'broken', note: `og:image is ${(bytes / 1e6).toFixed(1)} MB: X and LinkedIn skip images over 5 MB` }
    return { status: 'ok', note: `og:image loads${type ? ` (${type.split(';')[0]}${bytes ? `, ${Math.round(bytes / 1000)} kB` : ''})` : ''}` }
  } catch {
    return { status: 'unchecked', note: 'Could not reach the og:image to check it' }
  }
}

async function checkImage($: EngineInterface, meta: PageMeta, source: PreviewSource): Promise<ImageCheck> {
  const image = cardValues(meta).image
  if (!image) return { status: 'missing', note: '' }
  if (/^https?:\/\//i.test(image)) return checkRemoteImage($, image)
  if (image.startsWith('//')) return checkRemoteImage($, `https:${image}`)
  if (source.kind === 'url') return checkRemoteImage($, new URL(image, source.target).href)
  // A relative image in a source file: look for it where frameworks serve static files from.
  const relative = image.replace(/^\.?\//, '')
  for (const dir of PUBLIC_DIRS) {
    const path = dir === '.' ? relative : `${dir}/${relative}`
    if (await $.fs.exists(path).catch(() => false)) return { status: 'unchecked', note: `og:image file found at ${path}` }
  }
  return { status: 'broken', note: `og:image "${image}" is not in ${PUBLIC_DIRS.filter(d => d !== '.').join('/, ')}/ or the project root` }
}

async function load($: EngineInterface, raw: string): Promise<Preview> {
  const at = await $.clock.now()
  const isUrl = isUrlLike(raw)
  const source: PreviewSource = {
    kind: isUrl ? 'url' : 'file',
    target: isUrl && !/^https?:\/\//i.test(raw) ? `http://${raw}` : raw,
  }
  let text: string
  try {
    if (source.kind === 'url') {
      const response = await $.http.fetch(source.target, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; share-preview; +https://github.com/krysmalskipl/claude-code-mods)' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      text = response.text
    } else {
      text = await $.fs.read(source.target)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { source, meta: { dynamic: [] }, image: { status: 'unchecked', note: '' }, hasHtml: false, error: `Could not read ${source.target}: ${reason}`, at }
  }

  const meta = parseMeta(text)
  if (source.kind === 'url') {
    // Relative tags resolve against the page, as a crawler resolves them.
    for (const key of ['ogImage', 'twitterImage', 'canonical', 'ogUrl'] as const) {
      const value = meta[key]
      if (value && !/^https?:\/\//i.test(value)) {
        try {
          meta[key] = new URL(value, source.target).href
        } catch {}
      }
    }
  }
  const image = await checkImage($, meta, source)
  const where = hostAndPath(meta.canonical ?? meta.ogUrl ?? (source.kind === 'url' ? source.target : undefined))
  const empty = hasAnyMeta(meta) ? undefined : `No title, meta or Open Graph tags in ${source.target}`
  return { source, meta, image, ...where, hasHtml: source.kind === 'url' || /<html\b/i.test(text), error: empty, at }
}

async function show($: EngineInterface, target: string) {
  const result = await load($, target)
  await update($, preview, () => result)
  return result
}

const ICON: Record<Level, string> = { error: '✗', warn: '!', info: '·', ok: '✓' }
const TONE: Record<Level, string> = { error: 'error', warn: 'warning', info: 'inactive', ok: 'success' }
// Google's own result colors, readable on light and dark themes alike.
const LINK = '#4c8bf5'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'preview',
      description: 'Preview the page in Google and as a shared link on X, LinkedIn, Slack and Facebook',
      argumentHint: '[url | file]',
    })
    return next(e)
  })

  on('command.run', { command: 'preview' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'help') return { text: USAGE }
    const target = arg || (await read($, lastFile))
    if (!target) return { text: `Nothing to preview yet: no page was edited in this session.\n${USAGE}` }
    const result = await show($, target)
    await $.ui.open({ id: PANE, title: 'Share preview', focus: true })
    if (result.error) return { text: result.error }
    const issues = checkMeta(result.meta, result.image, result.hasHtml)
    const errors = issues.filter(issue => issue.level === 'error').length
    const warnings = issues.filter(issue => issue.level === 'warn').length
    return {
      text: `Share preview of ${target}: ${errors} errors, ${warnings} warnings.`,
      context: [
        `share-preview found in ${target}:\n${issues
          .filter(issue => issue.level !== 'ok')
          .map(issue => `- [${issue.level}] ${issue.text}`)
          .join('\n')}`,
      ],
    }
  })

  // Follow the page as Claude works on it: remember the last page edited, and
  // refresh an open preview of that file, or of a dev server, after the edit.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!EDIT_TOOLS.has(String(e.tool)) || ran.isError) return ran
    const input = e as { file_path?: string; notebook_path?: string }
    const path = input.file_path ?? input.notebook_path
    if (!path || !PREVIEWABLE.test(path)) return ran
    await update($, lastFile, () => path)
    const current = await read($, preview)
    if (current && current.source.kind === 'file' && current.source.target === path) await show($, path)
    return ran
  }).catch(($, e, next) => next(e)) // never let a preview refresh get in the way of a tool

  on('turn.complete', async ($, e, next) => {
    const current = await read($, preview)
    if (current?.source.kind === 'url' && /\/\/(localhost|127\.|\[::1\])/.test(current.source.target)) {
      await show($, current.source.target)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, preview)
    const view = await read($, tab)
    const width = Math.max(30, Math.min(e.props.bodyColumns ?? 80, 100))

    if (!current) return <Text dimColor>{USAGE}</Text>
    if (current.error && !hasAnyMeta(current.meta)) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">{current.error}</Text>
          <Text dimColor>{USAGE}</Text>
        </Box>
      )
    }

    const { meta } = current
    const card = cardValues(meta)
    const host = current.host ?? 'your-site.com'
    const crumbs = [host, ...(current.path ?? '').split('/').filter(Boolean)].join(' › ')
    const site = meta.siteName ?? host.replace(/^www\./, '')
    const issues = checkMeta(meta, current.image, current.hasHtml)
    const placeholder = (field: string, fallback: string) => (meta.dynamic.includes(field) ? `{${field} set in code}` : fallback)

    const title = meta.title ?? placeholder('title', 'Untitled page')
    const desktopTitle = cutToWidth(title, GOOGLE.titleFont, GOOGLE.titlePx)
    const description = meta.description ?? placeholder('description', 'Google picks a sentence from the page when there is no meta description.')
    const desktopDesc = cutToWidth(description, GOOGLE.descFont, GOOGLE.descPxDesktop)
    const mobileDesc = cutToWidth(description, GOOGLE.descFont, GOOGLE.descPxMobile)

    const tabs = (
      <Box gap={1}>
        <Button key="google" hotkey="g" variant={view === 'google' ? 'primary' : 'secondary'} label="Google" onPress={() => update($, tab, () => 'google')} />
        <Button key="social" hotkey="s" variant={view === 'social' ? 'primary' : 'secondary'} label="Shared link" onPress={() => update($, tab, () => 'social')} />
        <Button key="refresh" hotkey="r" label="Refresh" onPress={() => show($, current.source.target)} />
      </Box>
    )

    const google = (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>DESKTOP</Text>
        <Box flexDirection="column" width={width - 2}>
          <Text bold>{site}</Text>
          <Text dimColor wrap="truncate-end">{crumbs}</Text>
          <Text color={LINK}>{desktopTitle.text}</Text>
          <Text>{desktopDesc.text}</Text>
        </Box>
        <Text dimColor>MOBILE</Text>
        <Box flexDirection="column" width={Math.min(width - 2, 46)} borderStyle="round" borderDimColor paddingX={1}>
          <Text bold>{site}</Text>
          <Text dimColor wrap="truncate-end">{crumbs}</Text>
          <Text color={LINK}>{title}</Text>
          <Text>{mobileDesc.text}</Text>
        </Box>
      </Box>
    )

    const shareTitle = cutToChars(card.title ?? title, SOCIAL.titleChars).text
    const shareDesc = card.description ? cutToChars(card.description, SOCIAL.descChars).text : undefined
    const imageLine = card.image
      ? current.image.status === 'broken'
        ? '[ image fails to load ]'
        : `[ ${card.image.split('/').pop()} ]`
      : '[ no image ]'
    const isLarge = card.xCard === 'summary_large_image'

    const social = (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>LINKEDIN · FACEBOOK</Text>
        <Box flexDirection="column" width={Math.min(width - 2, 60)} borderStyle="round" borderDimColor>
          <Box height={3} justifyContent="center" alignItems="center">
            <Text dimColor>{imageLine}</Text>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            <Text dimColor>{site.toUpperCase()}</Text>
            <Text bold>{shareTitle}</Text>
          </Box>
        </Box>
        <Text dimColor>SLACK</Text>
        <Box flexDirection="column" width={Math.min(width - 2, 60)} borderStyle="bold" borderDimColor paddingLeft={1}>
          <Text bold>{site}</Text>
          <Text color={LINK}>{shareTitle}</Text>
          {shareDesc && <Text>{shareDesc}</Text>}
          <Text dimColor>{imageLine}</Text>
        </Box>
        <Text dimColor>X {isLarge ? '(large card)' : card.xCard ? '(small card)' : '(no card: plain link)'}</Text>
        {card.xCard ? (
          <Box flexDirection={isLarge ? 'column' : 'row'} width={Math.min(width - 2, 60)} borderStyle="round" borderDimColor>
            <Box height={isLarge ? 3 : 2} width={isLarge ? undefined : 14} justifyContent="center" alignItems="center">
              <Text dimColor>{imageLine}</Text>
            </Box>
            <Box flexDirection="column" paddingX={1}>
              <Text dimColor>{host}</Text>
              <Text>{cutToChars(card.xTitle ?? title, SOCIAL.titleChars).text}</Text>
            </Box>
          </Box>
        ) : (
          <Text color={LINK}>{`https://${host}${current.path ?? ''}`}</Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        <Text dimColor wrap="truncate-middle">
          {current.source.kind === 'url' ? 'Rendered page' : 'Source'}: {current.source.target}
        </Text>
        {view === 'google' ? google : social}
        <Box flexDirection="column">
          {issues.map(issue => (
            <Text color={TONE[issue.level]}>
              {ICON[issue.level]} {issue.text}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
