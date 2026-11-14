import { expect, test } from 'claude-code/testing'

import { DETAIL_ISSUE, DETAIL_PR, detailOf, mergeDetail } from '../hooks/github'
import { DETAIL_NOW, PR_3995 } from './detail-fixtures'
import { HOSTILE_TITLE, PR_3995_DRAFT, PR_3995_HOSTILE_TITLE, PR_3995_LABELLED, PR_3995_MERGED } from './detail-gaps-fixtures'
import { PRA, REAL, SHOWN, TYPED, clone, ghCalls, hhmm, mountPane, paneProps, queueCalls, textOf, world, opened as openGroup } from './world'
import type { World } from './world'

// I2: #3995 sits under the queue's author group, which draws collapsed, so every press of its row opens the group first
// (openGroup), as Enter on the group row does.

// I0: the detail view's behaviours the I2b mutation run left untested. Each test here goes red under one mutation of
// the shipped hooks, named beside it; the helpers mirror detail.test.ts so the two files never need each other.
const MINUTE = 60_000
const PR_KEY = `detail ${PRA}#3995`
const ASOF = hhmm(DETAIL_NOW)
const PR_FACTS = '✓ CI passed  +181 −1'

// The words of a drawn node with its parts spaced, a plain Button as the terminal paints it ('o: open').
function wordsOf(node: unknown): string {
  const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (typeof node === 'string') return node
  if (element?.type === 'Button') {
    const label = String(element.props?.label ?? '')
    return element.props?.hotkey === undefined ? label : `${String(element.props.hotkey)}: ${label}`
  }
  if (element?.type === 'Text') return textOf(node)
  return (element?.children ?? []).map(wordsOf).filter(words => words !== '').join(' ')
}

async function columnOf(ui: any): Promise<string[]> {
  const root = (await ui.drawn()) as { children?: unknown[] }
  return (root.children ?? []).map(wordsOf)
}

const detailCalls = (seen: World) => seen.calls.filter(call => call.argv[4] === `query=${DETAIL_PR}` || call.argv[4] === `query=${DETAIL_ISSUE}`)

// The person opens the queue with /review-pair on the day the detail answers were recorded.
async function queued($: any, on: any): Promise<World> {
  const seen = world(on, { now: DETAIL_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  return seen
}

const withPr = (seen: World, change: (pr: any) => void) => {
  const answer = clone(PR_3995)
  change(answer.data.repository.pullRequest)
  seen.details[`${PRA}#3995`] = answer
}

// I2d: the detail is as tall as its text, so a test reading Latest mounts a pane tall enough to hold the whole of it.
const TALL_ROWS = 2_000
const mountTall = ($: any, columns: number) => {
  const props = paneProps(columns, true)
  return $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: { ...props, scroll: { offset: 0, bodyRows: TALL_ROWS } } })
}
// The head rows of a Latest list: a body's rows sit two columns in, so they never match.
const heads = (rows: string[]) => rows.filter(text => /^[✓✗○●] (you|author|@)/.test(text))

// The PR detail opened in the 39-column dock (or a tall pane of that width), its column of rows.
async function openedPr($: any, seen: World, columns = 39, isTall = false): Promise<{ ui: any; column: string[] }> {
  const ui = isTall ? await mountTall($, columns) : await mountPane($, 'terminal', columns, true)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  return { ui, column: await columnOf(ui) }
}

// A read that answers the PR with a part null, as gh prints a partial answer: exit 1, the JSON whole on stdout.
const partial = (seen: World, change: (pr: any) => void) => {
  const answer = clone(PR_3995)
  change(answer.data.repository.pullRequest)
  answer.errors = [{ type: 'SERVICE_UNAVAILABLE', path: ['repository', 'pullRequest'], message: 'part timed out' }]
  seen.modes[PR_KEY] = { kind: 'exit', exitCode: 1, stderr: 'gh: part timed out', stdout: JSON.stringify(answer) }
}

// The glyphs of the dock's facts row (state, then CI) with their colours: the drawn tree keeps a Text's colour, not its key.
// I1: the attention line sits between the legend key and the title, so every row from the title down is one lower
// than I0 first read it (the dock's title is row 3, its facts row 4, its byline row 5).
async function factsGlyphs(ui: any): Promise<{ glyph: string; color: unknown }[]> {
  const root = (await ui.drawn()) as { children?: unknown[] }
  const facts = root.children?.[4] as { children?: unknown[] } | undefined
  return (facts?.children ?? [])
    .filter((part): part is { type: string; props?: { color?: unknown } } => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'Text')
    .map(part => ({ glyph: textOf(part), color: part.props?.color }))
}

