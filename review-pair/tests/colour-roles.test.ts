import { expect, test } from 'claude-code/testing'

import type { Card, Queue } from '../types'
import { STALE_MS, attentionOf, breachesOf, cardOf, cardPillOf, detailPillOf, factsOf, issueOf, pairAttentionOf, queueModelOf, queuePillsOf, statusOf, worstFirst } from '../hooks/github'
import { isPill, lint } from './lint'
import { BAND_BG, PILL_BG, PILL_FLOOR, pairing } from './palette'
import { CARDS, FIT, ISSUES } from './fixtures'
import { NOW, PAIR, PRA, QUEUE_NOW, SHOWN, SURFACES, TFL, TFL_PAIR, TOOL, TYPED, clone, columnOf, mountPane, queueCalls, textOf, world } from './world'

// I1 colour roles v2 (plan section 2; Q1 pills allowed under measured allow-lists, Q3 you-owe on planMode teal). A
// pill is uppercase fixed words in inverseText on one of five keys, bold, one space each side; amber stays a glyph.

const MINUTE = 60_000
const DAY = 86_400_000
const ANSWERS: Record<string, unknown> = { ...CARDS, ...FIT }
const card = (key: string, number: number, readAt = NOW): Card => {
  const read = cardOf(ANSWERS[key], key.split('#')[0] ?? '', number, readAt)
  if (typeof read === 'string') throw new Error(`${key}: ${read}`)
  return { read }
}
// The card read at NOW, its pill as of `now`.
const pillOf = (key: string, number: number, item: object = {}, now = NOW): string | undefined => {
  const one = card(key, number)
  return cardPillOf(one, factsOf(one, { number, action: 'review', ...item }, key.split('#')[0] ?? '', now))?.words
}
const words = (pills: { words: string }[]) => pills.map(one => one.words)
// A card with its own head as the reviewed one: green when nothing else is wrong.
const greenOf = (key: string, number: number, now = NOW) => {
  const read = card(key, number).read
  return pillOf(key, number, { head: read?.kind === 'pr' ? read.head : undefined }, now)
}
// #4045 with its one open bot thread resolved: every fact green, the reviewed head its own.
const greenPair = (seen: { answers: Record<string, unknown> }) => {
  const green = clone(seen.answers[`${PRA}#4045`])
  green.data.repository.pullRequest.reviewThreads.nodes[1].isResolved = true
  seen.answers[`${PRA}#4045`] = green
  return { repo: PRA, items: [{ ...PAIR.items[0] }, { ...PAIR.items[1] }] }
}
// The pills of a drawn attention line, and the Box's row keys for budget checks.
const attentionOf$ = async (ui: any) => {
  const box = (await ui.find({ type: 'Box', key: 'attention' })) as any
  return box === undefined ? undefined : (box.children as any[]).map(textOf)
}
// The item's own rows whose glyph is green: none beside a NOT READ pill (the tab row's glyphs are the other tabs').
const greenRows = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((box: any) => String(box.key ?? '').startsWith('row-') && box.children?.[0]?.children?.[0]?.props?.color === 'success').map((box: any) => box.key)
// The decision pill at the start of the title row, if any.
const decisionOf = async (ui: any) => {
  const title = (await ui.find({ type: 'Box', key: 'title' })) as any
  const first = title?.children?.[0]?.children?.[0]
  return isPill(first) ? textOf(first) : undefined
}
const pillsIn = async (ui: any): Promise<{ words: string; bg: string }[]> => (await ui.findAll({ type: 'Text' })).filter(isPill).map((text: any) => ({ words: textOf(text), bg: text.props.backgroundColor }))

