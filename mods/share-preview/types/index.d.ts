/** Where a preview's tags were read from. */
export type PreviewSource = { kind: 'file' | 'url'; target: string }

/** The tags a link preview is built from; a value that is code, not text, is marked dynamic. */
export type PageMeta = {
  title?: string
  description?: string
  canonical?: string
  lang?: string
  robots?: string
  siteName?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogImageAlt?: string
  ogUrl?: string
  twitterCard?: string
  twitterTitle?: string
  twitterDescription?: string
  twitterImage?: string
  /** Tags whose value is an expression, so only the rendered page knows it. */
  dynamic: string[]
}

/** What became of the og:image when the mod looked for it. */
export type ImageCheck = {
  status: 'ok' | 'missing' | 'broken' | 'unchecked'
  note: string
}

export type Preview = {
  source: PreviewSource
  meta: PageMeta
  image: ImageCheck
  /** The host shown in the snippet, from canonical, og:url or the URL itself. */
  host?: string
  path?: string
  /** Whether the source has an <html> tag, so a missing lang is worth saying. */
  hasHtml: boolean
  error?: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'share-preview': {
      preview: Preview | null
      lastFile: string | null
      tab: 'google' | 'social'
    }
  }
}