const scrollOf = ($: any) => (by: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset: 0, by, bodyRows: 11, contentRows: 11, origin: { kind: 'person' } } as any)

// Mutations: github.ts CI_STATES fallback `?? 'unknown'` → `?? 'passed'`; views.tsx CI_WORDS unknown → ['ok', 'CI passed'].
test('P34: an unknown CI (no commit node, a null rollup, an unknown or missing rollup state) is never drawn as CI passed', async ($, on) => {
  const seen = await queued($, on)
  const cases: [(pr: any) => void, string, string][] = [
    [pr => (pr.commits = { nodes: [] }), 'unknown', 'CI unknown'],
    [pr => (pr.commits = null), 'unknown', 'CI unknown'],
    [pr => (pr.commits.nodes[0].commit.statusCheckRollup = null), 'not-run', 'CI has not run'],
    [pr => (pr.commits.nodes[0].commit.statusCheckRollup = { state: 'SOMETHING_NEW' }), 'unknown', 'CI unknown'],
    [pr => (pr.commits.nodes[0].commit.statusCheckRollup = {}), 'unknown', 'CI unknown'],
  ]
  const read: string[] = []
  const drawn: string[] = []
  const colours: unknown[] = []
  for (const [change] of cases) {
    const answer = clone(PR_3995)
    change(answer.data.repository.pullRequest)
    read.push(String((detailOf(answer, 'pr', 3995, DETAIL_NOW) as any).ci))
    seen.details[`${PRA}#3995`] = answer
    const { ui, column } = await openedPr($, seen)
    drawn.push(column[4] ?? '')
    colours.push((await factsGlyphs(ui))[1])
    expect(column.join('\n')).not.toMatch(/CI passed/)
    expect(column[3]).toMatch(/^#3995 fix\(gitlab\)/)
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
  expect(read).toEqual(cases.map(([, ci]) => ci))
  expect(drawn).toEqual(cases.map(([, , words]) => `○ open  ▲ ${words}  +181 −1`))
  expect(colours).toEqual(cases.map(() => ({ glyph: '▲', color: 'warning' })))
  // The recording's SUCCESS rollup is the one shape that reads passed.
  expect((detailOf(PR_3995, 'pr', 3995, DETAIL_NOW) as any).ci).toBe('passed')
})

// Mutation: github.ts DETAIL_PR `files(first: 8)` → `files(first: 30)`.
test('D01: the PR document asks for the windows the view draws: 8 files, the last 5 comments, the last 20 reviews, 5 labels', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.files = { totalCount: 12, nodes: Array.from({ length: 8 }, (_, i) => ({ path: `src/${i}.py`, additions: i, deletions: 0 })) }
  })
  const { ui } = await openedPr($, seen)
  const asked = detailCalls(seen).map(call => String(call.argv[4]))
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatch(/\n {6}files\(first: 8\) \{ totalCount nodes \{ path additions deletions \} \}\n/)
  expect(asked[0]).toMatch(/\n {6}comments\(last: 5\) \{ totalCount nodes \{ author \{ login __typename \} createdAt body \} \}\n/)
  expect(asked[0]).toMatch(/\n {6}reviews\(last: 20, states: \[APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED\]\) \{ totalCount nodes \{ author \{ login __typename \} state submittedAt body \} \}\n/)
  expect(asked[0]).toMatch(/\n {6}labels\(first: 5\) \{ totalCount nodes \{ name \} \}\n/)
  expect(asked[0]).not.toMatch(/first: (?!8\)|5\))[0-9]+\)/)
  // The window read is drawn whole, and the rest counted.
  await scrollOf($)(1_000)
  const column = await columnOf(ui)
  const files = column.slice(column.indexOf('Files (12)') + 1)
  expect(files).toEqual([...Array.from({ length: 8 }, (_, i) => `src/${i}.py +${i} −0`), '(+4 more)'])
})

