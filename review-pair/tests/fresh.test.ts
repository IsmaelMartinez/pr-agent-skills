import { expect, test } from 'claude-code/testing'

import { NOW, PAIR, PRA, QUEUE_NOW, REAL, SHOWN, SURFACES, TOOL, TURN, TYPED, columnOf, detailed, ghCalls, glyphOf, hhmm, mountPane, queueCalls, world } from './world'

// G1's stale rule and G6: fresh when the viewer looks, quiet and cheap when they do not, and the five behaviours of the
// live mod that the SRE baseline pinned no longer reproduce.
const ONE = { repo: PRA, items: [PAIR.items[0]] }
const MINUTE = 60_000

test('as of HH:MM is the read time, and at five minutes head and CI lose the tick through one timer, with no call', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  // I1c: a pane on screen is read every minute and never turns stale; one drawn behind another tab is not read.
  seen.panes = [{ ...SHOWN, isShown: false }]
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  // I2c: r is always 'refresh'; the read's time is a grey caption beside it.
  expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props).toMatchObject({ label: 'refresh', hotkey: 'r' })
  expect((await ui.find({ type: 'Text', text: `as of ${hhmm(NOW)}` }))?.props.color).toBe('inactive')
  expect(hhmm(NOW)).toMatch(/^\d\d:48$/)
  await seen.clock.advance(5 * MINUTE - 1)
  expect(await glyphOf(ui, 'head 35a07eb as reviewed')).toEqual({ glyph: '✓', color: 'success' })
  await seen.clock.advance(1)
  expect(await glyphOf(ui, 'head 5 min old: 35a07eb as reviewed')).toEqual({ glyph: '▲', color: 'warning' })
  expect(await glyphOf(ui, 'CI 5 min old: passed · 9 checks')).toEqual({ glyph: '▲', color: 'warning' })
  // The other facts turn grey, glyph and words, and the clear line keeps no tick.
  expect(await glyphOf(ui, '1 open thread, bot: github_provider.py:588')).toEqual({ glyph: '▲', color: 'inactive' })
  expect(await glyphOf(ui, /clear: no conflicts/)).toEqual({ glyph: '○', color: 'inactive' })
  expect((await ui.find({ type: 'Text', text: /^clear: / }))?.props.color).toBe('inactive')
  expect(await ui.find({ text: '✓' })).toBeUndefined()
  expect(ghCalls(seen)).toEqual([`${PRA}#4045`])
  // A later redraw shows the age then; still no call.
  await seen.clock.advance(MINUTE)
  await ui.press({ key: 'tab-0' })
  expect(await ui.find({ type: 'Text', text: 'CI 6 min old: passed · 9 checks' })).toBeDefined()
  expect(ghCalls(seen)).toEqual([`${PRA}#4045`])
  // r reads again and the tick is back.
  await ui.press({ key: 'refresh' })
  expect(await glyphOf(ui, 'CI passed · 9 checks')).toEqual({ glyph: '✓', color: 'success' })
  expect(await ui.find({ type: 'Text', text: `as of ${hhmm(NOW + 6 * MINUTE)}` })).toBeDefined()
})

test('only the latest refresh times the stale mark: an earlier one does not turn a fresh read stale', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  await seen.clock.advance(4 * MINUTE)
  await ui.press({ key: 'refresh' })
  await seen.clock.advance(MINUTE)
  expect(await glyphOf(ui, 'CI passed · 9 checks')).toEqual({ glyph: '✓', color: 'success' })
  await seen.clock.advance(4 * MINUTE)
  expect(await glyphOf(ui, 'CI 5 min old: passed · 9 checks')).toEqual({ glyph: '▲', color: 'warning' })
})

test('a slow refresh of the last pair landing late does not move the new pair stale mark', async ($, on) => {
  const seen = world(on)
  seen.modes[`${PRA}#2450`] = { kind: 'slow', ms: 5_000 }
  void $.tool.call({ tool: TOOL, tool_use_id: 'call-1', repo: PRA, items: [PAIR.items[1]] })
  await seen.clock.advance(1_000)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-2', ...ONE })
  await seen.clock.advance(4_000)
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  await seen.clock.advance(5 * MINUTE - 5_000)
  expect(await glyphOf(ui, 'CI passed · 9 checks')).toEqual({ glyph: '✓', color: 'success' })
  await seen.clock.advance(1_000)
  expect(await glyphOf(ui, 'CI 5 min old: passed · 9 checks')).toEqual({ glyph: '▲', color: 'warning' })
})

