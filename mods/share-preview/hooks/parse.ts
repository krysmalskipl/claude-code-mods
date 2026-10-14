import type { PageMeta } from '../types'

// Reads the tags a link preview is built from out of a page's source: rendered
// HTML, a template (Astro, Vue, Svelte, JSX with <Head>), a Next.js `metadata`
// export, or Markdown frontmatter. No DOM here, so it is regular expressions
// over the text, which is enough for tags and keeps the mod dependency-free.

/** Files whose source can carry a page's tags. */
export const PREVIEWABLE = /\.(html?|astro|vue|svelte|jsx|tsx|js|ts|mdx?|php|erb|hbs|liquid|njk|twig)$/i

const META_KEYS: Record<string, keyof PageMeta> = {
  description: 'description',
  robots: 'robots',
  'og:title': 'ogTitle',
  'og:description': 'ogDescription',
  'og:image': 'ogImage',
  'og:image:url': 'ogImage',
  'og:image:secure_url': 'ogImage',
  'og:image:alt': 'ogImageAlt',
  'og:url': 'ogUrl',
  'og:site_name': 'siteName',
  'twitter:card': 'twitterCard',
  'twitter:title': 'twitterTitle',
  'twitter:description': 'twitterDescription',
  'twitter:image': 'twitterImage',
  'twitter:image:src': 'twitterImage',
}

type Field = Exclude<keyof PageMeta, 'dynamic'>

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
}

const clean = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim()

/** An attribute value: quoted text, or `{...}` (JSX, Astro, Svelte), text only when it is a plain string literal. */
type AttrValue = { text: string } | { dynamic: true }

function readAttrs(tag: string): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = {}
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]!.toLowerCase()
    if (match[4] !== undefined) {
      const literal = /^\s*(["'`])([^"'`$]*)\1\s*$/.exec(match[4])
      attrs[name] = literal ? { text: literal[2]! } : { dynamic: true }
    } else {
      attrs[name] = { text: match[2] ?? match[3] ?? '' }
    }
  }
  return attrs
}