// Mutation: github.ts DETAIL_PR `comments(last: 5)` → `comments(first: 5)`.
test('D02: both documents ask for the last five comments, the newest, never the first five', async ($, on) => {
  const seen = await queued($, on)
  const { ui } = await openedPr($, seen, 39, true)
  await ui.press({ key: 'detail-back' })
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  const asked = detailCalls(seen).map(call => String(call.argv[4]))
  expect(asked).toEqual([`query=${DETAIL_PR}`, `query=${DETAIL_ISSUE}`])
  for (const document of asked) {
    expect(document).toMatch(/\n {6}comments\(last: 5\) \{/)
    expect(document).not.toMatch(/comments\(first/)
  }
  // And the five read are drawn newest first: the issue's newest comment leads its Latest, its words under its head.
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  expect(column[latest + 1]).toBe('○ @utsab345 comment 1h')
  expect(column[latest + 2]).toMatch(/^  @IsmaelMartinez I do not have an/)
})

// Mutation: github.ts DETAIL_ISSUE loses its `viewer { login }` line.
test('D04: the issue document carries the viewer, so the maintainer\'s own comment reads you', async ($, on) => {
  const seen = await queued($, on)
  const ui = await mountTall($, 39)
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  const asked = detailCalls(seen).map(call => String(call.argv[4]))
  expect(asked).toEqual([`query=${DETAIL_ISSUE}`])
  expect(asked[0]).toMatch(/^query=query IssueDetail\([^)]*\) \{\n {2}viewer \{ login \}\n {2}repository\(/)
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  const you = column.indexOf('○ you comment 1h')
  expect(you).toBeGreaterThan(latest + 1)
  expect(column[you + 1]).toMatch(/^  Yes please, and thanks/)
  expect(heads(column.slice(latest + 1))).toEqual([
    '○ @utsab345 comment 1h',
    '○ you comment 1h',
    '○ @utsab345 comment 2h',
    '○ you comment 2d',
    '○ @utsab345 comment 3d',
  ])
})

// Mutation: github.ts DETAIL_ISSUE `labels(first: 5)` → `labels(first: 10)`.
test('D05: both documents ask for five labels, the byline\'s window, never more', async ($, on) => {
  const seen = await queued($, on)
  const { ui } = await openedPr($, seen)
  await ui.press({ key: 'detail-back' })
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  const asked = detailCalls(seen).map(call => String(call.argv[4]))
  expect(asked).toHaveLength(2)
  for (const document of asked) {
    expect(document).toMatch(/\n {6}labels\(first: 5\) \{ totalCount nodes \{ name \} \}\n/)
    expect(document.match(/labels\(/g)).toHaveLength(1)
  }
})

// Mutation: github.ts descriptionOf `isGap = shown > 0` → `isGap = true`.
test('P04: a body opening with a template comment does not start with an empty row', async ($, on) => {
  const seen = await queued($, on)
  const body = '<!-- Describe your change -->\n\n\nFixes #3994.\n\nMore words.'
  withPr(seen, pr => {
    pr.body = body
  })
  const answer = clone(PR_3995)
  answer.data.repository.pullRequest.body = body
  expect((detailOf(answer, 'pr', 3995, DETAIL_NOW) as any).description.value).toEqual({ lines: ['Fixes #3994.', '', 'More words.'], more: 0 })
  const { column } = await openedPr($, seen)
  const description = column.indexOf('Description')
  expect(column.slice(description + 1, description + 5)).toEqual(['Fixes #3994.', ' ', 'More words.', 'Latest'])
})

// Mutations (I2d, firstLine gone): github.ts bodyOf keeps a leading blank line (its `continue` dropped), or reads the body
// with its HTML comments (`uncommented(body)` → `body`).
test('P09: an entry opening with blank lines or a comment starts at its first non-blank line, and such a COMMENT review is no shell', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.reviews.nodes.push({
      author: { login: 'qodo-free-for-open-source-projects', __typename: 'Bot' },
      state: 'COMMENTED',
      submittedAt: '2026-10-11T17:00:00Z',
      body: '<!-- qodo suggestions -->\n\n## PR Code Suggestions\n\n| Category | Suggestion |',
    })
    pr.comments.nodes.push({ author: { login: 'itsvrushabh', __typename: 'User' }, createdAt: '2026-10-11T17:30:00Z', body: '\n\n   Looks good after the rename.\nSecond line.' })
  })
  const { column } = await openedPr($, seen, 39, true)
  const latest = column.indexOf('Latest')
  expect(column.slice(latest + 1, latest + 9)).toEqual([
    '○ @itsvrushabh comment 25m',
    '     Looks good after the rename.',
    '  Second line.',
    '○ @qodo-free-for-… bot COMMENT 55m',
    '  ## PR Code Suggestions',
    ' ',
    '  | Category | Suggestion |',
    '✓ you APPROVED 2h',
  ])
})

// Mutation: github.ts stateOf `item.isDraft === true ? 'draft' : 'open'` → `'open'`.
test('P19: a draft PR reads draft with the amber glyph', async ($, on) => {
  const seen = await queued($, on)
  seen.details[`${PRA}#3995`] = PR_3995_DRAFT
  expect((detailOf(PR_3995_DRAFT, 'pr', 3995, DETAIL_NOW) as any).state).toBe('draft')
  const { column } = await openedPr($, seen)
  expect(column[4]).toBe(`▲ draft  ${PR_FACTS}`)
  expect(column.join('\n')).not.toMatch(/○ open/)
})

// Mutation: github.ts stateOf `item.state === 'MERGED' ? 'merged'` → `? 'closed'`.
test('P20: a merged PR reads merged with the merged glyph', async ($, on) => {
  const seen = await queued($, on)
  seen.details[`${PRA}#3995`] = PR_3995_MERGED
  expect((detailOf(PR_3995_MERGED, 'pr', 3995, DETAIL_NOW) as any).state).toBe('merged')
  const { ui, column } = await openedPr($, seen)
  expect(column[4]).toBe(`● merged  ${PR_FACTS}`)
  expect((await factsGlyphs(ui))[0]).toEqual({ glyph: '●', color: 'merged' })
})

// Mutation: views.tsx bylineOf drops the ` +N` past the window.
test('P25: the byline shows +N labels when GitHub holds more than the window', async ($, on) => {
  const seen = await queued($, on)
  seen.details[`${PRA}#3995`] = PR_3995_LABELLED
  expect((detailOf(PR_3995_LABELLED, 'pr', 3995, DETAIL_NOW) as any).labels).toEqual({ names: ['bug', 'two', 'three', 'four', 'five'], total: 7 })
  const { column } = await openedPr($, seen, 104)
  expect(column[3]).toBe(`@jadhavgaurav · opened 3d · head ce5ba15 · bug, two, three, four, five +2 as of ${ASOF}`)
})

// Mutation: github.ts mergeDetail loses its description line.
test('P27: a later read with no description keeps the last good one, with its time', async ($, on) => {
  const seen = await queued($, on)
  const { ui } = await openedPr($, seen, 39, true)
  partial(seen, pr => {
    pr.body = null
  })
  await seen.clock.advance(MINUTE)
  const column = await columnOf(ui)
  expect(column[5]).toMatch(new RegExp(`as of ${hhmm(DETAIL_NOW + MINUTE)}$`))
  expect(column).toContain(`▲ description unknown, as of ${ASOF}`)
  expect(column).toContain('Fixes #3994.')
  expect(column).toContain('Latest')
  // The merge itself: the part not read is the one read before, the rest the new read's.
  const before = detailOf(PR_3995, 'pr', 3995, DETAIL_NOW) as any
  const later = clone(PR_3995)
  later.data.repository.pullRequest.body = null
  const merged = mergeDetail(before, detailOf(later, 'pr', 3995, DETAIL_NOW + MINUTE) as any) as any
  expect(merged.description).toBe(before.description)
  expect(merged.latest.at).toBe(DETAIL_NOW + MINUTE)
})

// Mutation: github.ts mergeDetail loses its latest line.
test('P28: a later read with no comments keeps the last good Latest, with its time', async ($, on) => {
  const seen = await queued($, on)
  const { ui } = await openedPr($, seen, 39, true)
  partial(seen, pr => {
    pr.comments = null
  })
  await seen.clock.advance(MINUTE)
  const column = await columnOf(ui)
  expect(column).toContain(`▲ latest unknown, as of ${ASOF}`)
  const latest = column.findIndex(text => text.startsWith('▲ latest unknown'))
  expect(column[latest + 1]).toBe('✓ you APPROVED 2h')
  expect(heads(column.slice(latest + 1)).slice(0, 2)).toEqual(['✓ you APPROVED 2h', '○ @itsvrushabh comment 31h'])
  expect(column).toContain('Description')
  const before = detailOf(PR_3995, 'pr', 3995, DETAIL_NOW) as any
  const later = clone(PR_3995)
  later.data.repository.pullRequest.comments = null
  const merged = mergeDetail(before, detailOf(later, 'pr', 3995, DETAIL_NOW + MINUTE) as any) as any
  expect(merged.latest).toBe(before.latest)
  expect(merged.description.at).toBe(DETAIL_NOW + MINUTE)
})

// Mutation: github.ts detailOf `title: line(item.title, 200)` → `title: String(item.title)`.
test('P33: a hostile title (ESC, BEL, bidi) is cleaned before it is drawn', async ($, on) => {
  const seen = await queued($, on)
  seen.details[`${PRA}#3995`] = PR_3995_HOSTILE_TITLE
  expect(HOSTILE_TITLE).toMatch(/[\u{0}-\u{1F}]/u)
  expect((detailOf(PR_3995_HOSTILE_TITLE, 'pr', 3995, DETAIL_NOW) as any).title).toBe('fix [31mred \u{202E}hidden\u{202C} end')
  const { ui, column } = await openedPr($, seen)
  expect(column[3]).toBe('#3995 fix [31mred {U+202E}hidden{U+202C} end')
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{202A}-\u{202E}]/u)
  expect(seen.toasts).toEqual([])
})

