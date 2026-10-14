// Google cuts snippets by rendered width, not by characters: "WWW" runs out of
// room long before "iii". Widths below are Arial's (Google's snippet font), in
// thousandths of the font size, so a title is measured as Google draws it.

const ARIAL: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '–': 556, '—': 1000, '…': 1000, '·': 278, '•': 350, '’': 222, '‘': 222,
  '“': 333, '”': 333, '«': 556, '»': 556, '€': 556, '£': 556,
}

function charWidth(char: string): number {
  if (char >= '0' && char <= '9') return 556
  const known = ARIAL[char]
  if (known !== undefined) return known
  // Accented Latin letters are as wide as their base letter (ą, é, ñ, ü).
  const base = char.normalize('NFD')[0] ?? char
  const baseWidth = ARIAL[base]
  if (base !== char && baseWidth !== undefined) return baseWidth
  if (char === 'ł') return 222
  if (char === 'Ł') return 556
  // CJK, emoji and the rest take about a full em.
  return (char.codePointAt(0) ?? 0) > 0x2e80 ? 1000 : 556
}

/** The rendered width of `text` in CSS pixels at `fontPx`. */
export function textWidth(text: string, fontPx: number): number {
  let total = 0
  for (const char of text) total += charWidth(char)
  return Math.round((total * fontPx) / 1000)
}

/**
 * Snippet limits. Google publishes none: these are the widths its result
 * column has drawn for years, measured by the SEO tools that check them.
 */
export const GOOGLE = {
  titleFont: 20,
  titlePx: 600,
  descFont: 14,
  descPxDesktop: 920,
  descPxMobile: 680,
} as const

/** Social cards cut by characters; these are the lengths that show whole on each. */
export const SOCIAL = {
  titleChars: 70,
  descChars: 160,
} as const

export type Cut = { text: string; isCut: boolean; width: number }

/** `text` as shown in at most `maxPx`: cut at a word where it can be, with " ..." as Google ends it. */
export function cutToWidth(text: string, fontPx: number, maxPx: number): Cut {
  const width = textWidth(text, fontPx)
  if (width <= maxPx) return { text, isCut: false, width }
  const room = maxPx - textWidth(' ...', fontPx)
  let used = 0
  let end = 0
  for (const char of text) {
    used += (charWidth(char) * fontPx) / 1000
    if (used > room) break
    end += char.length
  }
  const head = text.slice(0, end)
  const space = head.lastIndexOf(' ')
  const kept = (space > head.length * 0.6 ? head.slice(0, space) : head).replace(/[\s,.;:–-]+$/, '')
  return { text: `${kept} ...`, isCut: true, width }
}

/** `text` cut at `max` characters, at a word where it can be. */
export function cutToChars(text: string, max: number): { text: string; isCut: boolean } {
  const chars = [...text]
  if (chars.length <= max) return { text, isCut: false }
  const head = chars.slice(0, max - 1).join('')
  const space = head.lastIndexOf(' ')
  return { text: `${(space > head.length * 0.6 ? head.slice(0, space) : head).trimEnd()}…`, isCut: true }
}
