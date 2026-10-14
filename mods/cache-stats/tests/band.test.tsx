import { expect, test } from 'claude-code/testing'

const STOP = {
  kind: 'stop',
  stopReason: 'end_turn',
  usage: { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 128_000, cache_creation_input_tokens: 4000 },
}

const BAND = {
  plugin: 'cache-stats',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

test('counts a request and draws the band on every surface', async ($, on) => {
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  // The engine's own band, which the mod leaves alone until it has numbers.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>engine band</Text>
  })
  on('turn.step', async function* ($, e) {
    yield STOP as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })

  // Nothing to show before the first request: the engine's own band stays.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Cache/ })).toBeUndefined()
    await ui.unmount()
  }

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) void _

  now += 2 * 60_000
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /96% hit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /warm 58m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /133k cached/ })).toBeDefined()
    await ui.unmount()
  }
})
