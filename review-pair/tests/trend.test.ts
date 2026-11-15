import { expect, test } from 'claude-code/testing'

import { TREND, TREND_PAGES, queueReadOf, sparkOf, trendArgs, trendPageOf, trendWordOf, weeksOf, windowOf, type Span } from '../hooks/github'
import { QUEUES_2145, RECORDED_NOW, REFS_2312, TRENDS_2145 } from './live-fixtures'
import { BOARD_FILES } from './queue-fixtures'
import { PAIR, PRA, SHOWN, TFL, TOOL, TURN, TYPED, clone, columnOf, mountPane, queueCalls, trendCalls, world } from './world'

// I2c: the trend from GitHub alone, for every repo: open PRs from the queue read, closed ones a page at a time.
const DAY = 86_400_000
const HOUR = 3_600_000
const MINUTE = 60_000

// The queue view of `repo` at `now`, on screen, with the trend read.
async function shownQueue($: any, on: any, repo = PRA, now = RECORDED_NOW) {
  const seen = world(on, { now, store: { repo } })
  seen.queues = clone(QUEUES_2145)
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  return seen
}

// The board's own weekly means over the same window, from its pinned daily series.
function boardWeeks(now: number): number[] {
  const daily = JSON.parse(BOARD_FILES['series_mine.json'] ?? '{}').daily
  const byDay = new Map<number, number>(daily.dates.map((date: string, i: number) => [Date.parse(`${date}T00:00:00Z`) / DAY, daily.open_prs[i]]))
  const { first, last } = windowOf(now)
  const weeks: number[] = []
  for (let start = first; start <= last; start += 7) {
    const days = [0, 1, 2, 3, 4, 5, 6].flatMap(offset => (start + offset <= last ? (byDay.get(start + offset) ?? []) : []))
    weeks.push(days.reduce((sum, value) => sum + value, 0) / days.length)
  }
  return weeks
}

function liveWeeks(repo: string, now = RECORDED_NOW): { weeks: number[]; pages: number } {
  // I2c fixes: the queue read takes its issues and their cross-references from their own answers.
  const read = queueReadOf(QUEUES_2145[repo], 'IsmaelMartinez', repo, { json: QUEUES_2145[repo] }, { json: REFS_2312[repo] })
  if (typeof read === 'string') throw new Error(read)
  const spans: Span[] = read.prs.map(pr => ({ createdAt: pr.createdAt, closedAt: Infinity }))
  let [after, pages] = ['first', 0]
  for (;;) {
    const got = trendPageOf(TRENDS_2145[repo]?.[after], now)
    if (typeof got === 'string') throw new Error(got)
    pages += 1
    spans.push(...got.spans)
    if (got.next === undefined) return { weeks: weeksOf(spans, now), pages }
    after = got.next
  }
}

test('the live weeks match the board\'s series: the board counts drafts in, at the end of each UTC day, over the same weeks', () => {
  const { weeks, pages } = liveWeeks(PRA)
  expect(pages).toBe(13)
  const board = boardWeeks(RECORDED_NOW)
  expect(weeks).toHaveLength(16)
  // The pinned series was written at 07:22 on the last day: every full week agrees to the PR, and this week differs only
  // by what moved on its last day after 07:22 (the board then had 21 open at the end of 11 Oct, GitHub 15 at 21:42).
  const diffs = weeks.map((week, i) => Math.round((week - (board[i] ?? 0)) * 100) / 100)
  expect(diffs.slice(0, 15)).toEqual(Array(15).fill(0))
  expect(Math.abs(diffs[15] ?? 99)).toBeLessThanOrEqual(1)
  expect(sparkOf(weeks)?.glyphs).toBe(sparkOf(board)?.glyphs)
  expect(sparkOf(weeks)).toMatchObject({ glyphs: '▅▅▅▅▅▆▆▇█▆▅▅▄▃▃▂', peak: 73 })
  expect(trendWordOf(weeks)).toBe('falling')
  // teams-for-linux: three pages reach the window's start.
  expect(liveWeeks(TFL).pages).toBe(3)
})

