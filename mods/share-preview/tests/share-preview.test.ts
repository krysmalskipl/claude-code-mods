import { describe, expect, test } from 'claude-code/testing'

import { checkMeta } from '../hooks/checks'
import { GOOGLE, cutToWidth, textWidth } from '../hooks/measure'
import { parseMeta } from '../hooks/parse'

const unchecked = { status: 'unchecked', note: '' } as const

describe('parseMeta', () => {
  test('reads HTML tags in any attribute order, entities decoded', async () => {
    const meta = parseMeta(`<html lang="en"><head>
      <title>Tom &amp; Jerry | Cartoons</title>
      <meta content="Classic chases." name="description">
      <meta property="og:image" content="https://cdn.example.com/og.png" />
      <meta name="twitter:card" content='summary_large_image'>
      <link href="https://example.com/tom" rel="canonical">
    </head></html>`)
    expect(meta.title).toBe('Tom & Jerry | Cartoons')
    expect(meta.description).toBe('Classic chases.')
    expect(meta.ogImage).toBe('https://cdn.example.com/og.png')
    expect(meta.twitterCard).toBe('summary_large_image')
    expect(meta.canonical).toBe('https://example.com/tom')
    expect(meta.lang).toBe('en')
    expect(meta.dynamic).toEqual([])
  })

  test('marks JSX expressions as dynamic and keeps string literals', async () => {
    const meta = parseMeta(`<Head><title>{post.title}</title><meta name="description" content={"Static text"} /><meta property="og:image" content={post.cover} /></Head>`)
    expect(meta.title).toBeUndefined()
    expect(meta.description).toBe('Static text')
    expect(meta.dynamic).toContain('title')
    expect(meta.dynamic).toContain('ogImage')
  })

  test('reads a Next.js metadata export', async () => {
    const meta = parseMeta(`
      export const metadata: Metadata = {
        metadataBase: new URL('https://acme.dev'),
        title: { default: 'Acme - fast invoices', template: '%s | Acme' },
        description: "Send invoices in 10 seconds.",
        alternates: { canonical: 'https://acme.dev/' },
        openGraph: { title: 'Acme', images: [{ url: '/og.png', width: 1200 }] },
        twitter: { card: 'summary_large_image' },
      }`)
    expect(meta.title).toBe('Acme - fast invoices')
    expect(meta.description).toBe('Send invoices in 10 seconds.')
    expect(meta.canonical).toBe('https://acme.dev/')
    expect(meta.ogTitle).toBe('Acme')
    expect(meta.ogImage).toBe('/og.png')
    expect(meta.twitterCard).toBe('summary_large_image')
  })

  test('treats generateMetadata as set in code', async () => {
    const meta = parseMeta('export async function generateMetadata({ params }) { return {} }')
    expect(meta.dynamic).toContain('title')
  })

  test('reads Markdown frontmatter', async () => {
    const meta = parseMeta('---\ntitle: "Hello world"\ndescription: A first post\ncover: /images/hello.png\n---\n# Hello')
    expect(meta.title).toBe('Hello world')
    expect(meta.description).toBe('A first post')
    expect(meta.ogImage).toBe('/images/hello.png')
  })
})

describe('measure', () => {
  test('measures by glyph, so wide letters run out sooner', async () => {
    expect(textWidth('WWWW', 20)).toBeGreaterThan(textWidth('iiii', 20) * 3)
    expect(textWidth('ą', 20)).toBe(textWidth('a', 20))
  })

  test('cuts a long title at a word with " ..."', async () => {
    const long = 'The complete guide to technical SEO for JavaScript frameworks in 2026 and beyond'
    const cut = cutToWidth(long, GOOGLE.titleFont, GOOGLE.titlePx)
    expect(cut.isCut).toBe(true)
    expect(cut.text.endsWith(' ...')).toBe(true)
    expect(textWidth(cut.text, GOOGLE.titleFont)).toBeLessThanOrEqual(GOOGLE.titlePx)
    expect(cutToWidth('Short title', GOOGLE.titleFont, GOOGLE.titlePx).isCut).toBe(false)
  })
})

describe('checkMeta', () => {
  test('flags what costs clicks', async () => {
    const levels = (html: string) => checkMeta(parseMeta(html), unchecked).map(issue => `${issue.level} ${issue.text}`)
    const bare = levels('<html><head></head></html>')
    expect(bare.some(line => line.startsWith('error No <title>'))).toBe(true)
    expect(bare.some(line => line.startsWith('error No og:image'))).toBe(true)

    const risky = levels(`<html lang="en"><title>A perfectly reasonable page title</title>
      <meta name="robots" content="noindex"><meta property="og:image" content="/og.png">
      <link rel="canonical" href="http://localhost:3000/">`)
    expect(risky[0]).toContain('noindex')
    expect(risky.some(line => line.includes('is relative'))).toBe(true)
    expect(risky.some(line => line.includes('on your machine'))).toBe(true)
    expect(risky.some(line => line.includes('No twitter:card'))).toBe(true)
  })
})
