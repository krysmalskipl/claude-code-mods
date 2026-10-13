// The SEO basics of one file, as the band and /meta-lint show them.
export type Report = {
  file: string // the path as Claude edited it
  title: { text: string; from: string } | null // from: the frontmatter key or tag it came from
  description: { text: string; from: string } | null
  h1: number // in the body; a frontmatter title is usually the page's H1 too
  hasTitleField: boolean // the frontmatter has a title, so a body without H1 is fine
  noAlt: number // images without alt text
  words: number
}

declare module 'claude-code' {
  interface PluginState {
    'meta-lint': { last: Report | null }
  }
}