// Mutation: register.tsx readDetail `return { key, read: mergeDetail(...) }` → `return { ...card, read: ... }`.
test('R04: a good read after a failed one clears the failed phrase', async ($, on) => {
  const seen = await queued($, on)
  const { ui } = await openedPr($, seen)
  seen.modes[PR_KEY] = { kind: 'exit', stderr: REAL.gateway }
  await seen.clock.advance(MINUTE)
  expect((await columnOf(ui))[6]).toBe(`▲ detail unknown: GitHub error, as of ${ASOF}`)
  delete seen.modes[PR_KEY]
  await seen.clock.advance(MINUTE)
  const column = await columnOf(ui)
  expect(column[5]).toMatch(new RegExp(`as of ${hhmm(DETAIL_NOW + 2 * MINUTE)}$`))
  expect(column[6]).toBe('Description')
  expect(column.join('\n')).not.toMatch(/unknown/)
  expect(detailCalls(seen)).toHaveLength(3)
})

// Mutation: register.tsx ui.scroll `Math.max(0, old.scroll + by)` → `old.scroll + by`.
test('R11: a scroll far above the top is clamped to 0, so the next page down moves exactly one page', async ($, on) => {
  const seen = await queued($, on)
  const { ui, column: opened } = await openedPr($, seen, 104)
  // The strip's head is four rows (keys, attention, title, byline), so a page is the seven under it.
  const first = opened.slice(4)
  expect(first).toHaveLength(7)
  const scroll = scrollOf($)
  await scroll(11)
  const second = (await columnOf(ui)).slice(4)
  expect(second[0]).not.toBe(first[0])
  await scroll(-1_000)
  expect((await columnOf(ui)).slice(4)).toEqual(first)
  await scroll(11)
  expect((await columnOf(ui)).slice(4)).toEqual(second)
  await scroll(-1)
  expect((await columnOf(ui)).slice(4)[0]).toBe(first[6])
})