test('flipped: after a failed refresh the facts stay, head and CI say refresh failed, and no stderr shows', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await detailed(ui)
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()
    await ui.unmount()
  }
  await seen.clock.advance(MINUTE)
  seen.modes['*'] = { kind: 'exit', stderr: REAL.badCredentials }
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  await ui.press({ key: 'refresh' })
  const at = hhmm(NOW)
  expect(await glyphOf(ui, `head as of ${at}, refresh failed: 35a07eb as reviewed`)).toEqual({ glyph: '▲', color: 'warning' })
  expect(await glyphOf(ui, `CI as of ${at}, refresh failed: passed · 9 checks`)).toEqual({ glyph: '▲', color: 'warning' })
  expect(await glyphOf(ui, '1 open thread, bot: github_provider.py:588')).toEqual({ glyph: '▲', color: 'inactive' })
  expect(await ui.find({ type: 'Text', text: /fix\(github\): avoid retrying/ })).toBeDefined()
  expect(await ui.find({ text: /Bad credentials|HTTP 401|gh:/ })).toBeUndefined()
  expect(await ui.find({ text: '✓' })).toBeUndefined()
  // The next good read clears the mark.
  seen.modes = {}
  await ui.press({ key: 'refresh' })
  expect(await glyphOf(ui, 'CI passed · 9 checks')).toEqual({ glyph: '✓', color: 'success' })
})

test('flipped: a slow GitHub holds the show call at most the 8 s every gh call is bounded by', async ($, on) => {
  const seen = world(on)
  seen.modes['*'] = { kind: 'slow', ms: 15_000 }
  let isAnswered = false
  const pending = $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR }).then(answer => {
    isAnswered = true
    return answer
  })
  await seen.clock.advance(7_999)
  expect(isAnswered).toBe(false)
  await seen.clock.advance(1)
  const answer = await pending
  expect(isAnswered).toBe(true)
  expect(String(answer.result)).toContain('#4045: GitHub timed out.')
  expect(seen.calls.map(call => call.timeoutMs)).toEqual([8_000, 8_000])
})

test('flipped: five r presses during a slow refresh add 2 processes, not 10', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  expect(ghCalls(seen)).toHaveLength(2)
  seen.modes['*'] = { kind: 'slow', ms: 5_000 }
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  for (let i = 0; i < 5; i += 1) await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(4)
  await seen.clock.advance(5_000)
  expect(ghCalls(seen)).toHaveLength(4)
  // I2c: r reads the queue too, behind the viewer's login, so the press still runs and says so; then it lands.
  expect(await ui.find({ type: 'Text', text: 'refreshing' })).toBeDefined()
  await seen.clock.advance(5_000)
  expect(await ui.find({ type: 'Text', text: `as of ${hhmm(NOW)}` })).toBeDefined()
  // Once it lands, the next press reads again.
  seen.modes = {}
  await ui.press({ key: 'refresh' })
  expect(ghCalls(seen)).toHaveLength(6)
})

test('flipped: a hidden or background pane makes no call after a turn; a shown one at most every 20 s', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  expect(ghCalls(seen)).toHaveLength(2)
  for (const panes of [[{ ...SHOWN, isShown: false }], [{ ...SHOWN, isPlaced: false }], []]) {
    seen.panes = panes
    await seen.clock.advance(21_000)
    await $.turn.complete(TURN)
    await seen.clock.settle()
    expect(ghCalls(seen)).toHaveLength(2)
  }
  seen.panes = [SHOWN]
  await $.turn.complete({ ...TURN, agentId: 'agent-1' })
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(2)
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(4)
  await seen.clock.advance(19_000)
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(4)
  await seen.clock.advance(1_000)
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(6)
})

test('flipped: a timed-out gh reaches neither the model nor the pane as engine text', async ($, on) => {
  const seen = world(on)
  seen.modes['*'] = { kind: 'slow', ms: 60_000 }
  const pending = $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  await seen.clock.advance(8_000)
  const answer = await pending
  expect(String(answer.result)).toContain('#4045: GitHub timed out.')
  expect(String(answer.result)).not.toMatch(/still running|HooksError|8000ms/)
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI unknown: GitHub timed out')).toEqual({ glyph: '▲', color: 'warning' })
  expect(await ui.find({ text: /still running|HooksError/ })).toBeUndefined()
})