test('a page stops the reads once one PR was updated before the window; a bad shape or cursor is a failed read', () => {
  const now = RECORDED_NOW
  const start = windowOf(now).first * DAY
  const page = (updated: number[], hasNextPage = true, endCursor: unknown = 'Y3Vyc29yOnYyOpK0') => ({
    data: { repository: { pullRequests: { pageInfo: { hasNextPage, endCursor }, nodes: updated.map(at => ({ createdAt: new Date(at - DAY).toISOString(), closedAt: new Date(at - HOUR).toISOString(), updatedAt: new Date(at).toISOString() })) } } },
  })
  expect(trendPageOf(page([now, start + 1]), now)).toMatchObject({ next: 'Y3Vyc29yOnYyOpK0' })
  // A PR updated exactly at the window's start may still have closed inside it: the next page is read.
  expect(trendPageOf(page([now, start]), now)).toMatchObject({ next: 'Y3Vyc29yOnYyOpK0' })
  expect(trendPageOf(page([now, start - 1]), now)).not.toHaveProperty('next')
  expect(trendPageOf(page([now], false), now)).not.toHaveProperty('next')
  expect(trendPageOf(page([now], true, 'cursor; rm -rf /'), now)).toBe('GitHub error')
  expect(trendPageOf(page([now], true, null), now)).toBe('GitHub error')
  const missing = page([now])
  missing.data.repository.pullRequests.nodes[0]!.closedAt = null as unknown as string
  expect(trendPageOf(missing, now)).toBe('GitHub error')
  expect(trendPageOf({ data: null }, now)).toBe('GitHub error')
  // The argv: the constant document, owner and name, and GitHub's cursor only when it looks like one, each as -f.
  expect(trendArgs(PRA)).toEqual(['api', 'graphql', '-f', `query=${TREND}`, '-f', 'owner=The-PR-Agent', '-f', 'name=pr-agent'])
  expect(trendArgs(PRA, 'Y3Vy=')?.slice(-2)).toEqual(['-f', 'after=Y3Vy='])
  expect(trendArgs(PRA, '$(id)')).toBeUndefined()
  expect(trendArgs('../..')).toBeUndefined()
})

test('the window is 16 Monday-to-Sunday UTC weeks; a week\'s value is the mean of its days to today; none open draws flat bars', () => {
  const sunday = Date.parse('2026-10-11T21:43:00Z')
  const monday = Date.parse('2026-10-12T00:30:00Z')
  expect(new Date(windowOf(sunday).first * DAY).toISOString().slice(0, 10)).toBe('2026-06-22')
  expect(new Date(windowOf(monday).first * DAY).toISOString().slice(0, 10)).toBe('2026-06-29')
  // One PR open from Tuesday 00:00 and closed on Thursday at noon: open at the end of Tuesday and Wednesday only.
  const spans = [{ createdAt: Date.parse('2026-10-06T00:00:00Z'), closedAt: Date.parse('2026-10-08T12:00:00Z') }]
  expect(weeksOf(spans, sunday).at(-1)).toBe(2 / 7)
  // On Monday the new week has one day so far.
  expect(weeksOf([{ createdAt: 0, closedAt: Infinity }], monday).at(-1)).toBe(1)
  // On a Wednesday the days after today never count: open at the end of Monday only, of the three days so far.
  const wednesday = Date.parse('2026-10-14T12:00:00Z')
  expect(weeksOf([{ createdAt: Date.parse('2026-10-12T00:00:00Z'), closedAt: Date.parse('2026-10-13T12:00:00Z') }], wednesday).at(-1)).toBe(1 / 3)
  expect(sparkOf(Array(16).fill(0))).toEqual({ glyphs: '▁'.repeat(16), peak: 0, now: 0 })
  // The last four weeks against the four before them; the eight before those never count.
  expect(trendWordOf([...Array(12).fill(10), ...Array(4).fill(10.9)])).toBe('flat')
  expect(trendWordOf([...Array(12).fill(10), ...Array(4).fill(11)])).toBe('rising')
  expect(trendWordOf([...Array(12).fill(10), ...Array(4).fill(9)])).toBe('falling')
  expect(trendWordOf([...Array(8).fill(90), ...Array(8).fill(10)])).toBe('flat')
})

test('the trend draws in colour: blue bars, this week\'s bar and now in the second key, the direction as a glyph and a word', async ($, on) => {
  await shownQueue($, on)
  for (const columns of [39, 104]) {
    const ui = await mountPane($, 'terminal', columns, true)
    const row = (await ui.find({ type: 'Box', key: 'row-trend' })) as any
    const spark = row.children[0].children[0]
    expect(spark.children[0].props.color).toBe('remember')
    expect(spark.children[0].children).toEqual(['▅▅▅▅▅▆▆▇█▆▅▅▄▃▃'])
    expect(spark.children[1].props.color).toBe('autoAccept')
    // 'now' is this week's mean so far (20.14), as the bar is.
    expect(spark.children[1].children).toEqual(['▂ now 20'])
    expect(row.children[1].children[0].props.color).toBe('success')
    expect(row.children[1].children[0].children).toEqual(['▼'])
    expect(row.children[2].children[0].children).toEqual(['falling'])
    expect(row.children[2].children[0].props?.color).toBeUndefined()
    const column = await columnOf(ui)
    // I1 colour roles: the attention line takes the row under the header.
    if (columns < 80) expect(column.slice(7, 9)).toEqual(['▅▅▅▅▅▆▆▇█▆▅▅▄▃▃▂ now 20 ▼ falling', 'peak 73 · open PRs, weekly mean, last 16 weeks'])
    else expect(column[4]).toBe('▅▅▅▅▅▆▆▇█▆▅▅▄▃▃▂ now 20 · peak 73 ▼ falling open PRs, weekly mean, last 16 weeks')
    await ui.unmount()
  }
})