// By measurement (tests/palette.ts): inverseText on each pill key, light | light-daltonized | dark | dark-daltonized:
// error 6.67 5.89 7.67 7.34, planMode 6.79 6.50 6.02 6.58, success 5.32 6.25 8.54 7.14, merged 6.04 6.04 7.73 7.73,
// inactive 5.74 5.74 7.37 7.37; text on each band key: selectionBg 13.9 13.9 8.5 8.5, userMessageBackground 18.43
// 15.31 11.9 11.9, diffAddedDimmed 15.06 16.56 7.6 8.29, diffRemovedDimmed 15.39 18.08 7.97 13.11. Set aside: an
// amber pill reaches 2.14 in light-daltonized and 4.71 in light, claude 2.13, the blue 4.4; inactive words on
// userMessageBackground 4.18, so a band's words are text.
test('palette: inverseText on every pill key and text on every band key reach 5:1 in all four RGB themes; amber, claude and blue pills do not', () => {
  expect([...PILL_BG]).toEqual(['error', 'planMode', 'success', 'merged', 'inactive'])
  expect([...BAND_BG]).toEqual(['selectionBg', 'userMessageBackground', 'diffAddedDimmed', 'diffRemovedDimmed'])
  expect(PILL_FLOOR).toBe(5)
  const themes = ['light', 'light-daltonized', 'dark', 'dark-daltonized']
  const row = (fg: string, bg: string) => themes.map(theme => pairing(fg, bg)[theme] ?? 0)
  expect(row('inverseText', 'error')).toEqual([6.67, 5.89, 7.67, 7.34])
  expect(row('inverseText', 'planMode')).toEqual([6.79, 6.5, 6.02, 6.58])
  expect(row('inverseText', 'success')).toEqual([5.32, 6.25, 8.54, 7.14])
  expect(row('inverseText', 'merged')).toEqual([6.04, 6.04, 7.73, 7.73])
  expect(row('inverseText', 'inactive')).toEqual([5.74, 5.74, 7.37, 7.37])
  expect(row('text', 'selectionBg')).toEqual([13.9, 13.9, 8.5, 8.5])
  expect(row('text', 'userMessageBackground')).toEqual([18.43, 15.31, 11.9, 11.9])
  expect(row('text', 'diffAddedDimmed')).toEqual([15.06, 16.56, 7.6, 8.29])
  expect(row('text', 'diffRemovedDimmed')).toEqual([15.39, 18.08, 7.97, 13.11])
  for (const bg of PILL_BG) expect(Math.min(...row('inverseText', bg)), bg).toBeGreaterThanOrEqual(PILL_FLOOR)
  for (const bg of BAND_BG) expect(Math.min(...row('text', bg)), bg).toBeGreaterThanOrEqual(PILL_FLOOR)
  expect(row('inverseText', 'warning')).toEqual([4.71, 2.14, 12.88, 13.89])
  expect(row('inverseText', 'claude')).toEqual([3.15, 2.13, 6.67, 9.86])
  expect(row('inverseText', 'suggestion')).toEqual([4.4, 4.68, 11.18, 12.44])
  expect(row('inactive', 'userMessageBackground')).toEqual([5.04, 4.19, 4.18, 4.18])
})

test('each pill role from a fixture state: act, move, ready, done and parked, and nothing for a closed item or a first read', () => {
  // act: the head moved since the review; CI failing; conflicts with the base (the head not compared: a warn, not a block).
  expect(pillOf(`${PRA}#4045`, 4045, { head: 'deadbeef' })).toBe('HEAD MOVED')
  expect(pillOf(`${TFL}#2998`, 2998, { head: '8962ae8' })).toBe('CI FAILED')
  expect(pillOf(`${PRA}#3752`, 3752)).toBe('CONFLICT')
  // Worst first inside one card: moved before failing before conflicts.
  expect(pillOf(`${TFL}#2998`, 2998, { head: 'deadbeef' })).toBe('HEAD MOVED')
  expect(pillOf(`${PRA}#3477`, 3477)).toBe('CI FAILED')
  // ready: every fact read is green, the reviewed head holds (#3675, #4032: no exception rows at all).
  expect(greenOf(`${PRA}#3675`, 3675)).toBe('READY')
  expect(greenOf(`${PRA}#4032`, 4032)).toBe('READY')
  // An open thread (#4045) or a draft (#4026) is amber, not red: no pill, and never READY; code that runs is a block
  // with no pill of its own (#3909).
  expect(greenOf(`${PRA}#4045`, 4045)).toBeUndefined()
  expect(greenOf(`${PRA}#4026`, 4026)).toBeUndefined()
  expect(greenOf(`${PRA}#3909`, 3909)).toBeUndefined()
  // done: merged; posted for the one read that followed a write.
  expect(pillOf(`${TFL}#3010`, 3010)).toBe('MERGED')
  const posted: Card = { ...card(`${PRA}#4045`, 4045), posted: true }
  expect(cardPillOf(posted, factsOf(posted, { number: 4045, action: 'merge', head: '35a07ebb5e36' }, PRA, NOW))?.words).toBe('POSTED')
  // Merged wins over posted: the write landed.
  const mergedPosted: Card = { ...card(`${TFL}#3010`, 3010), posted: true }
  expect(cardPillOf(mergedPosted, factsOf(mergedPosted, { number: 3010, action: 'none' }, TFL, NOW))?.words).toBe('MERGED')
  // parked: a failed first read, a failed refresh after a good read, a read five minutes old; never READY beside it.
  expect(cardPillOf({ failed: 'GitHub error' }, factsOf({ failed: 'GitHub error' }, { number: 1, action: 'x' }, PRA, NOW))?.words).toBe('NOT READ')
  const failedAfter: Card = { ...card(`${PRA}#4045`, 4045), failed: 'GitHub timed out' }
  expect(cardPillOf(failedAfter, factsOf(failedAfter, { number: 4045, action: 'x', head: '35a07ebb5e36' }, PRA, NOW))?.words).toBe('NOT READ')
  expect(greenOf(`${PRA}#3675`, 3675, NOW + STALE_MS)).toBe('NOT READ')
  expect(greenOf(`${PRA}#3675`, 3675, NOW + STALE_MS - 1)).toBe('READY')
  // Nothing: a first read still running, a draft (amber), and (review F10) an issue, open or closed: it has no gate to
  // pass, so a 'blocked' label never reads as all green.
  expect(cardPillOf(undefined, factsOf(undefined, { number: 1, action: 'x' }, PRA, NOW))).toBeUndefined()
  expect(pillOf(`${PRA}#2450`, 2450, { head: '1234567' })).toBe('HEAD MOVED')
  const issuePillOf = (number: number, labels: string[] = []) => {
    const raw = clone(ISSUES[`${PRA}#${number}`])
    raw.data.repository.issue.labels.nodes.push(...labels.map(name => ({ name })))
    const read = issueOf(raw, NOW)
    if (typeof read === 'string') throw new Error(read)
    const one: Card = { read }
    return cardPillOf(one, factsOf(one, { number, kind: 'issue', action: 'reply' }, PRA, NOW))
  }
  expect(issuePillOf(3887)).toBeUndefined()
  expect(issuePillOf(3887, ['blocked'])).toBeUndefined()
  expect(issuePillOf(882)).toBeUndefined()
  expect(cardPillOf({ failed: 'GitHub error' }, factsOf({ failed: 'GitHub error' }, { number: 3887, kind: 'issue', action: 'reply' }, PRA, NOW))?.words).toBe('NOT READ')
  const roles = ['act', 'move', 'ready', 'done', 'parked']
  expect(worstFirst([{ role: 'ready', words: 'R' }, { role: 'parked', words: 'P' }, { role: 'done', words: 'D' }, { role: 'act', words: 'A2' }, { role: 'move', words: 'M' }, { role: 'act', words: 'A1' }]).map(one => `${one.role} ${one.words}`)).toEqual(['act A2', 'act A1', 'move M', 'parked P', 'done D', 'ready R'])
  expect(roles).toHaveLength(5)
})

