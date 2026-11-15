import { expect, test } from 'claude-code/testing'

import { DETAIL_ISSUE, DETAIL_PR, QUEUE, queueModelOf, queueReadOf } from '../hooks/github'
import { LETTERS, PAIR_RESERVED, SIDE_FROM, focusablesOf } from '../hooks/views'
import { PR_3995 } from './detail-fixtures'
import { lint } from './lint'
import { VIEWER_LOGIN, answerOf, pull } from './queue-fixtures'
import { PAIR, PRA, QUEUE_NOW, SHOWN, SURFACES, TFL, TOOL, TURN, TYPED, cardKey, clone, mountPane, opened, paneProps, textOf, world } from './world'
import type { World } from './world'

// I2: unified navigation. The cursor is the engine's focus ring: j and k are plain Buttons whose press asks
// $.ui.focus for the next or previous row, a ui.focus of the person's (Tab, the arrows on a fitting tree, which the
// kit replays as an event) syncs it back, and the row it rests on draws ▸ in column 1. Enter is the engine's: it
// presses the Button under the ring, which is the row's own, so a press by key stands in for it here. The kit has no
// engine to hold a ring, so a plugin's own $.ui.focus is refused there as its $.ui.scroll is (detail.test.ts): the
// mod logs the refusal naming the key at debug level, and that line is the evidence of what it asked for; spike S
// (Q11) saw the ring move on both builds.
const MINUTE = 60_000

// The words of a drawn node with its parts spaced, a plain Button as the terminal paints it ('b: #4042'); the cursor
// cell is one space on every row but the cursor's, and reads as nothing.
function wordsOf(node: unknown): string {
  const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (typeof node === 'string') return node
  if (element?.type === 'Button') {
    const label = String(element.props?.label ?? '')
    return element.props?.hotkey === undefined ? label : `${String(element.props.hotkey)}: ${label}`
  }
  if (element?.type === 'Text') return textOf(node)
  return (element?.children ?? []).map(wordsOf).filter(words => words !== '' && words !== ' ').join(' ')
}

type Drawn = { type?: string; props?: Record<string, unknown>; children?: Drawn[] }

// The list's rows: the column itself, or at SIDE_FROM columns and over the left column of the two.
async function columnOf(ui: any): Promise<string[]> {
  const root = (await ui.drawn()) as Drawn
  const column = root.props?.flexDirection === 'row' ? root.children?.[0] : root
  return (column?.children ?? []).map(wordsOf)
}

// The master-detail column's rows, or undefined when the view draws one column.
async function sideOf(ui: any): Promise<string[] | undefined> {
  const root = (await ui.drawn()) as Drawn
  if (root.props?.flexDirection !== 'row') return undefined
  return (root.children?.[1]?.children ?? []).map(wordsOf)
}