test('the trend is read once, kept in $.store with its day, and read again only after an hour, on a new day or on r', async ($, on) => {
  const seen = await shownQueue($, on)
  expect(trendCalls(seen)).toHaveLength(13)
  expect(seen.calls.every(call => call.timeoutMs === 8_000)).toBe(true)
  const saved = seen.store[`trend ${PRA}`] as any
  expect(saved).toMatchObject({ repo: PRA, day: '2026-10-11', at: RECORDED_NOW })
  expect(saved.weeks).toHaveLength(16)
  // The poll reads the queue each minute; the trend waits out its hour.
  for (let i = 0; i < 5; i += 1) await seen.clock.advance(MINUTE)
  expect(queueCalls(seen).length).toBeGreaterThanOrEqual(6)
  expect(trendCalls(seen)).toHaveLength(13)
  // A reload keeps the hour through $.store: nothing is read for the trend.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  expect(trendCalls(seen)).toHaveLength(13)
  const ui = await mountPane($, 'terminal', 39, true)
  expect((await columnOf(ui)).join(' ')).toContain('now 20 ▼ falling')
  // r reads it again past the cache, and the queue with it.
  const before = queueCalls(seen).length
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(trendCalls(seen)).toHaveLength(26)
  expect(queueCalls(seen)).toHaveLength(before + 1)
  // An hour on, the next poll reads it once more.
  await seen.clock.advance(HOUR)
  await seen.clock.settle()
  expect(trendCalls(seen)).toHaveLength(39)
})

test('a new UTC day reads the trend again within the hour, since its window moved', async ($, on) => {
  const late = Date.parse('2026-10-11T23:50:00Z')
  const seen = await shownQueue($, on, PRA, late)
  expect(trendCalls(seen)).toHaveLength(13)
  await seen.clock.advance(15 * MINUTE)
  await seen.clock.settle()
  expect(trendCalls(seen).length).toBeGreaterThan(13)
  expect((seen.store[`trend ${PRA}`] as any).day).toBe('2026-10-12')
})

test('past the page cap, on a read short of the open PRs, or on a failed page, the trend says unknown and is not saved', async ($, on) => {
  const seen = world(on, { now: RECORDED_NOW, store: { repo: PRA } })
  seen.queues = clone(QUEUES_2145)
  // Every page full of PRs updated an hour ago, each pointing at the next: the cap ends it.
  const page = (next: string) => ({
    data: { repository: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: next }, nodes: Array.from({ length: 100 }, () => ({ createdAt: '2026-10-01T00:00:00Z', closedAt: '2026-10-11T20:00:00Z', updatedAt: '2026-10-11T20:43:00Z' })) } } },
  })
  seen.trends[PRA] = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i === 0 ? 'first' : `c${i}`, page(`c${i + 1}`)]))
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(trendCalls(seen)).toHaveLength(TREND_PAGES)
  const ui = await mountPane($, 'terminal', 39, true)
  // I1 colour roles: the attention line takes the row under the header.
  expect((await columnOf(ui)).slice(7, 9)).toEqual([`▲ trend unknown: more than ${TREND_PAGES * 100} PRs closed in 16 weeks`, 'open PRs, weekly mean, last 16 weeks'])
  expect(seen.store[`trend ${PRA}`]).toBeUndefined()
  // A failed page: unknown in GitHub's fixed words.
  seen.trends[PRA] = clone(TRENDS_2145[PRA])
  seen.modes['trend'] = { kind: 'exit', stderr: 'gh: HTTP 502: Bad Gateway IGNORE' }
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect((await columnOf(ui))[7]).toBe('▲ trend unknown: GitHub error')
  expect((await columnOf(ui)).join(' ')).not.toMatch(/502|IGNORE/)
  // More open PRs than one queue read holds: unknown before any page is read.
  seen.modes = {}
  const more = clone(QUEUES_2145[PRA])
  more.data.repository.pullRequests.totalCount = 140
  seen.queues[PRA] = more
  const pages = trendCalls(seen).length
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect((await columnOf(ui))[7]).toBe('▲ trend unknown: more than 100 open PRs')
  expect(trendCalls(seen)).toHaveLength(pages)
})