// The thresholds in one place: 28 days for a live PR, 24 hours for an item nobody has looked at.
const queueOf = (prs: object[], issues: object[] = [], at = QUEUE_NOW, extra: Partial<Queue> = {}): Queue =>
  ({ repo: PRA, at, board: 'none', read: { prs, prTotal: prs.length, prsShort: false, issues, issueTotal: issues.length }, ...extra }) as Queue

test('the queue pills: STALE from 28 days, NOBODY from 24 hours, YOU OWE with the first item owed, CLEAR only with nothing owed or breached', () => {
  const pr = (number: number, group: string, age: number, isDraft = false) => ({ number, title: 't', createdAt: QUEUE_NOW - age, isDraft, group })
  const quiet = queueOf([pr(1, 'author', 27 * DAY), pr(2, 'nobody', 23 * 3_600_000)])
  expect(queuePillsOf(quiet, QUEUE_NOW)).toEqual({ pills: [], isClear: true })
  expect(words(attentionOf(quiet, QUEUE_NOW, []).pills)).toEqual(['CLEAR'])
  expect(breachesOf(queueModelOf(quiet)!, QUEUE_NOW).count).toBe(0)
  // One day more: both thresholds crossed, worst (oldest) first within each, the counts distinct.
  const late = queueOf([pr(1, 'author', 28 * DAY + MINUTE), pr(2, 'nobody', DAY + 2 * 3_600_000), pr(3, 'nobody', DAY + MINUTE), pr(4, 'owe', DAY), pr(5, 'parked', 40 * DAY), pr(6, 'author', 40 * DAY, true)])
  const pills = queuePillsOf(late, QUEUE_NOW)
  expect(words(pills.pills)).toEqual(['STALE 28d', 'NOBODY 26h', 'YOU OWE 1'])
  expect(pills.next).toBe(4)
  expect(pills.isClear).toBe(false)
  // Parked and draft PRs are waiting on purpose: #5 at 40 days is not stale, and the breaches count #1, #2 and #3.
  expect(breachesOf(queueModelOf(late)!, QUEUE_NOW)).toMatchObject({ count: 3, stale: { number: 1 }, nobody: { number: 2 } })
  // An issue nobody has looked at breaches too; an unknown age never does.
  const issue = (number: number, section: string, age: number) => ({ number, title: 't', createdAt: QUEUE_NOW - age, section })
  const unseen = queueOf([], [issue(9, 'nobody', 13 * DAY), issue(8, 'reporter', 100 * DAY), { number: 7, title: 't', createdAt: Number.NaN, section: 'nobody' }])
  expect(words(queuePillsOf(unseen, QUEUE_NOW).pills)).toEqual(['NOBODY 13d'])
  // Review F7: the NaN age is not among the breaches (a filter on `<= limit` would let it through).
  expect(breachesOf(queueModelOf(unseen)!, QUEUE_NOW)).toMatchObject({ count: 1, staleCount: 0 })
  // Review F5: the oldest PR nobody has looked at is the stale one too: STALE alone, the worse reading, one item.
  const same = queueOf([pr(1, 'nobody', 75 * DAY), pr(2, 'author', 10 * DAY)])
  expect(words(queuePillsOf(same, QUEUE_NOW).pills)).toEqual(['STALE 75d'])
  expect(breachesOf(queueModelOf(same)!, QUEUE_NOW)).toMatchObject({ count: 1, staleCount: 1, stale: { number: 1 }, nobody: { number: 1 } })
  // NOBODY names the oldest unseen item and nothing else: a younger unseen row does not take its place.
  expect(words(queuePillsOf(queueOf([pr(1, 'nobody', 75 * DAY), pr(2, 'nobody', 2 * DAY)]), QUEUE_NOW).pills)).toEqual(['STALE 75d'])
  expect(words(queuePillsOf(queueOf([pr(1, 'author', 75 * DAY), pr(2, 'nobody', 2 * DAY)]), QUEUE_NOW).pills)).toEqual(['STALE 75d', 'NOBODY 2d'])
  // An owed count the read cannot give draws no owe pill, and next still names the first owed row.
  const short = queueOf([pr(4, 'owe', DAY)], [], QUEUE_NOW, { read: { prs: [pr(4, 'owe', DAY)], prTotal: 2, prsShort: true, issues: [], issueTotal: 0 } } as any)
  expect(queuePillsOf(short, QUEUE_NOW)).toEqual({ pills: [], isClear: false, next: 4 })
  // NOT READ: a failed read, or a read five minutes old (its pills kept, never CLEAR); nothing before the first read.
  expect(words(queuePillsOf({ repo: PRA, at: QUEUE_NOW, failed: 'GitHub error', board: 'none' }, QUEUE_NOW).pills)).toEqual(['NOT READ'])
  expect(queuePillsOf(late, QUEUE_NOW + STALE_MS)).toMatchObject({ isClear: false })
  expect(words(queuePillsOf(late, QUEUE_NOW + STALE_MS).pills)).toEqual(['NOT READ', 'STALE 28d', 'NOBODY 26h', 'YOU OWE 1'])
  expect(queuePillsOf(quiet, QUEUE_NOW + STALE_MS)).toEqual({ pills: [{ role: 'parked', words: 'NOT READ' }], isClear: false })
  expect(queuePillsOf({ repo: PRA, at: 0, board: 'none' }, QUEUE_NOW)).toEqual({ pills: [], isClear: false })
  expect(queuePillsOf(null, QUEUE_NOW)).toEqual({ pills: [], isClear: false })
  // The attention line is worst first and CLEAR is withheld beside a broken or unread card.
  expect(words(attentionOf(late, QUEUE_NOW + STALE_MS, [{ role: 'done', words: 'MERGED' }]).pills)).toEqual(['STALE 28d', 'NOBODY 26h', 'YOU OWE 1', 'NOT READ', 'MERGED'])
  expect(words(attentionOf(quiet, QUEUE_NOW, [{ role: 'act', words: 'CI FAILED' }]).pills)).toEqual(['CI FAILED'])
  // Review F7: and beside an unread card (the detail view's case), never CLEAR.
  expect(words(attentionOf(quiet, QUEUE_NOW, [{ role: 'parked', words: 'NOT READ' }]).pills)).toEqual(['NOT READ'])
  expect(words(attentionOf(quiet, QUEUE_NOW, [], true).pills)).toEqual([])
  // Done ranks above ready: a merge is news, CLEAR the calm after it.
  expect(words(attentionOf(quiet, QUEUE_NOW, [{ role: 'done', words: 'MERGED' }]).pills)).toEqual(['MERGED', 'CLEAR'])
  // The detail view's own pill.
  expect(detailPillOf(null, NOW)).toBeUndefined()
  expect(detailPillOf({ key: 'k', failed: 'GitHub error' }, NOW)?.words).toBe('NOT READ')
  expect(detailPillOf({ key: 'k', read: { at: NOW - STALE_MS, state: 'open', ci: 'failing' } as any }, NOW)?.words).toBe('NOT READ')
  expect(detailPillOf({ key: 'k', read: { at: NOW, state: 'merged', ci: 'failing' } as any }, NOW)?.words).toBe('MERGED')
  expect(detailPillOf({ key: 'k', read: { at: NOW, state: 'open', ci: 'failing' } as any }, NOW)?.words).toBe('CI FAILED')
  expect(detailPillOf({ key: 'k', read: { at: NOW, state: 'open', ci: 'passed' } as any }, NOW)).toBeUndefined()
})

