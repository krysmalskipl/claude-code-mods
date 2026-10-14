import { expect, test } from 'claude-code/testing'

const PAGE = `<html lang="en"><title>Acme - send invoices in 10 seconds, get paid twice as fast</title>
  <meta name="description" content="Acme turns a photo of a receipt into a ready invoice. Free for freelancers, no card needed.">
  <link rel="canonical" href="https://acme.dev/">
  <meta property="og:image" content="https://acme.dev/og.png"><meta name="twitter:card" content="summary_large_image"></html>`

const PANE = {
  plugin: 'share-preview',
  component: 'Pane',
  requestId: 'share-preview',
  props: { title: 'Share preview', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('/preview reads a file and draws both tabs on the terminal and the desktop', async ($, on) => {
  on('fs.read', () => ({ value: PAGE }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: { 'content-type': 'image/png', 'content-length': '84000' }, text: '' } }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.exists', () => ({ value: true }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const ran = await $.command.run({
    command: 'preview',
    args: 'index.html',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toContain('0 errors')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /acme\.dev/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Title fits Google|Google shows about/ })).toBeDefined()
    await ui.press({ key: 'social' })
    expect(await ui.find({ type: 'Text', text: /LINKEDIN/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /large card/ })).toBeDefined()
    await ui.press({ key: 'google' })
    await ui.unmount()
  }
})

test('shows how to use it before anything was previewed', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Usage: \/preview/ })).toBeDefined()
  await ui.unmount()
})