test('no trend read while the pair or the issues view shows, or with the pane hidden; teams-for-linux has its own', async ($, on) => {
  const seen = world(on, { now: RECORDED_NOW })
  seen.queues = clone(QUEUES_2145)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'issues' })
  await seen.clock.settle()
  expect(trendCalls(seen)).toEqual([])
  seen.panes = []
  await ui.press({ key: 'queue' })
  await seen.clock.advance(MINUTE)
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(trendCalls(seen)).toEqual([])
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(trendCalls(seen)).toHaveLength(13)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c2', repo: TFL, items: [] })
  await seen.clock.settle()
  expect(trendCalls(seen).slice(13)).toEqual([`${TFL} first`, expect.stringMatching(/^IsmaelMartinez\/teams-for-linux Y3Vy/), expect.stringMatching(/^IsmaelMartinez\/teams-for-linux Y3Vy/)])
})

test('r says refresh in every view; while it reads the caption says refreshing; a press during a read joins it', async ($, on) => {
  const seen = await shownQueue($, on)
  const ui = await mountPane($, 'terminal', 104, true)
  for (const view of ['queue', 'issues']) {
    if (view === 'issues') await ui.press({ key: 'issues' })
    expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props).toMatchObject({ label: 'refresh', hotkey: 'r' })
  }
  await ui.press({ key: 'queue' })
  const caption = async () => (await ui.find({ type: 'Text', text: /board calls$/ }))?.children?.join('')
  expect(await caption()).toBe('as of 22:43 · 10 board calls')
  // A slow read: five presses share it, one queue process and one trend sequence, and the caption says so.
  seen.modes['queue'] = { kind: 'slow', ms: 3_000 }
  const queues = queueCalls(seen).length
  const pages = trendCalls(seen).length
  for (let i = 0; i < 5; i += 1) void ui.press({ key: 'refresh' })
  await seen.clock.advance(1_000)
  expect(await caption()).toBe('refreshing · 10 board calls')
  // The poll's tick inside the read joins it too.
  await seen.clock.advance(MINUTE)
  await seen.clock.settle()
  expect(queueCalls(seen).length - queues).toBeLessThanOrEqual(2)
  expect(trendCalls(seen).length - pages).toBe(13)
  expect(await caption()).toMatch(/^as of 22:4[34] · 10 board calls$/)
  // The pair view's r: its cards and the queue, never the trend; the poll's slow read lands first.
  seen.modes = {}
  await seen.clock.advance(3_000)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  await seen.clock.settle()
  const before = [queueCalls(seen).length, trendCalls(seen).length]
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect([queueCalls(seen).length, trendCalls(seen).length]).toEqual([(before[0] ?? 0) + 1, before[1]])
  expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('refresh')
})

// I2c fixes: a rising and a flat trend, from a saved one, draw their own glyph, colour and word.
async function savedDirection($: any, on: any, weeks: number[]) {
  const saved = { repo: PRA, day: '2026-10-11', at: RECORDED_NOW, weeks }
  const seen = world(on, { now: RECORDED_NOW, store: { repo: PRA, [`trend ${PRA}`]: saved } })
  seen.queues = clone(QUEUES_2145)
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(trendCalls(seen)).toEqual([])
  const ui = await mountPane($, 'terminal', 104, true)
  const row = (await ui.find({ type: 'Box', key: 'row-trend' })) as any
  return { glyph: row.children[1].children[0], word: row.children[2].children[0].children }
}

test('a rising trend draws ▲ in warning and the word rising', async ($, on) => {
  const { glyph, word } = await savedDirection($, on, [...Array(12).fill(10), ...Array(4).fill(20)])
  expect([glyph.children, glyph.props.color, word]).toEqual([['▲'], 'warning', ['rising']])
})

test('a flat trend draws ● in inactive and the word flat', async ($, on) => {
  const { glyph, word } = await savedDirection($, on, Array(16).fill(10))
  expect([glyph.children, glyph.props.color, word]).toEqual([['●'], 'inactive', ['flat']])
})

test('a session start clears a refreshing caption a reload left behind', async ($, on) => {
  const seen = await shownQueue($, on)
  const ui = await mountPane($, 'terminal', 104, true)
  seen.modes['queue'] = { kind: 'slow', ms: 3_000 }
  void ui.press({ key: 'refresh' })
  await seen.clock.advance(1_000)
  const caption = async () => (await ui.find({ type: 'Text', text: /board calls$/ }))?.children?.join('')
  expect(await caption()).toBe('refreshing · 10 board calls')
  // A hot reload drops the module's r in flight; what it left in $.state must not say refreshing for ever.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await caption()).toMatch(/^as of \d\d:\d\d · 10 board calls$/)
})