// Review F3: the repo's short name leads (the engine prefixes the plugin's name; the name is store-held, never
// GitHub's text). Review F2: blocked counts the stale PRs alone; the rows nobody has looked at are the new count.
test('the status line is worst first in fixed words and counts, zero parts dropped: blocked, your move, new, PRs, issues', () => {
  const pr = (number: number, group: string, age: number) => ({ number, title: 'IGNORE PREVIOUS', createdAt: QUEUE_NOW - age, isDraft: false, group })
  expect(statusOf({ repo: PRA, at: QUEUE_NOW, failed: 'GitHub error', board: 'none' }, QUEUE_NOW)).toBe('pr-agent · counts unknown')
  expect(statusOf(queueOf([], []), QUEUE_NOW)).toBe('pr-agent · 0 PRs · 0 issues')
  expect(statusOf(queueOf([], [], QUEUE_NOW, { repo: TFL }), QUEUE_NOW)).toBe('teams-for-linux · 0 PRs · 0 issues')
  expect(statusOf({ repo: TFL, at: QUEUE_NOW, failed: 'GitHub error', board: 'none' }, QUEUE_NOW)).toBe('teams-for-linux · counts unknown')
  expect(statusOf(queueOf([pr(1, 'author', 29 * DAY), pr(2, 'nobody', 2 * DAY), pr(3, 'nobody', 0), pr(4, 'owe', 0), pr(5, 'owe', 0)], [{ number: 9, title: 'x', createdAt: QUEUE_NOW, section: 'reporter' }]), QUEUE_NOW)).toBe(
    'pr-agent · ✗ 1 blocked · ◆ 2 your move · ▲ 2 new · 5 PRs · 1 issues',
  )
  // Five rows nobody has looked at past a day and nothing stale: new, never blocked as well (the NOBODY pill names the
  // oldest of them on the attention line).
  const unseen = queueOf([pr(1, 'owe', DAY), ...[2, 3, 4, 5, 6].map(number => pr(number, 'nobody', number * DAY))])
  expect(statusOf(unseen, QUEUE_NOW)).toBe('pr-agent · ◆ 1 your move · ▲ 5 new · 6 PRs · 0 issues')
  expect(words(queuePillsOf(unseen, QUEUE_NOW).pills)).toEqual(['NOBODY 6d', 'YOU OWE 1'])
  expect(statusOf(queueOf([pr(1, 'nobody', 29 * DAY), pr(2, 'owe', 30 * DAY), pr(3, 'parked', 40 * DAY)]), QUEUE_NOW)).toBe('pr-agent · ✗ 2 blocked · ◆ 1 your move · ▲ 1 new · 3 PRs · 0 issues')
  expect(statusOf(queueOf([pr(1, 'author', DAY)]), QUEUE_NOW)).toBe('pr-agent · 1 PRs · 0 issues')
  const short = queueOf([pr(4, 'owe', DAY)], [], QUEUE_NOW, { read: { prs: [pr(4, 'owe', DAY)], prTotal: 2, prsShort: true, issues: [], issueTotal: 3 } } as any)
  expect(statusOf(short, QUEUE_NOW)).toBe('pr-agent · PR counts unknown · 3 issues')
  const issuesShort = queueOf([pr(4, 'owe', DAY)], [], QUEUE_NOW, { read: { prs: [pr(4, 'owe', DAY)], prTotal: 1, prsShort: false, issues: [], issueTotal: 3 } } as any)
  expect(statusOf(issuesShort, QUEUE_NOW)).toBe('pr-agent · ◆ your move unknown · 1 PRs · 3 issues')
})

