import { expect, test } from 'claude-code/testing'

import { PRA, REAL, SURFACES, TFL, TOOL, clone, detailed, ghCalls, glyphOf, mountPane, openCalls, world } from './world'

// G1 from saved GitHub answers: the CI row is right, or it says what is unknown, and never shows a tick on
// missing or partial data.
const show = ($: any, repo: string, number: number, extra: object = {}) =>
  $.tool.call({ tool: TOOL, tool_use_id: `call-${number}`, repo, items: [{ number, action: 'approve and merge', ...extra }] })

const DMG = 'https://github.com/IsmaelMartinez/teams-for-linux/actions/runs/35625190059/job/106517235462'

test('teams-for-linux #2998 reads red CI failing · dmg, the review-comment holds aside, and its log opens', async ($, on) => {
  const seen = world(on)
  const answer = await show($, TFL, 2998, { head: '8962ae8' })
  expect(String(answer.result)).toContain('#2998 CI failing (1 check).')
  expect(String(answer.result)).not.toContain('held')
  expect(String(answer.result)).not.toContain('dmg')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await detailed(ui)
    expect(await glyphOf(ui, 'CI failing · dmg')).toEqual({ glyph: '✗', color: 'error' })
    const log = await ui.find({ type: 'Button', key: 'log' })
    // I2: a is never a row letter; the first lettered row takes b.
  expect(log?.props).toMatchObject({ label: 'log', hotkey: 'b', plain: true })
    await ui.press({ key: 'log' })
    await ui.unmount()
  }
  expect(openCalls(seen)).toEqual([['/usr/bin/open', DMG], ['/usr/bin/open', DMG]])
})

test('teams-for-linux #3090 reads amber CI held for your approval while its rollup is green', async ($, on) => {
  const seen = world(on)
  const pr = (seen.answers[`${TFL}#3090`] as any).data.repository.pullRequest
  expect(pr.commits.nodes[0].commit.statusCheckRollup.state).toBe('SUCCESS')
  await show($, TFL, 3090, { head: 'bec5a6c' })
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI held for your approval')).toEqual({ glyph: '▲', color: 'warning' })
  expect(await ui.find({ type: 'Button', key: 'log' })).toBeUndefined()
})

test('red outranks a pull_request hold: #3090 with a failing check reads failing, not held', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${TFL}#3090`])
  const rollup = card.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup
  rollup.state = 'FAILURE'
  rollup.contexts.nodes[0].conclusion = 'FAILURE'
  seen.answers[`${TFL}#3091`] = card
  const answer = await show($, TFL, 3091)
  expect(String(answer.result)).toContain('#3091 CI failing (1 check).')
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI failing · SonarCloud')).toEqual({ glyph: '✗', color: 'error' })
})

test('holds fired by review events never read as held: #2998 with its dmg fixed reads passed', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${TFL}#2998`])
  const commit = card.data.repository.pullRequest.commits.nodes[0].commit
  commit.statusCheckRollup.state = 'SUCCESS'
  for (const check of commit.statusCheckRollup.contexts.nodes) if (check.name === 'dmg') check.conclusion = 'SUCCESS'
  expect(commit.checkSuites.nodes.filter((suite: any) => suite.conclusion === 'ACTION_REQUIRED')).toHaveLength(5)
  seen.answers[`${TFL}#2997`] = card
  const answer = await show($, TFL, 2997)
  expect(String(answer.result)).not.toContain('CI')
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI passed · 17 checks')).toEqual({ glyph: '✓', color: 'success' })
})

test('teams-for-linux #3010 and #3021 read green, their failed and cancelled suites aside', async ($, on) => {
  world(on)
  for (const [number, head] of [[3010, '3286fcd'], [3021, '48b4699']] as const) {
    const answer = await show($, TFL, number, { head })
    expect(String(answer.result)).not.toContain('CI')
    const ui = await mountPane($, 'terminal')
    await detailed(ui)
    expect(await glyphOf(ui, 'CI passed · 15 checks')).toEqual({ glyph: '✓', color: 'success' })
    await ui.unmount()
  }
})

