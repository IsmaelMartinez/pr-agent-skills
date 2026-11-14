import { expect, test } from 'claude-code/testing'

import { PAIR, PRA, SHOWN, SURFACES, TFL, TFL_PAIR, TOOL, TYPED, clone, detailed, ghCalls, glyphOf, mountPane, world } from './world'

// The live mod's twelve tests, ported from gh pr view and the REST suites call to the one GraphQL card read.
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} } as const

test('a pair opens the pane, draws both drafts and reports what moved', async ($, on) => {
  const seen = world(on)
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  const said = String(answer.result)
  expect(said).toContain('Shown in the review-pair pane.')
  expect(said).toContain('#2450 head moved to 7ca951b since the review at 1234567.')
  expect(said).toContain('#2450 has conflicts.')
  expect(said).toContain('#2450 closes #2445, which is already closed.')
  expect(said).toContain('#4045 has 1 unresolved review thread (bot).')
  expect(said).not.toContain('#4045 head')
  expect(said).not.toMatch(/PeterDaveHello|naorpeled|retrying|clone host|copilot|qodo|bug|github_provider|Analyze/)
  expect(seen.opened).toEqual(['review-pair'])
  expect(ghCalls(seen).sort()).toEqual([`${PRA}#2450`, `${PRA}#4045`])

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: '5 under review' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button', text: /^#(4045|2450)$/ })).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: 'Claude 9/10: approve and merge' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Thanks @PeterDaveHello, approving and merging.' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'fix(github): avoid retrying permanent diff collection failures' })).toBeDefined()
    await detailed(ui)
    expect(await glyphOf(ui, 'head 35a07eb as reviewed')).toEqual({ glyph: '✓', color: 'success' })
    expect(await glyphOf(ui, 'CI passed · 9 checks')).toEqual({ glyph: '✓', color: 'success' })
    expect(await glyphOf(ui, '1 open thread, bot: github_provider.py:588')).toEqual({ glyph: '▲', color: 'warning' })
    expect(await ui.find({ text: /gitlab_provider\.py:979/ })).toBeUndefined()

    await ui.press({ key: 'tab-1' })
    await detailed(ui)
    expect(await ui.find({ type: 'Text', text: /^fix\(security\): validate clone host exactly/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Claude 7/10, author acts: COMMENT with one inline suggestion' })).toBeDefined()
    expect(await glyphOf(ui, 'head moved to 7ca951b, reviewed 1234567')).toEqual({ glyph: '✗', color: 'error' })
    expect(await glyphOf(ui, 'conflicts with the base')).toEqual({ glyph: '✗', color: 'error' })
    expect(await glyphOf(ui, 'draft')).toEqual({ glyph: '▲', color: 'warning' })
    // I2: the first row letter is b, since a and k left the row letters.
    expect((await ui.find({ type: 'Button', key: 'issue-2445' }))?.props).toMatchObject({ label: '#2445', hotkey: 'b' })
    expect(await ui.find({ type: 'Text', text: 'pr_agent/git_providers/gitlab_provider.py:979' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Could this reuse `_as_line`?' })).toBeDefined()
    expect(await ui.find({ text: /approving and merging/ })).toBeUndefined()
    await ui.press({ key: 'tab-0' })
    await ui.unmount()
  }
})

test('a new pair starts on its first tab', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'tab-1' })
  expect(await ui.find({ type: 'Text', text: /clone host/ })).toBeDefined()
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-2', ...PAIR })
  expect(await ui.find({ type: 'Text', text: /avoid retrying/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /clone host/ })).toBeUndefined()
})

test('a pane the engine will not place says why', async ($, on) => {
  const seen = world(on)
  seen.placement = { isPlaced: false, reason: 'below 144 columns' }
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  expect(String(answer.result)).toContain('Saved, not on screen (below 144 columns); /review-pair opens it.')
  expect(seen.toasts).toHaveLength(1)
})

test('the not-placed toast shows once however many pairs follow', async ($, on) => {
  const seen = world(on)
  seen.placement = { isPlaced: false, reason: 'below 144 columns' }
  for (const id of ['call-1', 'call-2', 'call-3']) await $.tool.call({ tool: TOOL, tool_use_id: id, ...PAIR })
  expect(seen.toasts).toEqual(['review-pair: widen the terminal or type /review-pair to see the pair'])
})