test('the real queues: pr-agent owes 4 with nothing breached, teams-for-linux breaches both thresholds; the attention line and the status line say so', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  expect(seen.status.at(-1)).toBe('pr-agent · ◆ 4 your move · ▲ 2 new · 18 PRs · 12 issues')
  for (const surface of SURFACES) {
    for (const columns of [39, 104]) {
      const ui = await mountPane($, surface, columns, true)
      expect(await attentionOf$(ui)).toEqual([' YOU OWE 4 ', 'next: #4042'])
      const box = (await ui.find({ type: 'Box', key: 'attention' })) as any
      expect(box.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
      expect(box.children[0].children[0].props).toMatchObject({ color: 'inverseText', backgroundColor: 'planMode', bold: true })
      expect(box.children[1].props?.color).toBeUndefined()
      await ui.press({ key: 'issues' })
      expect(await attentionOf$(ui)).toEqual([' YOU OWE 4 ', 'next: #4042'])
      expect(lint(await ui.drawn())).toEqual([])
      await ui.press({ key: 'queue' })
      await ui.unmount()
    }
  }
  // teams-for-linux at this clock: its oldest live PR is 68 days old and an issue nobody has looked at 13 days.
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...TFL_PAIR })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  await seen.clock.settle()
  expect(seen.status.at(-1)).toBe('teams-for-linux · ✗ 5 blocked · ◆ 1 your move · ▲ 2 new · 11 PRs · 25 issues')
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'queue' })
  expect(await attentionOf$(ui)).toEqual([' STALE 68d ', ' NOBODY 13d ', ' YOU OWE 1 ', 'next: #2971'])
  expect((await pillsIn(ui)).map(one => one.bg)).toEqual(['error', 'error', 'planMode'])
  expect(lint(await ui.drawn())).toEqual([])
  // The legend open: five swatches more, which the budget does not count.
  await ui.press({ key: 'legend' })
  expect(await pillsIn(ui)).toHaveLength(8)
  expect(lint(await ui.drawn())).toEqual([])
  await ui.press({ key: 'legend' })
  // The pair: at most two of the queue's pills beside the decision pill, the same on every tab, and never over three.
  // Review F6: the owe pill is kept over the second act pill, since 'next' names the owed item and YOU OWE says why.
  // Review F4: the line sits at the tab row's tail on the strip; the dock's batch row (under the tabs) ends with it.
  await ui.press({ key: 'pair' })
  for (const tab of [0, 1]) {
    await ui.press({ key: `tab-${tab}` })
    expect(await attentionOf$(ui)).toEqual([' STALE 68d ', ' YOU OWE 1 ', 'next: #2971'])
    expect((await pillsIn(ui)).length).toBeLessThanOrEqual(3)
    expect(lint(await ui.drawn())).toEqual([])
    // The dock is tall: the attention pills end the batch row, not the tabs; Claude's row follows the batch row.
    const batch = (await ui.find({ type: 'Box', key: 'batch' })) as any
    expect((batch.children as any[]).map(child => String(child.props?.key ?? '')).at(-1)).toBe('attention')
    const tabs = (await ui.find({ type: 'Box', key: 'tabs' })) as any
    expect((tabs.children as any[]).map(child => String(child.props?.key ?? ''))).not.toContain('attention')
    expect((await columnOf(ui))[2]).toMatch(/^✻ Claude/)
  }
  // Tab 1 is #2998: CI failing, so its decision pill is CI FAILED; tab 2's CI is held, amber, so it has none.
  await ui.press({ key: 'tab-0' })
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' STALE 68d ', ' YOU OWE 1 ', ' CI FAILED '])
  await ui.press({ key: 'tab-1' })
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' STALE 68d ', ' YOU OWE 1 '])
  expect(seen.outward).toEqual([])
})