test('pr-agent #4045 reads CI passed · 9 checks: ten checks, one skipped', async ($, on) => {
  world(on)
  await show($, PRA, 4045, { head: '35a07eb' })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await detailed(ui)
    expect(await glyphOf(ui, 'CI passed · 9 checks')).toEqual({ glyph: '✓', color: 'success' })
    await ui.unmount()
  }
})

test('injected CodeQL and SonarCloud failures read red and are named', async ($, on) => {
  const seen = world(on)
  const failing = (name: string, permalink: string) => {
    const card = clone(seen.answers[`${PRA}#4045`])
    const rollup = card.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup
    rollup.state = 'FAILURE'
    rollup.contexts.nodes.push({ name, conclusion: 'FAILURE', status: 'COMPLETED', permalink })
    rollup.contexts.totalCount += 1
    return card
  }
  seen.answers[`${PRA}#5001`] = failing('Analyze (python)', 'https://github.com/The-PR-Agent/pr-agent/actions/runs/1/job/2')
  seen.answers[`${PRA}#5002`] = failing('SonarCloud Code Analysis', 'https://github.com/The-PR-Agent/pr-agent/runs/3')
  const codeql = await show($, PRA, 5001)
  let ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI failing · Analyze (python)')).toEqual({ glyph: '✗', color: 'error' })
  await ui.unmount()
  const sonar = await show($, PRA, 5002)
  ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI failing · SonarCloud Code Analysis')).toEqual({ glyph: '✗', color: 'error' })
  for (const said of [String(codeql.result), String(sonar.result)]) {
    expect(said).toMatch(/#500[12] CI failing \(1 check\)\./)
    expect(said).not.toMatch(/Analyze|SonarCloud|CodeQL/)
  }
})

test('more than two failing checks name two and count the rest', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${TFL}#2998`])
  const rollup = card.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup
  for (const check of rollup.contexts.nodes) if (['exe', 'snap', 'linux_x64'].includes(check.name)) check.conclusion = 'FAILURE'
  seen.answers[`${TFL}#2999`] = card
  const answer = await show($, TFL, 2999)
  expect(String(answer.result)).toContain('#2999 CI failing (4 checks).')
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI failing · snap, linux_x64 +2')).toEqual({ glyph: '✗', color: 'error' })
})

test('running, not run and an unexpected rollup state read amber in words', async ($, on) => {
  const seen = world(on)
  const card = (state: string | null) => {
    const one = clone(seen.answers[`${PRA}#4045`])
    const commit = one.data.repository.pullRequest.commits.nodes[0].commit
    if (state === null) commit.statusCheckRollup = null
    else commit.statusCheckRollup.state = state
    return one
  }
  seen.answers[`${PRA}#5003`] = card('PENDING')
  seen.answers[`${PRA}#5004`] = card(null)
  seen.answers[`${PRA}#5005`] = card('EXPECTED')
  for (const [number, words] of [[5003, 'CI running'], [5004, 'CI has not run'], [5005, 'CI running']] as const) {
    const answer = await show($, PRA, number)
    expect(String(answer.result)).toContain(`#${number} ${words}.`)
    const ui = await mountPane($, 'terminal')
    await detailed(ui)
    expect(await glyphOf(ui, words)).toEqual({ glyph: '▲', color: 'warning' })
    await ui.unmount()
  }
})