test('the show call resolves once its card reads settle, and reads nothing else', async ($, on) => {
  const seen = world(on)
  seen.modes['*'] = { kind: 'slow', ms: 1_000 }
  let isAnswered = false
  const pending = $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR }).then(answer => {
    isAnswered = true
    return answer
  })
  await seen.clock.settle()
  expect(ghCalls(seen).sort()).toEqual([`${PRA}#2450`, `${PRA}#4045`])
  expect(isAnswered).toBe(false)
  await seen.clock.advance(1_000)
  await pending
  expect(isAnswered).toBe(true)
  // One card read per item, in parallel, and nothing more: no queue, no gh --version, no open.
  expect(seen.calls.map(call => call.argv.slice(0, 3).join(' '))).toEqual(['gh api graphql', 'gh api graphql'])
  expect(seen.calls.every(call => call.at === NOW)).toBe(true)
})

test('every gh call is bounded at 8 s and every open at 5 s', async ($, on) => {
  const seen = world(on)
  seen.hasGh = true
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'open' })
  seen.modes['*'] = { kind: 'refuse', reason: REAL.noGh }
  await ui.press({ key: 'refresh' })
  const gh = seen.calls.filter(call => call.argv[0] === 'gh')
  expect(gh.map(call => call.argv[1])).toContain('--version')
  expect(gh.every(call => call.timeoutMs === 8_000)).toBe(true)
  expect(seen.calls.filter(call => call.argv[0] === '/usr/bin/open').map(call => call.timeoutMs)).toEqual([5_000])
})

test('gh --version runs once per session, only after a call is refused before it ran', async ($, on) => {
  const seen = world(on)
  seen.modes['*'] = { kind: 'refuse', reason: 'refused by a hook' }
  for (const id of ['call-1', 'call-2']) await $.tool.call({ tool: TOOL, tool_use_id: id, ...PAIR })
  expect(seen.calls.filter(call => call.argv[1] === '--version')).toHaveLength(1)
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-3', ...ONE })
  expect(String(answer.result)).toContain('#4045: GitHub error.')
})

test('after /clear a shown pane reads again through classic.SessionStart; a hidden one costs nothing', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  expect(ghCalls(seen)).toHaveLength(1)
  seen.panes = []
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(1)
  seen.panes = [SHOWN]
  // I1c: the minute's poll reads too; each SessionStart from /clear, a resume or a fork adds its own read.
  for (const source of ['clear', 'resume', 'fork'] as const) {
    await seen.clock.advance(MINUTE)
    const before = ghCalls(seen).length
    await $.classic.SessionStart({ source })
    await seen.clock.settle()
    expect(ghCalls(seen), source).toHaveLength(before + 1)
  }
  const before = ghCalls(seen).length
  await $.classic.SessionStart({ source: 'startup' })
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(before)
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await ui.find({ type: 'Text', text: `as of ${hhmm(NOW + 3 * MINUTE)}` })).toBeDefined()
})

test('a session start, as after a hot reload, reads a shown pane once and a hidden one never', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  seen.panes = [SHOWN]
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(2)
  seen.panes = []
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  expect(ghCalls(seen)).toHaveLength(2)
})

test('/review-pair opened by hand reads the pair once and draws it', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...ONE })
  await $.command.run(TYPED)
  expect(ghCalls(seen)).toHaveLength(2)
})

// I2c fixes: /clear empties $.state under the open pane (the view back at its 'pair' default, the repo and queue gone)
// and raises no session.start; the pane that showed the queue shows it again, and the poll goes on reading it.
test('after /clear a pane that showed the queue shows it again and its poll keeps reading', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  // The engine's /clear: every value the plugin holds reads as never written, until the plugin writes it again.
  const cleared = new Set<string>()
  on('state.get', async ($, e, next) => {
    const held: any = await next(e)
    return cleared.has(e.key) ? { value: { value: undefined, version: held.value.version } } : held
  })
  on('state.set', async ($, e, next) => {
    cleared.delete(e.key)
    return next(e)
  })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  expect(queueCalls(seen)).toEqual([PRA])
  // I2e: armed goes with the rest; the pane still placed arms the session again.
  for (const key of ['pair', 'cards', 'tab', 'view', 'repo', 'queue', 'detail', 'detailCard', 'trend', 'refreshing', 'armed']) cleared.add(key)
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, PRA])
  await seen.clock.advance(MINUTE)
  await seen.clock.advance(MINUTE)
  expect(queueCalls(seen)).toEqual([PRA, PRA, PRA, PRA])
  const ui = await mountPane($, 'terminal', 104, true)
  await detailed(ui)
  const column = (await columnOf(ui)).join(' ')
  expect(column).toContain(`as of ${hhmm(QUEUE_NOW + 2 * MINUTE)}`)
  expect(column).not.toContain('Nothing under review')
})