test('the decision row: the shown item\'s pill leads the title row, READY only when every fact is green, and the words after it stay data', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...greenPair(seen) })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 39, true)
    await ui.press({ key: 'tab-0' })
    const column = await columnOf(ui)
    // No queue read yet: no attention line, the rows as before it.
    expect(await attentionOf$(ui)).toBeUndefined()
    // The dock column is tabs, batch (the ledger names the other item), Claude's row, then the title row.
    expect(column[3]).toBe(' READY detailfix(github): avoid retrying permanent diff collection failures')
    const title = (await ui.find({ type: 'Box', key: 'title' })) as any
    expect(title.children[0].children[0].props).toMatchObject({ color: 'inverseText', backgroundColor: 'success', bold: true })
    expect(title.children[2].children[0].props.color).toBeUndefined()
    await ui.press({ key: 'tab-1' })
    expect((await columnOf(ui))[3]).toMatch(/^ HEAD MOVED detailfix\(security\)/)
    expect(lint(await ui.drawn())).toEqual([])
    await ui.unmount()
  }
})

test('NOT READ: a failed first read, a failed refresh and a five-minute-old read each put the pill where the grey title stood, and never green beside it', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  seen.modes[`${PRA}#2450`] = { kind: 'exit', stderr: 'gh: HTTP 502: Bad Gateway' }
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...greenPair(seen) })
  const ui = await mountPane($, 'terminal', 39, true)
  // Tab 2 failed on its first read: the pill, the key, and no title words at all.
  await ui.press({ key: 'tab-1' })
  const title = (await ui.find({ type: 'Box', key: 'title' })) as any
  expect(title.children.map(textOf)).toEqual([' NOT READ ', 'detail'])
  expect(title.children[0].children[0].props).toMatchObject({ color: 'inverseText', backgroundColor: 'inactive', bold: true })
  expect(await ui.find({ type: 'Text', text: 'title unknown' })).toBeUndefined()
  expect(await greenRows(ui)).toEqual([])
  // Tab 1 read: READY. Then its refresh fails: NOT READ, the title kept in text, no tick on any row. r reads the
  // queue too, and that read fails as well, so the attention line says NOT READ for the queue.
  await ui.press({ key: 'tab-0' })
  expect(await decisionOf(ui)).toBe(' READY ')
  expect(await attentionOf$(ui)).toBeUndefined()
  seen.modes['*'] = { kind: 'exit', stderr: 'gh: HTTP 502: Bad Gateway' }
  await seen.clock.advance(MINUTE)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await decisionOf(ui)).toBe(' NOT READ ')
  // Review F1: the pair's attention line never carries the queue's NOT READ (the card's own is on the decision row,
  // and the pair's poll would never clear the queue's), so here it is empty and the title row stays the third.
  expect(await attentionOf$(ui)).toBeUndefined()
  expect((await columnOf(ui))[3]).toBe(' NOT READ detailfix(github): avoid retrying permanent diff collection failures')
  expect((await ui.find({ type: 'Text', text: /^fix\(github\)/ }))?.props.color).toBeUndefined()
  expect(await greenRows(ui)).toEqual([])
  expect(lint(await ui.drawn())).toEqual([])
  // A good read again, then five minutes: stale, so NOT READ once more.
  seen.modes = {}
  await seen.clock.advance(MINUTE)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await decisionOf(ui)).toBe(' READY ')
  expect(await attentionOf$(ui)).not.toContain(' NOT READ ')
  seen.panes = []
  await seen.clock.advance(STALE_MS)
  expect(await decisionOf(ui)).toBe(' NOT READ ')
  // The queue read is five minutes old too: its owe pill stays, its NOT READ is never the pair's (review F1).
  expect(await attentionOf$(ui)).toEqual([' YOU OWE 4 ', 'next: #4042'])
  expect(lint(await ui.drawn())).toEqual([])
  expect(seen.outward).toEqual([])
})