test('pr-maintainer opens the pane and other skills leave it alone', async ($, on) => {
  const seen = world(on)
  await $.skill.prompt({ skill: 'commit', text: 'Write a commit.' })
  expect(seen.opened).toEqual([])
  const expanded = await $.skill.prompt({ skill: 'pr-maintainer', text: 'Maintainer duty.' })
  expect(expanded.text).toBe('Maintainer duty.')
  expect(seen.opened).toEqual(['review-pair'])
  expect(seen.calls).toEqual([])
})

test('I1b: an empty pair clears the pair and leaves the pane on the queue, closing nothing', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...PAIR })
  seen.panes = [SHOWN]
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-2', repo: PRA, items: [] })
  expect(answer.result).toBe('Pair cleared; the pane shows the queue.')
  expect(seen.closed).toEqual([])
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ text: /Nothing under review/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'issues' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'pair' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'tab-0' })).toBeUndefined()
})

test('a subagent cannot set the pair and a bad repo is refused', async ($, on) => {
  const seen = world(on)
  const fromAgent = await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', agentId: 'agent-1', ...PAIR })
  expect(String(fromAgent.result)).toContain('Ignored')
  expect(seen.opened).toEqual([])
  const bad = await $.tool.call({ tool: TOOL, tool_use_id: 'call-2', repo: 'not a repo', items: PAIR.items })
  expect(String(bad.deny ?? bad.text)).toContain('repo must be owner/name')
  expect(seen.calls).toEqual([])
})

test('/review-pair hides a shown pane and shows a hidden one', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.command.run(TYPED)
  expect(seen.closed).toEqual(['review-pair'])
  seen.panes = []
  await $.command.run(TYPED)
  expect(seen.opened).toEqual(['review-pair'])
})

test('/review-pair in a terminal too narrow to dock says why it sits above the prompt', async ($, on) => {
  world(on)
  const answer = await $.command.run({ ...TYPED, presentation: { isFullscreen: true, columns: 108 } })
  expect(answer.text).toBe('Opened above the prompt: the right-hand dock needs 110 columns and this terminal has 108.')
  const wide = await $.command.run(TYPED)
  expect(wide.text).toBeUndefined()
})

test('CI held for a maintainer to approve reads as held, never as passed', async ($, on) => {
  world(on)
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', repo: TFL, items: [TFL_PAIR.items[1]] })
  expect(String(answer.result)).toContain('#3090 CI held for your approval.')
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI held for your approval')).toEqual({ glyph: '▲', color: 'warning' })
  expect(await ui.find({ text: /CI passed/ })).toBeUndefined()
})

test('I1b: clearing the batch needs no repo, and the queue stays on the last repo shown', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', ...TFL_PAIR })
  seen.panes = [SHOWN]
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-2', items: [] })
  expect(answer.result).toBe('Pair cleared; the pane shows the queue.')
  expect(seen.closed).toEqual([])
  const bad = await $.tool.call({ tool: TOOL, tool_use_id: 'call-3', repo: '../..', items: [] })
  expect(String(bad.deny)).toContain('repo must be owner/name')
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'refresh' })
  // I2c: no caption says there is no board (it holds no data now); the queue's read time shows.
  expect(await ui.find({ type: 'Text', text: /^as of [0-9]{2}:[0-9]{2}$/ })).toBeDefined()
  expect(seen.calls.filter(call => call.argv.some(arg => arg === 'name=teams-for-linux')).length).toBeGreaterThan(0)
})

test('control characters from GitHub or a draft never stop the pane drawing', async ($, on) => {
  const seen = world(on)
  const tricky = clone(seen.answers[`${PRA}#4045`])
  tricky.data.repository.pullRequest.title = 'fix: retry \u{1B}[31mless\u{7}'
  seen.answers[`${PRA}#4047`] = tricky
  const item = { number: 4047, action: 'approve and merge', draft: 'Thanks.\r\nApproving and merging.' }
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', repo: PRA, items: [item] })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: 'fix: retry [31mless' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Thanks.\nApproving and merging.' })).toBeDefined()
    await ui.unmount()
  }
})

test('outside the fullscreen layout the skill toasts instead of opening inline', async ($, on) => {
  const seen = world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return Box({})
  })
  const band = await $.ui.mount({
    plugin: 'review-pair',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
    viewport: { columns: 200, rows: 50, isFullscreen: false },
  })
  await band.unmount()
  await $.skill.prompt({ skill: 'pr-maintainer', text: 'Maintainer duty.' })
  expect(seen.opened).toEqual([])
  expect(seen.toasts[0]).toContain('/review-pair')
})