/** A template's own syntax inside text: `{x}`, `{{ x }}`, `${x}`, `<?= ?>`, `<%= %>`. */
const isTemplated = (text: string) => /\{|\$\{|<\?|<%/.test(text)

function set(meta: PageMeta, field: Field, value: AttrValue | undefined) {
  if (!value || meta[field] !== undefined || meta.dynamic.includes(field)) return
  if ('dynamic' in value || isTemplated(value.text)) {
    meta.dynamic.push(field)
    return
  }
  const text = clean(value.text)
  if (text !== '') meta[field] = text
}

function fromMarkup(source: string, meta: PageMeta) {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)
  if (title) set(meta, 'title', { text: title[1]! })

  for (const match of source.matchAll(/<meta\b([^>]*?)\/?>/gi)) {
    const attrs = readAttrs(match[1]!)
    const key = attrs.property ?? attrs.name
    if (!key || 'dynamic' in key) continue
    const field = META_KEYS[key.text.trim().toLowerCase()]
    if (field) set(meta, field as Field, attrs.content)
  }

  for (const match of source.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = readAttrs(match[1]!)
    if (attrs.rel && 'text' in attrs.rel && attrs.rel.text.toLowerCase() === 'canonical') {
      set(meta, 'canonical', attrs.href)
    }
  }

  const html = /<html\b([^>]*)>/i.exec(source)
  if (html) set(meta, 'lang', readAttrs(html[1]!).lang)
}

/** The text between a `{` and its matching `}`, starting at the brace. */
function block(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{' || source[i] === '[') depth++
    else if (source[i] === '}' || source[i] === ']') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return source.slice(open)
}

/** The block a key opens (`openGraph: {`), or '' when the key is absent. */
function keyBlock(source: string, key: string): string {
  const match = new RegExp(`\\b${key}\\s*:\\s*([\\[{])`).exec(source)
  return match ? block(source, match.index + match[0].length - 1) : ''
}

/** A key's string value in a JS object literal; dynamic when it is a template with `${}` or an expression. */
function keyString(source: string, key: string): AttrValue | undefined {
  const match = new RegExp(`\\b${key}\\s*:\\s*(?:(["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1|([^,}\\n]+))`).exec(source)
  if (!match) return undefined
  if (match[3] !== undefined) return { dynamic: true }
  if (match[1]! === '`' && match[2]!.includes('${')) return { dynamic: true }
  return { text: match[2]!.replace(/\\(.)/g, '$1') }
}

/** The first image URL of an `images:` value: a string, a list of strings or a list of `{ url }`. */
function imagesValue(source: string): AttrValue | undefined {
  const direct = keyString(source, 'images')
  if (direct && 'text' in direct) return direct
  const list = keyBlock(source, 'images')
  if (!list) return direct
  const url = keyString(list, 'url')
  if (url) return url
  const first = /(["'`])([^"'`]+)\1/.exec(list)
  return first ? { text: first[2]! } : { dynamic: true }
}

function fromNextMetadata(source: string, meta: PageMeta) {
  if (/export\s+(async\s+)?function\s+generateMetadata/.test(source)) {
    meta.dynamic.push('title', 'description', 'ogImage')
    return
  }
  const start = /export\s+const\s+metadata\b[^=]*=\s*\{/.exec(source)
  if (!start) return
  const metadata = block(source, start.index + start[0].length - 1)
  const og = keyBlock(metadata, 'openGraph')
  const twitter = keyBlock(metadata, 'twitter')
  // What is left of the top level once the nested groups are taken out.
  const top = [og, twitter, keyBlock(metadata, 'alternates')].reduce(
    (rest, part) => (part ? rest.replace(part, '{}') : rest),
    metadata,
  )

  const titleGroup = keyBlock(top, 'title')
  set(meta, 'title', titleGroup ? (keyString(titleGroup, 'absolute') ?? keyString(titleGroup, 'default')) : keyString(top, 'title'))
  set(meta, 'description', keyString(top, 'description'))
  set(meta, 'canonical', keyString(keyBlock(metadata, 'alternates'), 'canonical'))
  set(meta, 'robots', keyString(top, 'robots'))
  if (og) {
    set(meta, 'ogTitle', keyString(og, 'title'))
    set(meta, 'ogDescription', keyString(og, 'description'))
    set(meta, 'siteName', keyString(og, 'siteName'))
    set(meta, 'ogUrl', keyString(og, 'url'))
    set(meta, 'ogImage', imagesValue(og))
  }
  if (twitter) {
    set(meta, 'twitterCard', keyString(twitter, 'card'))
    set(meta, 'twitterTitle', keyString(twitter, 'title'))
    set(meta, 'twitterDescription', keyString(twitter, 'description'))
    set(meta, 'twitterImage', imagesValue(twitter))
  }
  const base = /metadataBase\s*:\s*new\s+URL\(\s*(["'`])([^"'`]+)\1/.exec(metadata)
  if (base && !meta.ogUrl && !meta.canonical) meta.ogUrl = base[2]
}

const FRONTMATTER_KEYS: Record<string, Field> = {
  title: 'title',
  description: 'description',
  summary: 'description',
  excerpt: 'description',
  image: 'ogImage',
  cover: 'ogImage',
  ogimage: 'ogImage',
  og_image: 'ogImage',
  heroimage: 'ogImage',
  canonical: 'canonical',
  canonicalurl: 'canonical',
  canonical_url: 'canonical',
  lang: 'lang',
}

function fromFrontmatter(source: string, meta: PageMeta) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (!front) return
  for (const line of front[1]!.split(/\r?\n/)) {
    const match = /^([\w-]+)\s*:\s*(.+)$/.exec(line)
    if (!match) continue
    const field = FRONTMATTER_KEYS[match[1]!.toLowerCase()]
    const value = match[2]!.trim().replace(/^(["'])(.*)\1$/, '$2')
    if (field && value !== '' && !value.startsWith('{') && !value.startsWith('[')) set(meta, field, { text: value })
  }
}

/** Every tag the source sets, read in order of trust: markup first, then a Next.js export, then frontmatter. */
export function parseMeta(source: string): PageMeta {
  const meta: PageMeta = { dynamic: [] }
  fromMarkup(source, meta)
  fromNextMetadata(source, meta)
  fromFrontmatter(source, meta)
  // A tag found later as text is no longer only dynamic.
  meta.dynamic = [...new Set(meta.dynamic)].filter(field => meta[field as Field] === undefined)
  return meta
}

/** Whether a source sets anything a preview can show. */
export const hasAnyMeta = (meta: PageMeta) =>
  meta.dynamic.length > 0 || Object.keys(meta).some(key => key !== 'dynamic')
