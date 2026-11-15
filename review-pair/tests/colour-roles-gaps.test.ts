import { expect, test } from 'claude-code/testing'

import type { Card, Queue } from '../types'
import { cardOf, cardPillOf, factsOf, queuePillsOf } from '../hooks/github'
import { lint } from './lint'
import { PALETTES, assertFloors } from './palette'
import { CARDS, FIT } from './fixtures'
import { NOW, PAIR, PRA, QUEUE_NOW, SHOWN, TFL_PAIR, TOOL, TYPED, clone, mountPane, textOf, world } from './world'

// The pins the proof's mutation survivors asked for: each one assertion that the roles, the lint and the palette floor hold.
const DAY = 86_400_000
const ANSWERS: Record<string, unknown> = { ...CARDS, ...FIT }
const card = (key: string, number: number): Card => {
  const read = cardOf(ANSWERS[key], key.split('#')[0] ?? '', number, NOW)
  if (typeof read === 'string') throw new Error(`${key}: ${read}`)
  return { read }
}
const attentionOf$ = async (ui: any) => {
  const box = (await ui.find({ type: 'Box', key: 'attention' })) as any
  return box === undefined ? undefined : (box.children as any[]).map(textOf)
}
const TFL = 'IsmaelMartinez/teams-for-linux'

test('fix R03: the MERGED pill is on the done role', () => {
  const merged = card(`${TFL}#3010`, 3010)
  expect(cardPillOf(merged, factsOf(merged, { number: 3010, action: 'none' }, TFL, NOW))).toEqual({ role: 'done', words: 'MERGED' })
})

test('fix R08: a closed PR with conflicts is never CONFLICT', () => {
  const raw = clone(ANSWERS[`${PRA}#3477`])
  raw.data.repository.pullRequest.state = 'CLOSED'
  raw.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.state = 'SUCCESS'
  const read = cardOf(raw, PRA, 3477, NOW)
  if (typeof read === 'string') throw new Error(read)
  const closed: Card = { read }
  expect(read.kind === 'pr' && read.merge).toBe('DIRTY')
  expect(cardPillOf(closed, factsOf(closed, { number: 3477, action: 'x', head: 'a5cb5779100a' }, PRA, NOW))?.words).not.toBe('CONFLICT')
})

test('fix Q09: a breached queue with nothing owed is not clear', () => {
  const pr = (number: number, group: string, age: number) => ({ number, title: 't', createdAt: QUEUE_NOW - age, isDraft: false, group })
  const queue = { repo: PRA, at: QUEUE_NOW, board: 'none', read: { prs: [pr(1, 'author', 30 * DAY)], prTotal: 1, prsShort: false, issues: [], issueTotal: 0 } } as unknown as Queue
  expect(queuePillsOf(queue, QUEUE_NOW)).toMatchObject({ isClear: false })
})

test('fix L06 and L10: the lint refuses a coloured Button and warning words on a hand-made tree', () => {
  expect(lint({ type: 'Button', props: { label: 'accept', color: 'error' } })).toEqual(['Button "accept" carries colour'])
  expect(lint({ type: 'Box', props: { key: 'row-x' }, children: [{ type: 'Text', props: { color: 'warning' }, children: ['▲'] }, { type: 'Text', props: { color: 'warning' }, children: ['CI held'] }] })).toEqual(['words "CI held" in warning'])
})

test('fix P03: the palette floor check throws for a pairing under 5:1', () => {
  const bad = clone(PALETTES)
  bad.light.keys.error = [255, 200, 200]
  expect(() => assertFloors(bad)).toThrow(/inverseText on error reaches [0-9.]+:1 in light/)
  expect(() => assertFloors()).not.toThrow()
})

test('fix V14: a quiet queue beside a card that failed to read draws no CLEAR on the pair', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  const quiet = clone(seen.queues[PRA])
  quiet.data.repository.pullRequests.nodes = []
  quiet.data.repository.pullRequests.totalCount = 0
  quiet.data.repository.issues.nodes = []
  quiet.data.repository.issues.totalCount = 0
  seen.queues[PRA] = quiet
  seen.modes[`${PRA}#2450`] = { kind: 'exit', stderr: 'gh: HTTP 502: Bad Gateway' }
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  expect(seen.status.at(-1)).toBe('pr-agent · 0 PRs · 0 issues')
  const ui = await mountPane($, 'terminal', 104, true)
  expect(await attentionOf$(ui)).toEqual([' CLEAR '])
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  await seen.clock.settle()
  await ui.press({ key: 'tab-0' })
  expect(await attentionOf$(ui)).toBeUndefined()
  await ui.unmount()
})

test('fix V15: the pair of another repo never draws the held queue\'s pills', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  const ui = await mountPane($, 'terminal', 104, true)
  expect(await attentionOf$(ui)).toEqual([' YOU OWE 4 ', 'next: #4042'])
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...TFL_PAIR })
  await seen.clock.settle()
  await ui.press({ key: 'tab-0' })
  expect(await attentionOf$(ui)).toBeUndefined()
  await ui.unmount()
})
