import type { ImageCheck, PageMeta } from '../types'
import { GOOGLE, SOCIAL, textWidth } from './measure'

export type Level = 'error' | 'warn' | 'ok' | 'info'
export type Issue = { level: Level; text: string }

/** What each platform falls back to when its own tag is missing. */
export function cardValues(meta: PageMeta) {
  return {
    title: meta.ogTitle ?? meta.title,
    description: meta.ogDescription ?? meta.description,
    image: meta.ogImage ?? meta.twitterImage,
    xTitle: meta.twitterTitle ?? meta.ogTitle ?? meta.title,
    xDescription: meta.twitterDescription ?? meta.ogDescription ?? meta.description,
    xImage: meta.twitterImage ?? meta.ogImage,
    xCard: meta.twitterCard ?? (meta.twitterImage || meta.ogImage ? 'summary' : undefined),
  }
}

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|[^/]+\.(local|test))(?:[:/]|$)/i.test(url)
const isAbsolute = (url: string) => /^https?:\/\//i.test(url)

/** The problems that would cost the page clicks, worst first, then what is fine. */
export function checkMeta(meta: PageMeta, image: ImageCheck, hasHtmlTag = true): Issue[] {
  const issues: Issue[] = []
  const add = (level: Level, text: string) => issues.push({ level, text })
  const dynamic = (field: string) => meta.dynamic.includes(field)

  if (meta.robots && /noindex/i.test(meta.robots)) add('error', `robots says "${meta.robots}": Google won't show this page at all`)

  if (meta.title) {
    const px = textWidth(meta.title, GOOGLE.titleFont)
    if (px > GOOGLE.titlePx) add('warn', `Title is ${px}px wide, Google shows about ${GOOGLE.titlePx}px: the end is cut`)
    else if ([...meta.title].length < 15) add('warn', `Title is only ${[...meta.title].length} characters: room for the keyword and a reason to click`)
    else add('ok', `Title fits Google (${px}/${GOOGLE.titlePx}px)`)
  } else if (!dynamic('title')) add('error', 'No <title>: Google makes one up from the page')

  if (meta.description) {
    const px = textWidth(meta.description, GOOGLE.descFont)
    if (px > GOOGLE.descPxDesktop) add('warn', `Description is cut on desktop (${px}/${GOOGLE.descPxDesktop}px)`)
    else if (px > GOOGLE.descPxMobile) add('info', `Description fits desktop, mobile cuts it after about ${GOOGLE.descPxMobile}px`)
    else add('ok', `Description fits desktop and mobile (${px}px)`)
    if ([...meta.description].length < 50) add('warn', 'Description is under 50 characters: Google often swaps in its own text')
    if (meta.title && meta.description.toLowerCase() === meta.title.toLowerCase()) add('warn', 'Description repeats the title word for word')
  } else if (!dynamic('description')) add('warn', 'No meta description: Google picks a sentence from the page')

  const card = cardValues(meta)
  if (!card.image && !dynamic('ogImage')) add('error', 'No og:image: shares on LinkedIn, Facebook, Slack and X show no picture')
  else if (card.image && !isAbsolute(card.image) && !card.image.startsWith('//')) add('error', `og:image "${card.image}" is relative: platforms need a full https:// URL`)
  else if (card.image && card.image.startsWith('http://')) add('warn', 'og:image is http://: some platforms only load https images')
  if (card.image && isLocal(card.image)) add('error', 'og:image points at a local address: nobody outside your machine can load it')
  if (image.status === 'broken') add('error', image.note)
  else if (image.status === 'ok') add('ok', image.note)
  else if (image.status === 'unchecked' && image.note) add('info', image.note)
  if (card.image && !meta.ogImageAlt) add('info', 'No og:image:alt: screen readers on X and LinkedIn get nothing')

  if (!meta.ogTitle && !dynamic('ogTitle') && meta.title) add('info', 'No og:title: shares use the <title>')
  if (card.title && [...card.title].length > SOCIAL.titleChars) add('warn', `Share title is ${[...card.title].length} characters: cards cut it after about ${SOCIAL.titleChars}`)

  if (!meta.twitterCard && card.xImage) add('warn', 'No twitter:card: X shows a small thumbnail, add summary_large_image for the big card')

  if (meta.canonical) {
    if (isLocal(meta.canonical)) add('error', `canonical is ${meta.canonical}: Google is told the real page is on your machine`)
    else if (!isAbsolute(meta.canonical)) add('warn', 'canonical is relative: use the full URL')
  } else if (!dynamic('canonical')) add('info', 'No canonical: fine for one URL, needed once the page has variants (?utm, trailing /)')

  if (hasHtmlTag && !meta.lang && !dynamic('lang')) add('info', 'No <html lang>: search engines and screen readers guess the language')

  if (meta.dynamic.length > 0) add('info', `Set in code (${meta.dynamic.join(', ')}): /preview <url> reads the rendered page`)

  const order: Record<Level, number> = { error: 0, warn: 1, info: 2, ok: 3 }
  return issues.sort((a, b) => order[a.level] - order[b.level])
}