const cursorRow = async (ui: any) => (await columnOf(ui)).find(row => row.startsWith('▸ '))
// The rows the mod's own $.ui.focus asked for, in order, from its debug lines (registered before the first $ call).
function asked(on: any): string[] {
  const keys: string[] = []
  on('ui.log', async ($: unknown, e: { text: string }) => {
    const line = /^review-pair: the focus ring did not move to (\S+) \(/.exec(e.text)
    if (line !== null) keys.push(String(line[1]))
    return { value: undefined }
  })
  return keys
}
const NONE_OPEN = { queue: [], issues: [] }
const detailCalls = (seen: World) =>
  seen.calls.filter(call => call.argv[4] === `query=${DETAIL_PR}` || call.argv[4] === `query=${DETAIL_ISSUE}`).map(call => Number(call.argv.at(-1)?.slice('number='.length)))
// What the kit replays as the person's Tab (or an arrow on a fitting tree) landing the ring on an element.
const tabbed = ($: any, element: string, kind = 'person') =>
  $.ui.focus({ component: 'Pane', requestId: 'review-pair', plugin: 'review-pair', element, origin: kind === 'person' ? { kind } : { kind, name: 'review-pair' } } as any)

// The person opens the queue with /review-pair: no pair, the last repo in $.store, the pane then on screen.
async function openQueue($: any, on: any, repo = PRA): Promise<World> {
  const seen = world(on, { now: QUEUE_NOW, store: { repo } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  return seen
}

// A detail answer for another number, from the recorded #3995.
function detailFor(number: number, title: string): unknown {
  const answer = clone(PR_3995)
  Object.assign(answer.data.repository.pullRequest, { number, title })
  return answer
}

const nothingPosted = (seen: World) => {
  expect(seen.toolRuns).toEqual([])
  expect(seen.outward).toEqual([])
  expect(seen.calls.every(call => call.argv[0] === '/usr/bin/open' || (call.argv[1] === 'api' && call.argv[2] === 'graphql' && !call.argv.join(' ').includes('mutation')))).toBe(true)
}

test('j and k move the ▸ and ask the engine to focus the row, one at a time, stopping at the ends; each list keeps its own cursor', async ($, on) => {
  const moved = asked(on)
  const seen = await openQueue($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  // The cursor starts on the first row; the keys sit on the hint row in the dock.
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #4042 /)
  expect((await ui.find({ type: 'Button', key: 'next' }))?.props).toMatchObject({ hotkey: 'j', label: 'next', plain: true })
  expect((await ui.find({ type: 'Button', key: 'previous' }))?.props).toMatchObject({ hotkey: 'k', label: 'previous', plain: true })
  expect((await columnOf(ui))[1]).toBe('l: legend j: next k: previous')
  await ui.press({ key: 'next' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ c: #4048 /)
  expect(moved).toEqual(['pull-4048'])
  expect(seen.store['cursor']).toEqual({ queue: 'pull-4048', expanded: NONE_OPEN })
  await ui.press({ key: 'previous' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #4042 /)
  // Stop at the top: no move, no focus asked.
  await ui.press({ key: 'previous' })
  expect(moved).toEqual(['pull-4048', 'pull-4042'])
  // Down through every focusable: the lettered rows, then the two collapsed groups, which are rows of their own.
  for (let i = 0; i < 7; i += 1) await ui.press({ key: 'next' })
  expect(moved.slice(2)).toEqual(['pull-4048', 'pull-4053', 'issues-2499', 'pull-4060', 'pull-4061', 'group-author', 'group-parked'])
  expect(await cursorRow(ui)).toBe('▸ ○ Parked (7) enter opens')
  // Stop at the bottom.
  await ui.press({ key: 'next' })
  expect(moved).toHaveLength(9)
  expect((await columnOf(ui)).filter(row => row.startsWith('▸')).length).toBe(1)
  // The issues view has its own cursor, from its own first row.
  await ui.press({ key: 'issues' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #2499 /)
  await ui.press({ key: 'next' })
  expect(await cursorRow(ui)).toMatch(/^▸ ○ c: #3640 /)
  await ui.press({ key: 'queue' })
  expect(await cursorRow(ui)).toBe('▸ ○ Parked (7) enter opens')
  expect(seen.store['cursor']).toEqual({ queue: 'group-parked', issues: 'issues-3640', expanded: NONE_OPEN })
  // Unfocused, the ▸ still draws: the cursor is state, the ring the engine's.
  const unfocused = await mountPane($, 'desktop', 39, false)
  expect(await cursorRow(unfocused)).toBe('▸ ○ Parked (7) enter opens')
  nothingPosted(seen)
})

test('Enter opens the focused row: the ring sits on the row Button j sent it to, and that Button opens the detail; no key of the mod is enter', async ($, on) => {
  const moved = asked(on)
  const seen = await openQueue($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'next' })
  await ui.press({ key: 'next' })
  expect(moved.at(-1)).toBe('pull-4053')
  await ui.press({ key: 'pull-4053' })
  expect((await columnOf(ui)).some(row => row.startsWith('#4053 '))).toBe(true)
  expect(detailCalls(seen)).toEqual([4053])
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.some((button: any) => /enter/i.test(String(button.props?.label)))).toBe(false)
  nothingPosted(seen)
})

test("Tab and a click sync the cursor: the person's ui.focus on a row or a group moves ▸, one on another key or of a plugin's does not; a click on a row is a move too", async ($, on) => {
  const moved = asked(on)
  const seen = await openQueue($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  await tabbed($, 'pull-4053')
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ d: #4053 /)
  expect(seen.store['cursor']).toEqual({ queue: 'pull-4053', expanded: NONE_OPEN })
  await tabbed($, 'refresh')
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ d: #4053 /)
  await tabbed($, 'pull-4060', 'plugin')
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ d: #4053 /)
  await tabbed($, 'group-author')
  expect(await cursorRow(ui)).toBe('▸ ○ Waiting on the author (6) enter opens')
  // A click (ui.press alone) on a group opens it and rests the cursor there; on a row it opens the detail, and back
  // lands on that row.
  await ui.press({ key: 'group-parked' })
  expect(await cursorRow(ui)).toBe('▸ ○ Parked (7) enter closes')
  await ui.press({ key: 'pull-3909' })
  expect((await columnOf(ui)).some(row => row.startsWith('#3909 '))).toBe(true)
  await ui.press({ key: 'detail-back' })
  expect(await cursorRow(ui)).toMatch(/^▸ ○ v: #3909 /)
  expect(seen.store['cursor']).toEqual({ queue: 'pull-3909', expanded: { queue: ['group-parked'], issues: [] } })
  // I2 pin (mutant H04): the issues view's cursor syncs from a Tab as the queue's does.
  await ui.press({ key: 'issues' })
  await tabbed($, 'issues-3640')
  expect(await cursorRow(ui)).toMatch(/^▸ ○ c: #3640 /)
  // The mod asked the engine for nothing: every move here was the person's, and the replays all reached its hook.
  expect(moved).toEqual([])
  expect(seen.focused.map(one => `${one.origin} ${one.element}`)).toEqual(['person pull-4053', 'person refresh', 'plugin pull-4060', 'person group-author', 'person issues-3640'])
  nothingPosted(seen)
})

test('LETTERS loses a and k: sixteen letters from b, never y, j, k or a; rows past sixteen draw with no letter', async ($, on) => {
  expect(LETTERS).toBe('bcdefghmnstuvwxz')
  expect(LETTERS).toHaveLength(16)
  for (const never of 'ajky') expect(LETTERS).not.toContain(never)
  const seen = await openQueue($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  await opened(ui, 'group-author', 'group-parked')
  const rows = (await ui.findAll({ type: 'Button' })).filter((button: any) => /^(pull|issues)-/.test(String(button.key)))
  expect(rows).toHaveLength(19)
  expect(rows.slice(0, 16).map((button: any) => button.props.hotkey)).toEqual(Array.from(LETTERS))
  expect(rows.slice(16).map((button: any) => button.props.hotkey)).toEqual([undefined, undefined, undefined])
  // The unlettered rows still open their detail on a press (Enter or a click).
  const last = String(rows[18]?.key)
  await ui.press({ key: last })
  expect((await columnOf(ui)).some(row => row.startsWith(`#${last.slice('pull-'.length)} `))).toBe(true)
})

test("collapsed groups: the queue's author and parked, and a long issues section, draw as one row that a press opens in place and closes again, per view", async ($, on) => {
  const seen = await openQueue($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  const group = await ui.find({ type: 'Button', key: 'group-author' })
  expect(group?.props).toMatchObject({ label: 'Waiting on the author (6)', plain: true })
  expect(group?.props.hotkey).toBeUndefined()
  expect(await columnOf(ui)).toContain('○ Waiting on the author (6) enter opens')
  expect(await ui.find({ type: 'Button', key: 'pull-3995' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Waiting on the author (6)' })).toBeUndefined()
  await ui.press({ key: 'group-author' })
  expect(await columnOf(ui)).toContain('▸ ○ Waiting on the author (6) enter closes')
  expect((await ui.find({ type: 'Button', key: 'pull-3995' }))?.props).toMatchObject({ label: '#3995', hotkey: 'm' })
  await ui.press({ key: 'group-author' })
  expect(await ui.find({ type: 'Button', key: 'pull-3995' })).toBeUndefined()
  expect(await columnOf(ui)).toContain('▸ ○ Waiting on the author (6) enter opens')
  // The parked group too; its rows carry no note.
  await ui.press({ key: 'group-parked' })
  expect((await ui.find({ type: 'Button', key: 'pull-3477' }))?.props).toMatchObject({ label: '#3477' })
  // pr-agent's community (1) and reporter (2) sections are short: plain headings, no group row.
  await ui.press({ key: 'issues' })
  expect(await ui.find({ type: 'Button', key: 'group-community' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'group-reporter' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'With the reporter (2)' })).toBeDefined()
  // The queue's state held while the issues showed.
  await ui.press({ key: 'queue' })
  expect(await ui.find({ type: 'Button', key: 'pull-3477' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'pull-3995' })).toBeUndefined()
  // teams-for-linux: ten with the reporter collapse, three for the community do not.
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: TFL, items: [] })
  await seen.clock.settle()
  await ui.press({ key: 'issues' })
  expect((await ui.find({ type: 'Button', key: 'group-reporter' }))?.props.label).toBe('With the reporter (10)')
  expect(await ui.find({ type: 'Button', key: 'group-community' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Open for the community (3)' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'issues-3087' })).toBeUndefined()
  await ui.press({ key: 'group-reporter' })
  expect(await ui.find({ type: 'Button', key: 'issues-3087' })).toBeDefined()
  nothingPosted(seen)
})

test('the detail walks the list it came from: j and k swap to its neighbours, the header says N of M in the group, and back lands on the row shown last', async ($, on) => {
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4048`] = detailFor(4048, 'fix: keep quoted command setting values as strings')
  const ui = await mountPane($, 'terminal', 104, true)
  await ui.press({ key: 'pull-4048' })
  // a opens the board from the detail too.
  expect((await columnOf(ui))[0]).toBe('o: open q: back a: board r: refresh k: ‹ #4042 j: #4053 › 2 of 4 in You owe the next move l: legend')
  expect((await ui.find({ type: 'Button', key: 'detail-next' }))?.props).toMatchObject({ hotkey: 'j', label: '#4053 ›', plain: true })
  expect((await ui.find({ type: 'Button', key: 'detail-previous' }))?.props).toMatchObject({ hotkey: 'k', label: '‹ #4042', plain: true })
  await ui.press({ key: 'detail-next' })
  expect((await columnOf(ui))[0]).toBe('o: open q: back a: board r: refresh k: ‹ #4048 j: #2499 › 3 of 4 in You owe the next move l: legend')
  expect((await columnOf(ui)).some(row => row.startsWith('#4053 '))).toBe(true)
  // The last of the group is an issue: the issue document, and no j.
  await ui.press({ key: 'detail-next' })
  expect((await columnOf(ui))[0]).toBe('o: open q: back a: board r: refresh k: ‹ #4053 j: — › 4 of 4 in You owe the next move l: legend')
  // I2: the key stays bound at the end, as an inert Button, so j never falls through to the prompt (prove fix).
  expect((await ui.find({ type: 'Button', key: 'detail-next' }))?.props).toMatchObject({ label: '— ›', hotkey: 'j', plain: true })
  expect(seen.calls.at(-1)?.argv[4]).toBe(`query=${DETAIL_ISSUE}`)
  expect(detailCalls(seen)).toEqual([4048, 4053, 2499])
  for (let i = 0; i < 3; i += 1) await ui.press({ key: 'detail-previous' })
  expect((await columnOf(ui))[0]).toBe('o: open q: back a: board r: refresh k: ‹ — j: #4048 › 1 of 4 in You owe the next move l: legend')
  // I2: bound and inert at the start too (prove fix).
  expect((await ui.find({ type: 'Button', key: 'detail-previous' }))?.props).toMatchObject({ label: '‹ —', hotkey: 'k', plain: true })
  // Another k does nothing.
  await ui.press({ key: 'detail-previous' }).catch(() => undefined)
  expect(detailCalls(seen)).toEqual([4048, 4053, 2499, 4053, 4048, 4042])
  await ui.press({ key: 'detail-back' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #4042 /)
  expect(seen.store['cursor']).toEqual({ queue: 'pull-4042', expanded: NONE_OPEN })
  // In the dock the neighbours share the key row and the position the hint's.
  const dock = await mountPane($, 'desktop', 39, true)
  await dock.press({ key: 'pull-4042' })
  expect((await columnOf(dock)).slice(0, 2)).toEqual(['o: open q: back a: board r: refresh k: ‹ — j: #4048 ›', 'l: legend 1 of 4 in You owe the next move'])
  await dock.press({ key: 'detail-back' })
  // From the pair, the items are the list and the tab follows the walk.
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  await ui.press({ key: 'detail' })
  expect((await columnOf(ui))[0]).toBe('o: open p: back a: board r: refresh k: ‹ — j: #2450 › 1 of 2 in the pair l: legend')
  await ui.press({ key: 'detail-next' })
  expect((await columnOf(ui))[0]).toBe('o: open p: back a: board r: refresh k: ‹ #4045 j: — › 2 of 2 in the pair l: legend')
  await ui.press({ key: 'detail-back' })
  expect(textOf(await ui.find({ type: 'Box', key: 'tabs-1' }))).toMatch(/^▸/)
  nothingPosted(seen)
})

test('classic.SessionStart after /clear puts the list cursors back from their $.store mirror, and ignores anything else there', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA, cursor: { queue: 'pull-4053', issues: 'drop table', pair: 2 } } })
  // I2e: the pane is placed across /clear, which is what arms the session again and restores the cursors.
  seen.panes = [SHOWN]
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ d: #4053 /)
  // I2 pin (mutant S03): the junk under issues was dropped at the restore, not carried into the next mirror write.
  await ui.press({ key: 'next' })
  expect(seen.store['cursor']).toEqual({ queue: 'issues-2499', expanded: NONE_OPEN })
  await ui.press({ key: 'issues' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #2499 /)
})

// I2 pin (mutant S04): a valid issues cursor comes back too, not only the queue's.
test('classic.SessionStart after /clear puts the issues cursor back', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA, cursor: { queue: 'pull-4053', issues: 'issues-3640' } } })
  // I2e: the pane placed across /clear arms the session again.
  seen.panes = [SHOWN]
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'issues' })
  expect(await cursorRow(ui)).toMatch(/^▸ ○ c: #3640 /)
})

// I2 pin (mutant S02): a session start (a new session, a hot reload) restores the cursors from the same mirror.
test('session.start puts the list cursors back from their $.store mirror', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA, cursor: { queue: 'pull-4053' } } })
  // I2e: a dormant session start restores nothing; the command's arming puts the cursors back from the same mirror.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ d: #4053 /)
})

test('classic.SessionStart with junk under the cursor key leaves the cursor on the first row', async ($, on) => {
  const junk = world(on, { now: QUEUE_NOW, store: { repo: PRA, cursor: 'pull-4053' } })
  // I2e: the pane placed across /clear arms the session again.
  junk.panes = [SHOWN]
  await $.classic.SessionStart({ source: 'clear' })
  await junk.clock.settle()
  await $.turn.complete(TURN)
  await junk.clock.settle()
  const again = await mountPane($, 'desktop', 39, true)
  expect(await cursorRow(again)).toMatch(/^▸ ▲ b: #4042 /)
})

test('master-detail from 120 body columns and not at 119: the column follows the cursor from the queue read, its detail read fires after 600 ms of rest and not before, a move cancels it, and one runs at a time', async ($, on) => {
  // I2 pin (mutant G10): the plan's threshold is 120 body columns; the mounts below derive 119 and 120 from it.
  expect(SIDE_FROM).toBe(120)
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4042`] = detailFor(4042, 'fix(litellm): observe detached stream cleanup failures')
  seen.details[`${PRA}#4053`] = detailFor(4053, 'fix: cap github suggestion body length')
  const narrow = await mountPane($, 'terminal', SIDE_FROM - 1, true)
  expect(await sideOf(narrow)).toBeUndefined()
  await seen.clock.advance(2_000)
  await narrow.press({ key: 'next' })
  await seen.clock.advance(2_000)
  expect(detailCalls(seen)).toEqual([])
  await narrow.unmount()
  const wide = await mountPane($, 'terminal', SIDE_FROM, true)
  // The queue read's facts at once: the cursor is on #4048 after the move above.
  expect(await sideOf(wide)).toEqual(['#4048 fix: keep quoted command setting values as strings', expect.stringMatching(/^@[A-Za-z0-9-]+ · opened 27h · head [0-9a-f]{7}$/)])
  expect(lint(await wide.drawn())).toEqual([])
  expect(detailCalls(seen)).toEqual([])
  await wide.press({ key: 'previous' })
  expect((await sideOf(wide))?.[0]).toBe('#4042 fix(litellm): observe detached stream cleanup failures')
  await seen.clock.advance(599)
  expect(detailCalls(seen)).toEqual([])
  await seen.clock.advance(1)
  expect(detailCalls(seen)).toEqual([4042])
  expect(seen.calls.at(-1)?.argv[4]).toBe(`query=${DETAIL_PR}`)
  const side = (await sideOf(wide)) ?? []
  expect(side.slice(0, 5)).toEqual([
    '#4042 fix(litellm): observe detached stream cleanup failures',
    '@PeterDaveHello · opened 36h · head e5baaf2',
    '○ open',
    '✓ CI passed · +181 −1',
    expect.stringMatching(/^@jadhavgaurav · opened [0-9]+d · head ce5ba15 · bug/),
  ])
  expect(side.some(row => row.startsWith('✓ you APPROVED '))).toBe(true)
  expect(side).toContain('Fixes #3994.')
  expect(side.some(row => /more rows: enter opens the detail/.test(row))).toBe(true)
  expect(lint(await wide.drawn())).toEqual([])
  // A move inside the rest cancels the read: two moves 300 ms apart read once, 600 ms after the last.
  await wide.press({ key: 'next' })
  await seen.clock.advance(300)
  await wide.press({ key: 'next' })
  await seen.clock.advance(300)
  expect(detailCalls(seen)).toEqual([4042])
  await seen.clock.advance(300)
  expect(detailCalls(seen)).toEqual([4042, 4053])
  expect((await sideOf(wide))?.[3]).toBe('✓ CI passed · +181 −1')
  // One at a time: a slow read of #2499 still running when the cursor rests on #4060 is left to land (and dropped,
  // the cursor having moved on), and #4060 is read after one more rest.
  seen.modes[`detail ${PRA}#2499`] = { kind: 'slow', ms: 3_000 }
  await wide.press({ key: 'next' })
  await seen.clock.advance(600)
  expect(detailCalls(seen)).toEqual([4042, 4053, 2499])
  await wide.press({ key: 'next' })
  await seen.clock.advance(600)
  expect(detailCalls(seen)).toEqual([4042, 4053, 2499])
  await seen.clock.advance(2_400)
  expect(detailCalls(seen)).toEqual([4042, 4053, 2499])
  await seen.clock.advance(600)
  expect(detailCalls(seen)).toEqual([4042, 4053, 2499, 4060])
  expect((await sideOf(wide))?.[0]).toMatch(/^#4060 /)
  // A failed read says so beside the queue's facts and is not retried until the cursor moves.
  expect(await sideOf(wide)).toContain('▲ detail unknown: GitHub error')
  await seen.clock.advance(5_000)
  expect(detailCalls(seen)).toHaveLength(4)
  // A group row has no item to read.
  await wide.press({ key: 'next' })
  await wide.press({ key: 'next' })
  expect(await sideOf(wide)).toEqual(['a group: enter opens or closes it'])
  await seen.clock.advance(1_000)
  expect(detailCalls(seen)).toHaveLength(4)
  nothingPosted(seen)
})

test('Q8: the QUEUE document carries the state of the viewer\'s last review, and a PR the viewer approved that is still open is owed', async ($, on) => {
  expect(QUEUE).toContain('mine: reviews(last: 1, author: $me, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { state submittedAt commit { oid } } }')
  const approved: any = pull(1, { reviews: [{ login: VIEWER_LOGIN, as: 'MEMBER', hour: 3 }] })
  approved.mine.nodes[0].state = 'APPROVED'
  // I2-S3: an approval reads so only while it covers the head.
  approved.mine.nodes[0].commit.oid = approved.headRefOid
  const commented: any = pull(2, { reviews: [{ login: VIEWER_LOGIN, as: 'MEMBER', hour: 3 }] })
  commented.mine.nodes[0].state = 'COMMENTED'
  const unknown = pull(3, { reviews: [{ login: VIEWER_LOGIN, as: 'MEMBER', hour: 3 }] })
  const read = queueReadOf(answerOf([approved, commented, unknown]), VIEWER_LOGIN, PRA, { json: answerOf([]) }, { failed: 'GitHub error' })
  if (typeof read === 'string') throw new Error(read)
  expect(read.prs.map(pr => [pr.group, pr.isApproved])).toEqual([['owe', true], ['author', undefined], ['author', undefined]])
  const model = queueModelOf({ repo: PRA, at: 0, read, board: 'none' })
  expect(model?.prs.find(heading => heading.key === 'owe')?.rows).toEqual([expect.objectContaining({ number: 1, note: 'approved' })])
  expect(model?.counts).toMatchObject({ owe: 1, author: 2 })
  // Live: #4049 approved by the viewer moves from the author group to You owe, the owe pill and next pick it up.
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  const answer = clone(seen.queues[PRA])
  const pr = answer.data.repository.pullRequests.nodes.find((node: any) => node.number === 4049)
  pr.mine = { nodes: [{ state: 'APPROVED', submittedAt: '2026-10-11T07:00:00Z', commit: { oid: pr.headRefOid } }] }
  seen.queues[PRA] = answer
  await $.command.run(TYPED)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  const column = await columnOf(ui)
  expect(column[2]).toBe(' YOU OWE 5  next: #4042')
  expect(column).toContain('▲ d: #4049 fix(jira): add require_project_keys to scope lookups (#3887) approved · 17h')
  expect(seen.status.at(-1)).toBe('pr-agent · ◆ 5 your move · ▲ 2 new · 18 PRs · 12 issues')
  await opened(ui, 'group-author')
  expect((await ui.find({ type: 'Button', key: 'group-author' }))?.props.label).toBe('Waiting on the author (5)')
})

// Every Button's hotkey in a drawn tree, in document order.
function hotkeysOf(node: unknown, found: string[] = []): string[] {
  const element = node as Drawn
  if (element === null || typeof element !== 'object') return found
  if (element.type === 'Button' && element.props?.hotkey !== undefined) found.push(String(element.props.hotkey))
  for (const child of element.children ?? []) hotkeysOf(child, found)
  return found
}

test('lint: no view draws two Buttons with one hotkey (the later would win silently) at 39, 104 and 130 columns on both surfaces', async ($, on) => {
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4048`] = detailFor(4048, 'fix: keep quoted command setting values as strings')
  let checked = 0
  const unique = async (ui: any, what: string) => {
    const keys = hotkeysOf(await ui.drawn())
    const twice = keys.filter((key, i) => keys.indexOf(key) !== i)
    expect(twice, `${what}: ${keys.join(' ')}`).toEqual([])
    expect(keys.length, what).toBeGreaterThan(0)
    checked += 1
  }
  // I5: a pair tree binds h to hold and s to the status rows alone, and m, d and y (I7's) to nothing.
  const reserved = async (ui: any, what: string) => {
    const keys = hotkeysOf(await ui.drawn())
    expect(keys.filter(key => PAIR_RESERVED.includes(key)), `${what}: ${keys.join(' ')}`).toEqual(['h', 's'])
    expect((await ui.find({ type: 'Button', key: 'hold' }))?.props.hotkey, what).toBe('h')
    expect((await ui.find({ type: 'Button', key: 'details' }))?.props.hotkey, what).toBe('s')
  }
  for (const surface of SURFACES) {
    for (const columns of [39, 104, 130]) {
      const ui = await mountPane($, surface, columns, true)
      await unique(ui, `queue ${surface} ${columns}`)
      await opened(ui, 'group-author', 'group-parked')
      await unique(ui, `queue opened ${surface} ${columns}`)
      await ui.press({ key: 'legend' })
      await unique(ui, `queue legend ${surface} ${columns}`)
      if (columns === 130) expect(lint(await ui.drawn()), `queue ${surface}`).toEqual([])
      await ui.press({ key: 'legend' })
      await ui.press({ key: 'issues' })
      await unique(ui, `issues ${surface} ${columns}`)
      if (columns === 130) expect(lint(await ui.drawn()), `issues ${surface}`).toEqual([])
      await ui.press({ key: 'queue' })
      await ui.press({ key: 'pull-4048' })
      await unique(ui, `detail ${surface} ${columns}`)
      await ui.press({ key: 'legend' })
      await unique(ui, `detail legend ${surface} ${columns}`)
      await ui.press({ key: 'legend' })
      await ui.press({ key: 'detail-back' })
      await $.tool.call({ tool: TOOL, tool_use_id: `c-${surface}-${columns}`, ...PAIR })
      for (const tab of [0, 1]) {
        await ui.press({ key: `tab-${tab}` })
        await unique(ui, `pair tab ${tab} ${surface} ${columns}`)
        await reserved(ui, `pair tab ${tab} ${surface} ${columns}`)
      }
      await ui.press({ key: 'legend' })
      await unique(ui, `pair legend ${surface} ${columns}`)
      await reserved(ui, `pair legend ${surface} ${columns}`)
      await ui.press({ key: 'legend' })
      await ui.press({ key: 'detail' })
      await unique(ui, `detail from pair ${surface} ${columns}`)
      await ui.press({ key: 'detail-back' })
      await $.tool.call({ tool: TOOL, tool_use_id: `clear-${surface}-${columns}`, repo: PRA, items: [] })
      await seen.clock.advance(MINUTE)
      await ui.unmount()
    }
  }
  expect(checked).toBe(2 * 3 * 10)
  nothingPosted(seen)
})

// I2 pin (mutant C09): a collapsible group with no rows is not drawn, so its row is no focusable either.
test('an empty collapsible group has no row for the cursor', () => {
  const read = queueReadOf(answerOf([pull(1)]), VIEWER_LOGIN, PRA, { json: answerOf([]) }, { failed: 'GitHub error' })
  if (typeof read === 'string') throw new Error(read)
  expect(focusablesOf(queueModelOf({ repo: PRA, at: 0, read, board: 'none' }), 'queue', [])).toEqual(['pull-1'])
})

// I2 pin (mutant G07): a rest armed by the list does not read while the detail shows.
test('no side read fires while the detail shows', async ($, on) => {
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4048`] = detailFor(4048, 'fix: keep quoted command setting values as strings')
  const ui = await mountPane($, 'terminal', 130, true)
  await ui.press({ key: 'pull-4048' })
  await seen.clock.advance(2_000)
  expect(detailReads(seen)).toEqual([`${PRA}#4048`])
})

// I2 pin (mutant Q05): an approval with no submittedAt fails closed: owed, not standing.
test('an approval GitHub sent without submittedAt is owed but does not stand', () => {
  const missing: any = pull(7, { reviews: [{ login: VIEWER_LOGIN, as: 'MEMBER', hour: 3 }] })
  missing.mine.nodes[0].state = 'APPROVED'
  missing.mine.nodes[0].commit.oid = missing.headRefOid
  delete missing.mine.nodes[0].submittedAt
  const read = queueReadOf(answerOf([missing]), VIEWER_LOGIN, PRA, { json: answerOf([]) }, { failed: 'GitHub error' })
  if (typeof read === 'string') throw new Error(read)
  expect(read.prs.map(pr => [pr.group, pr.isApproved])).toEqual([['owe', undefined]])
})

// The detail reads, each as "owner/name#number", in order.
const detailReads = (seen: World) => seen.calls.filter(call => call.argv[4] === `query=${DETAIL_PR}` || call.argv[4] === `query=${DETAIL_ISSUE}`).map(call => cardKey(call.argv))

test('I2-R1: presses that arrive together each move one row: three j at once land three rows on, in a list and in the detail', async ($, on) => {
  const moved = asked(on)
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4042`] = detailFor(4042, 'fix(litellm): observe detached stream cleanup failures')
  seen.details[`${PRA}#4048`] = detailFor(4048, 'fix: keep quoted command setting values as strings')
  seen.details[`${PRA}#4053`] = detailFor(4053, 'fix: cap github suggestion body length')
  const ui = await mountPane($, 'terminal', 104, true)
  // A burst (key auto-repeat, or presses the engine dispatched in one batch) is serialised by the compare-and-swap
  // update: each press steps from the row the one before it landed on.
  await Promise.all([ui.press({ key: 'next' }), ui.press({ key: 'next' }), ui.press({ key: 'next' })])
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ e: #2499 /)
  expect(moved).toEqual(['pull-4048', 'pull-4053', 'issues-2499'])
  expect(seen.store['cursor']).toEqual({ queue: 'issues-2499', expanded: NONE_OPEN })
  await Promise.all([ui.press({ key: 'previous' }), ui.press({ key: 'previous' }), ui.press({ key: 'previous' })])
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #4042 /)
  // In the detail, two j at once swap twice.
  await ui.press({ key: 'pull-4042' })
  await Promise.all([ui.press({ key: 'detail-next' }), ui.press({ key: 'detail-next' })])
  expect((await columnOf(ui))[0]).toBe('o: open q: back a: board r: refresh k: ‹ #4048 j: #2499 › 3 of 4 in You owe the next move l: legend')
  expect((await columnOf(ui)).some(row => row.startsWith('#4053 '))).toBe(true)
  expect(detailCalls(seen)).toEqual([4042, 4048, 4053])
  await ui.press({ key: 'detail-back' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ d: #4053 /)
  nothingPosted(seen)
})

test('I2-R3: the master-detail column is pinned to the window, not the tree: it sits offset rows down and holds at most the window\'s rows', async ($, on) => {
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4042`] = detailFor(4042, 'fix(litellm): observe detached stream cleanup failures')
  const scrolled = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: { ...paneProps(130, true), scroll: { offset: 5, bodyRows: 6 } } })
  const sideBox = async (ui: any) => ((await ui.drawn()) as Drawn).children?.[1]
  expect((await sideBox(scrolled))?.props?.marginTop).toBe(5)
  await seen.clock.advance(600)
  expect(detailCalls(seen)).toEqual([4042])
  const rows = (await sideOf(scrolled)) ?? []
  expect(rows[0]).toBe('#4042 fix(litellm): observe detached stream cleanup failures')
  expect(rows).toHaveLength(6)
  expect((await sideBox(scrolled))?.children).toHaveLength(6)
  await scrolled.unmount()
  const top = await mountPane($, 'terminal', 130, true)
  expect((await sideBox(top))?.props?.marginTop).toBe(0)
  expect(((await sideOf(top)) ?? []).length).toBeGreaterThan(6)
  nothingPosted(seen)
})

test('I2-S4: a move back onto the row the side column already holds cancels the pending read', async ($, on) => {
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4042`] = detailFor(4042, 'fix(litellm): observe detached stream cleanup failures')
  const ui = await mountPane($, 'terminal', 130, true)
  await seen.clock.advance(600)
  expect(detailCalls(seen)).toEqual([4042])
  await ui.press({ key: 'next' })
  await seen.clock.advance(300)
  await ui.press({ key: 'previous' })
  await seen.clock.advance(1_000)
  expect(detailCalls(seen)).toEqual([4042])
  expect((await sideOf(ui))?.[2]).toBe('○ open')
  // The re-arm after a flight too (R4): a rest that ended while #2499's slow read ran rests again once it lands, and
  // the cursor is back on #2499. The landing's own drawing finds the column holding the row and disarms that rest;
  // readSide's own guard (a held card is not read again) stands behind it and is not reached here.
  seen.modes[`detail ${PRA}#2499`] = { kind: 'slow', ms: 3_000 }
  for (let i = 0; i < 3; i += 1) await ui.press({ key: 'next' })
  await seen.clock.advance(600)
  expect(detailCalls(seen)).toEqual([4042, 2499])
  await ui.press({ key: 'next' })
  await seen.clock.advance(600)
  await ui.press({ key: 'previous' })
  await seen.clock.advance(3_000)
  // The issue has no recorded detail here: its card is a failed one, held like a landed one.
  expect((await sideOf(ui))?.[2]).toBe('▲ detail unknown: GitHub error')
  await seen.clock.advance(1_000)
  expect(detailCalls(seen)).toEqual([4042, 2499])
  nothingPosted(seen)
})

test('I2-S5, I2-R4: back from the detail seeds the side column from the detail read, so the item is not read again; a read not landed is not seeded', async ($, on) => {
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4042`] = detailFor(4042, 'fix(litellm): observe detached stream cleanup failures')
  seen.details[`${PRA}#4048`] = detailFor(4048, 'fix: keep quoted command setting values as strings')
  const ui = await mountPane($, 'terminal', 130, true)
  await seen.clock.advance(600)
  expect(detailReads(seen)).toEqual([`${PRA}#4042`])
  await ui.press({ key: 'pull-4048' })
  expect(detailReads(seen)).toEqual([`${PRA}#4042`, `${PRA}#4048`])
  await ui.press({ key: 'detail-back' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ c: #4048 /)
  expect(((await sideOf(ui)) ?? []).slice(0, 4)).toEqual([
    '#4048 fix: keep quoted command setting values as strings',
    expect.stringMatching(/^@[A-Za-z0-9-]+ · opened 27h · head [0-9a-f]{7}$/),
    '○ open',
    '✓ CI passed · +181 −1',
  ])
  await seen.clock.advance(1_000)
  expect(detailReads(seen)).toEqual([`${PRA}#4042`, `${PRA}#4048`])
  // From the issues view (the live case: the stray frame between the detail and the list computes the queue's row).
  await ui.press({ key: 'issues' })
  await seen.clock.advance(600)
  expect(detailReads(seen)).toEqual([`${PRA}#4042`, `${PRA}#4048`, `${PRA}#2499`])
  await ui.press({ key: 'issues-2499' })
  await ui.press({ key: 'detail-back' })
  await seen.clock.advance(1_000)
  expect(detailReads(seen)).toEqual([`${PRA}#4042`, `${PRA}#4048`, `${PRA}#2499`, `${PRA}#2499`])
  // A read still running when back is pressed: the side is not seeded with an empty card, and reads after the rest.
  seen.modes[`detail ${PRA}#4042`] = { kind: 'slow', ms: 3_000 }
  await ui.press({ key: 'queue' })
  await ui.press({ key: 'previous' })
  await ui.press({ key: 'pull-4042' })
  await seen.clock.advance(100)
  await ui.press({ key: 'detail-back' })
  expect(((await sideOf(ui)) ?? []).slice(2)).toEqual([])
  await seen.clock.advance(600)
  expect(((await sideOf(ui)) ?? []).slice(2)).toEqual(['reading GitHub…'])
  await seen.clock.advance(3_000)
  expect(detailReads(seen).filter(key => key === `${PRA}#4042`)).toHaveLength(3)
  expect((await sideOf(ui))?.[2]).toBe('○ open')
  nothingPosted(seen)
})

test('I2-S1: after a repo change, j walks nothing and the side column reads nothing until the new queue lands', async ($, on) => {
  const moved = asked(on)
  const seen = await openQueue($, on)
  seen.details[`${PRA}#4042`] = detailFor(4042, 'fix(litellm): observe detached stream cleanup failures')
  const ui = await mountPane($, 'terminal', 130, true)
  await ui.press({ key: 'next' })
  await seen.clock.advance(600)
  expect(detailReads(seen)).toEqual([`${PRA}#4048`])
  seen.modes['queue'] = { kind: 'slow', ms: 5_000 }
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: TFL, items: [] })
  await seen.clock.advance(1)
  await ui.press({ key: 'next' })
  await seen.clock.advance(700)
  expect(await cursorRow(ui)).toBeUndefined()
  expect(moved).toEqual(['pull-4048'])
  expect(seen.store['cursor']).toEqual({ queue: 'pull-4048', expanded: NONE_OPEN })
  expect(detailReads(seen)).toEqual([`${PRA}#4048`])
  await seen.clock.advance(5_000)
  expect(await cursorRow(ui)).toMatch(/^▸ /)
  expect(seen.store['cursor']).toEqual({ queue: 'pull-4048', expanded: NONE_OPEN })
  nothingPosted(seen)
})

test('I2-S2: the cursor mirror carries the opened groups with the cursors', async ($, on) => {
  const seen = await openQueue($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'group-parked' })
  await ui.press({ key: 'next' })
  expect(await cursorRow(ui)).toMatch(/^▸ ○ h: #3477 /)
  expect(seen.store['cursor']).toEqual({ queue: 'pull-3477', expanded: { queue: ['group-parked'], issues: [] } })
  await ui.press({ key: 'group-parked' })
  expect(seen.store['cursor']).toEqual({ queue: 'group-parked', expanded: NONE_OPEN })
  nothingPosted(seen)
})

test('I2-S2, I2-R5: classic.SessionStart puts a cursor inside a collapsed group back with its group open, and drops junk among the groups', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA, cursor: { queue: 'pull-3995', expanded: { queue: ['group-author', 'drop table', 7], issues: 'junk' } } } })
  // I2e: the pane placed across /clear arms the session again.
  seen.panes = [SHOWN]
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  expect(await cursorRow(ui)).toMatch(/^▸ ○ m: #3995 /)
  expect(await columnOf(ui)).toContain('○ Waiting on the author (6) enter closes')
  expect(await columnOf(ui)).toContain('○ Parked (7) enter opens')
  // I2 pin (mutant S05): the junk among the groups was dropped at the restore, not carried into the next mirror write.
  await ui.press({ key: 'next' })
  expect(seen.store['cursor']).toEqual({ queue: 'pull-4043', expanded: { queue: ['group-author'], issues: [] } })
  await ui.press({ key: 'issues' })
  expect(await cursorRow(ui)).toMatch(/^▸ ▲ b: #2499 /)
})

test('I2-S3: isApproved is a standing approval, on the head and the last word; one the author pushed past or spoke after keeps the PR owed but reads back', async () => {
  const onHead = (pr: any) => {
    pr.mine.nodes[0].state = 'APPROVED'
    pr.mine.nodes[0].commit.oid = pr.headRefOid
    return pr
  }
  const viewer = { login: VIEWER_LOGIN, as: 'MEMBER' as const, hour: 3 }
  const pushed: any = pull(1, { reviews: [viewer], commit: { login: 'contributor', hour: 5 } })
  pushed.mine.nodes[0].state = 'APPROVED'
  const spoken = onHead(pull(5, { reviews: [viewer], comments: [{ login: 'contributor', hour: 6 }] }))
  const standing = onHead(pull(6, { reviews: [viewer] }))
  const read = queueReadOf(answerOf([pushed, spoken, standing]), VIEWER_LOGIN, PRA, { json: answerOf([]) }, { failed: 'GitHub error' })
  if (typeof read === 'string') throw new Error(read)
  expect(read.prs.map(pr => [pr.number, pr.group, pr.isApproved])).toEqual([
    [1, 'owe', undefined],
    [5, 'owe', undefined],
    [6, 'owe', true],
  ])
  const model = queueModelOf({ repo: PRA, at: 0, read, board: 'none' })
  expect(model?.prs.find(heading => heading.key === 'owe')?.rows.map(row => [row.number, row.note])).toEqual([
    [1, 'back'],
    [5, 'back'],
    [6, 'approved'],
  ])
})