test('a 502, a timeout, an HTML page, a partial answer or a missing gh read CI unknown, with no tick', async ($, on) => {
  const seen = world(on)
  const cases: [string, () => void, string][] = [
    ['502', () => void (seen.modes['*'] = { kind: 'exit', stderr: REAL.gateway }), 'GitHub error'],
    ['timeout', () => void (seen.modes['*'] = { kind: 'slow', ms: 15_000 }), 'GitHub timed out'],
    ['HTML page', () => void (seen.modes['*'] = { kind: 'stdout', stdout: '<html><body>Unicorn!</body></html>' }), 'GitHub error'],
    ['partial', () => void (seen.modes['*'] = { kind: 'stdout', stdout: JSON.stringify({ ...(seen.answers[`${PRA}#4045`] as object), errors: [{ message: 'x' }] }) }), 'GitHub error'],
    ['bad credentials', () => void (seen.modes['*'] = { kind: 'exit', stderr: REAL.badCredentials }), 'GitHub sign-in failed: run gh auth login'],
    ['no gh', () => void (seen.hasGh = false), 'gh not found on PATH'],
  ]
  for (const [i, [name, arrange, phrase]] of cases.entries()) {
    arrange()
    const number = 6000 + i
    seen.answers[`${PRA}#${number}`] = seen.answers[`${PRA}#4045`]
    const pending = show($, PRA, number, { head: '35a07eb' })
    await seen.clock.advance(8_000)
    const answer = await pending
    expect(String(answer.result), name).toContain(`#${number}: ${phrase}.`)
    expect(String(answer.result), name).not.toMatch(/HooksError|still running|Bad Gateway|Unicorn|gh: |ENOENT/)
    const ui = await mountPane($, 'terminal')
    await detailed(ui)
    expect(await glyphOf(ui, `CI unknown: ${phrase}`), name).toEqual({ glyph: '▲', color: 'warning' })
    expect(await glyphOf(ui, 'head unknown, reviewed 35a07eb'), name).toEqual({ glyph: '▲', color: 'warning' })
    expect(await ui.find({ text: /CI passed|✓/ }), name).toBeUndefined()
    await ui.unmount()
  }
})

test('a list read short of its total is an amber row in words, and never a clear norm', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${PRA}#4045`])
  const pr = card.data.repository.pullRequest
  pr.files.totalCount = 112
  pr.files.nodes = Array.from({ length: 30 }, (_, i) => ({ path: `pr_agent/f${i}.py` }))
  pr.labels.totalCount = 14
  seen.answers[`${PRA}#5006`] = card
  const answer = await show($, PRA, 5006, { head: '35a07eb' })
  expect(String(answer.result)).toContain('#5006: 30 of 112 files read, code that runs unknown.')
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, '30 of 112 files read, code that runs unknown')).toEqual({ glyph: '▲', color: 'warning' })
  expect(await glyphOf(ui, '1 of 14 labels read, breaking unknown')).toEqual({ glyph: '▲', color: 'warning' })
  const clear = await ui.find({ type: 'Text', text: /^clear: / })
  expect(clear?.text).not.toMatch(/code that runs|breaking/)
})

test('CI lists read short of their totals read CI unknown, and a red rollup still reads red', async ($, on) => {
  const seen = world(on)
  const short = (what: 'contexts' | 'suites', state: string) => {
    const card = clone(seen.answers[`${PRA}#4045`])
    const commit = card.data.repository.pullRequest.commits.nodes[0].commit
    commit.statusCheckRollup.state = state
    if (what === 'contexts') commit.statusCheckRollup.contexts.totalCount = 61
    else commit.checkSuites.totalCount = 61
    return card
  }
  seen.answers[`${PRA}#5007`] = short('contexts', 'SUCCESS')
  seen.answers[`${PRA}#5008`] = short('suites', 'SUCCESS')
  seen.answers[`${PRA}#5009`] = short('contexts', 'FAILURE')
  await show($, PRA, 5007)
  let ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI unknown, 10 of 61 checks read')).toEqual({ glyph: '▲', color: 'warning' })
  await ui.unmount()
  await show($, PRA, 5008)
  ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI unknown, 6 of 61 suites read')).toEqual({ glyph: '▲', color: 'warning' })
  await ui.unmount()
  await show($, PRA, 5009)
  ui = await mountPane($, 'terminal')
  await detailed(ui)
  expect(await glyphOf(ui, 'CI failing')).toEqual({ glyph: '✗', color: 'error' })
  expect(ghCalls(seen)).toHaveLength(3)
})

test('a reviewed head under 7 hex characters, or not hex, is refused before any read', async ($, on) => {
  const seen = world(on)
  for (const head of ['3', '35a07e', 'xyz1234', '35a07eb-', '35a07ebb5e36e780792b0f6bdc04810882ae7d9d0']) {
    const answer = await show($, PRA, 4045, { head })
    expect(String(answer.deny), head).toContain('#4045 head must be 7 to 40 hex characters.')
  }
  expect(seen.calls).toEqual([])
  const upper = await show($, PRA, 4045, { head: '35A07EB' })
  expect(String(upper.result)).not.toContain('head moved')
})