// Mutation: register.tsx refreshShown loses its `which === 'detail'` branch.
test('R14: a session start re-reads the shown detail, not the pair cards or the queue', async ($, on) => {
  const seen = await queued($, on)
  const { ui } = await openedPr($, seen)
  const queues = queueCalls(seen).length
  expect(detailCalls(seen)).toHaveLength(1)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  expect(detailCalls(seen).map(call => call.argv[10])).toEqual(['number=3995', 'number=3995'])
  expect(queueCalls(seen)).toHaveLength(queues)
  expect(ghCalls(seen)).toEqual([])
  expect((await columnOf(ui))[3]).toMatch(/^#3995 fix\(gitlab\)/)
  // Hidden, the same start reads nothing.
  seen.panes = []
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  expect(detailCalls(seen)).toHaveLength(2)
})

// Mutation: views.tsx STATES `draft: 'warn'` → `draft: 'note'`.
test('V16: the draft state\'s glyph is drawn in warning', async ($, on) => {
  const seen = await queued($, on)
  seen.details[`${PRA}#3995`] = PR_3995_DRAFT
  const { ui, column } = await openedPr($, seen)
  expect(await factsGlyphs(ui)).toEqual([
    { glyph: '▲', color: 'warning' },
    { glyph: '✓', color: 'success' },
  ])
  expect(column[4]).toMatch(/^▲ draft /)
  // The open state beside it stays inactive, so the colour is the draft's own.
  await ui.press({ key: 'detail-back' })
  seen.details[`${PRA}#3995`] = PR_3995
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  expect((await factsGlyphs(ui))[0]).toEqual({ glyph: '○', color: 'inactive' })
})