// Review F1 and F6 (pairAttentionOf): the pair's line drops the queue's NOT READ and keeps the owe pill within its two.
test('the pair\'s attention: never the queue\'s NOT READ, no CLEAR while the queue is unread, and the owe pill kept over a second act pill', () => {
  const pr = (number: number, group: string, age: number) => ({ number, title: 't', createdAt: QUEUE_NOW - age, isDraft: false, group })
  const late = queueOf([pr(1, 'author', 30 * DAY), pr(2, 'nobody', 2 * DAY), pr(3, 'owe', DAY)])
  expect(attentionOf(late, QUEUE_NOW, []).pills.map(one => one.words)).toEqual(['STALE 30d', 'NOBODY 2d', 'YOU OWE 1'])
  expect(pairAttentionOf(late, QUEUE_NOW, false, 2)).toEqual({ pills: [{ role: 'act', words: 'STALE 30d' }, { role: 'move', words: 'YOU OWE 1' }], next: 3 })
  expect(pairAttentionOf(late, QUEUE_NOW, false, 3).pills.map(one => one.words)).toEqual(['STALE 30d', 'NOBODY 2d', 'YOU OWE 1'])
  expect(pairAttentionOf(late, QUEUE_NOW, false, 1).pills.map(one => one.words)).toEqual(['YOU OWE 1'])
  // Two act pills and nothing owed: both stay.
  const acts = queueOf([pr(1, 'author', 30 * DAY), pr(2, 'nobody', 2 * DAY)])
  expect(pairAttentionOf(acts, QUEUE_NOW, false, 2)).toEqual({ pills: [{ role: 'act', words: 'STALE 30d' }, { role: 'act', words: 'NOBODY 2d' }] })
  // The queue read five minutes old or failed: no NOT READ here, and no CLEAR either.
  expect(pairAttentionOf(late, QUEUE_NOW + STALE_MS, false, 2)).toEqual({ pills: [{ role: 'act', words: 'STALE 30d' }, { role: 'move', words: 'YOU OWE 1' }], next: 3 })
  const quiet = queueOf([pr(1, 'author', DAY)])
  expect(pairAttentionOf(quiet, QUEUE_NOW, false, 2)).toEqual({ pills: [{ role: 'ready', words: 'CLEAR' }] })
  expect(pairAttentionOf(quiet, QUEUE_NOW + STALE_MS, false, 2)).toEqual({ pills: [] })
  expect(pairAttentionOf({ repo: PRA, at: QUEUE_NOW, failed: 'GitHub error', board: 'none' }, QUEUE_NOW, false, 2)).toEqual({ pills: [] })
  expect(pairAttentionOf(quiet, QUEUE_NOW, true, 2)).toEqual({ pills: [] })
  expect(pairAttentionOf(null, QUEUE_NOW, false, 2)).toEqual({ pills: [] })
})

// Review F1 in the kit (the reviewer's probe): the pair's poll reads the cards, not the queue, so the queue read it drew
// from goes stale while the pair stays on screen; the line must not say NOT READ over fresh READY cards.
test('the pair shown for six minutes of polls keeps the queue\'s owe pill and never its NOT READ, with no queue read in between', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...greenPair(seen) })
  const ui = await mountPane($, 'terminal', 104, true)
  await ui.press({ key: 'queue' })
  await seen.clock.settle()
  expect(await attentionOf$(ui)).toEqual([' YOU OWE 4 ', 'next: #4042'])
  await ui.press({ key: 'pair' })
  await ui.press({ key: 'tab-0' })
  const reads = queueCalls(seen).length
  // Review F4: the line is the tab row's tail, so the column's rows are those of a pair with no queue read.
  const column = await columnOf(ui)
  expect(column[1]).toMatch(/^✻ Claude/)
  expect(column[2]).toBe(' READY detailfix(github): avoid retrying permanent diff collection failures')
  // I5: the facts row under the title moves the status line one row down.
  expect(column[5]).toMatch(/^✓ all clear · .* s: details$/)
  for (let i = 0; i < 6; i += 1) {
    await seen.clock.advance(MINUTE)
    await seen.clock.settle()
  }
  expect(queueCalls(seen).length).toBe(reads)
  expect(await decisionOf(ui)).toBe(' READY ')
  expect(await attentionOf$(ui)).toEqual([' YOU OWE 4 ', 'next: #4042'])
  expect(lint(await ui.drawn())).toEqual([])
  expect(seen.outward).toEqual([])
})

// Review F8: the lint's per-Box budget counts a pill under its row or the attention line through any other keyed Box
// (each of the attention line's pills sits in its own keyed Box, as the drawn line's do).
test('the lint counts a pill wrapped in a keyed Box under its row, and the attention line\'s three through their wrappers', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const pill = (words: string, key: string, bg = 'success') => Box({ key, flexShrink: 0, children: Text({ color: 'inverseText', backgroundColor: bg, bold: true, children: words }) })
    return Box({
      flexDirection: 'column',
      children: [
        Box({ key: 'row-two-boxed', flexDirection: 'row', children: [pill(' READY ', 'a'), pill(' MERGED ', 'b', 'merged'), Text({ children: 'words' })] }),
        Box({ key: 'attention', flexDirection: 'row', children: ['STALE 3d', 'NOBODY 2d', 'YOU OWE 1', 'CLEAR'].map((words, i) => pill(` ${words} `, `pill-${i}`, i < 2 ? 'error' : i === 2 ? 'planMode' : 'success')) }),
        Box({ key: 'title', flexDirection: 'row', children: [pill(' READY ', 'decision'), Text({ children: 'words' })] }),
      ],
    })
  })
  const band = await $.ui.mount({
    plugin: 'review-pair',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 104, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    viewport: { columns: 108, rows: 40, isFullscreen: true },
  })
  expect(lint(await band.drawn())).toEqual(['row row-two-boxed has 2 glyphs', 'Box "row-two-boxed" has 2 pills, over 1', 'Box "attention" has 4 pills, over 3', '7 pills drawn, over 3'])
  await band.unmount()
})

test('the queue read failed: NOT READ on the attention line of the queue and the issues views, with the amber row still saying why', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  seen.modes['queue'] = { kind: 'exit', stderr: 'gh: HTTP 502: Bad Gateway' }
  await $.command.run(TYPED)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  expect(await attentionOf$(ui)).toEqual([' NOT READ '])
  expect(await columnOf(ui)).toContain('▲ queue unknown: GitHub error y: why')
  await ui.press({ key: 'issues' })
  expect(await attentionOf$(ui)).toEqual([' NOT READ '])
  expect(seen.status.at(-1)).toBe('pr-agent · counts unknown')
  expect(lint(await ui.drawn())).toEqual([])
})

test('POSTED: the read that follows a write of Claude\'s carries the pill for one refresh, then the next read drops it', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...greenPair(seen) })
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'tab-0' })
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' READY '])
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: `gh pr review 4045 -R ${PRA} --approve` })
  await seen.clock.settle()
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' POSTED '])
  expect((await ui.find({ type: 'Box', key: 'title' }) as any).children[0].children[0].props.backgroundColor).toBe('merged')
  // The other item was not written to.
  await ui.press({ key: 'tab-1' })
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' HEAD MOVED '])
  await ui.press({ key: 'tab-0' })
  // The next poll's read: the pill is gone.
  await seen.clock.advance(MINUTE)
  await seen.clock.settle()
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' READY '])
  // A write to an item merged in the meantime shows MERGED, not POSTED.
  seen.answers[`${PRA}#4045`] = (() => {
    const merged = clone(seen.answers[`${PRA}#4045`])
    merged.data.repository.pullRequest.state = 'MERGED'
    return merged
  })()
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: `gh pr merge 4045 -R ${PRA}` })
  await seen.clock.settle()
  expect((await pillsIn(ui)).map(one => one.words)).toEqual([' MERGED '])
  expect(lint(await ui.drawn())).toEqual([])
})

test('the legend names each pill role with an example and says a bare row needs nothing', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'legend' })
  const box = (await ui.find({ type: 'Box', key: 'legend-lines' })) as any
  const lines = (box.children as any[]).map(line => (line.children as any[]).map(textOf).join(' '))
  // Review F9: the pill lines come first, so a one-column legend (56 columns) shows them in the 11-row strip; the glyph
  // lines, the older ones, follow, and the data line is last.
  expect(lines.slice(0, 6)).toEqual([
    ' CI FAILED  act now: broken or late',
    ' YOU OWE 2  your move, next: first',
    ' READY  all green; CLEAR: none owed',
    ' MERGED  done; POSTED for one refresh',
    ' NOT READ  failed or over 5 min old',
    'no pill: nothing to act on',
  ])
  expect(lines[6]).toBe('✓ passed, holds, as reviewed')
  // The keys line (review F8), the status line's s and the board's a follow the data line; I5's five ledger lines end it.
  expect(lines).toHaveLength(24)
  expect(lines[15]).toBe("Aa plain words: GitHub's data")
  expect(lines[16]).toBe('other keys: typed into the prompt')
  expect(lines.at(-1)).toBe('text 3f9a1c: sha256, draft + inline')
  for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(37)
  expect(lint(await ui.drawn())).toEqual([])
})
