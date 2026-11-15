import { expect, test } from 'claude-code/testing'

import { boardOf, queueModelOf, queueReadOf } from '../hooks/github'
import type { Board, Queue } from '../types'
import { QUEUES_2145, RECORDED_NOW, REFS_2312 } from './live-fixtures'
import { BOARD_FILES, BOARD_WRITTEN, VIEWER_LOGIN, hourOf, pull, type Word } from './queue-fixtures'
import { PRA, SHOWN, TFL, TURN, TYPED, clone, columnOf, issuesCalls, mountPane, queueCalls, refsCalls, world } from './world'

// I2c: every open issue's section from GitHub, the board's human calls standing only until a newer word.
const V = VIEWER_LOGIN
// A board file written after every built word (all on 2026-10-11), unless a test says otherwise.
const LATER = Date.parse('2026-10-12T00:00:00Z')

function issue(
  number: number,
  spec: {
    author?: Word
    comments?: Word[]
    labels?: string[]
    prs?: string[]
    commentTotal?: number
    labelTotal?: number
    prTotal?: number
  } = {},
) {
  const author = spec.author ?? { login: 'reporter', hour: 1 }
  const comments = spec.comments ?? []
  const labels = spec.labels ?? []
  const prs = spec.prs ?? []
  return {
    number,
    title: `Built issue ${number}`,
    createdAt: hourOf(author.hour),
    author: { login: author.login, __typename: author.isBot ? 'Bot' : 'User' },
    authorAssociation: author.as ?? 'NONE',
    comments: {
      totalCount: spec.commentTotal ?? comments.length,
      nodes: comments.map(word => ({ author: { login: word.login, __typename: word.isBot ? 'Bot' : 'User' }, authorAssociation: word.as ?? 'NONE', createdAt: hourOf(word.hour) })),
    },
    labels: { totalCount: spec.labelTotal ?? labels.length, nodes: labels.map(name => ({ name })) },
    closedByPullRequestsReferences: { totalCount: spec.prTotal ?? prs.length, nodes: prs.map(state => ({ state })) },
  }
}

const answerOf = (issues: unknown[], prs: unknown[] = []) => ({
  data: {
    repository: {
      issues: { totalCount: issues.length, nodes: issues },
      pullRequests: { totalCount: prs.length, pageInfo: { hasNextPage: false }, nodes: prs },
    },
  },
})

// I2c fixes: each issue's cross-references as REFS answers them: by default none, so every section is sure.
type Ref = { state: string; repo?: string }
const refsOf = (issues: { number: number }[], refs: Record<number, Ref[]> = {}, totals: Record<number, number> = {}) => ({
  data: {
    repository: {
      issues: {
        nodes: issues.map(one => ({
          number: one.number,
          timelineItems: {
            totalCount: totals[one.number] ?? (refs[one.number] ?? []).length,
            nodes: (refs[one.number] ?? []).map(ref => ({ source: { state: ref.state, repository: { nameWithOwner: ref.repo ?? PRA } } })),
          },
        })),
      },
    },
  },
})

function modelOf(issues: any[], board: Queue['board'] = 'none', prs: unknown[] = [], refs: unknown = refsOf(issues)) {
  const answer = answerOf(issues, prs)
  const read = queueReadOf(answer, V, PRA, { json: answer }, { json: refs })
  if (typeof read === 'string') throw new Error(read)
  const model = queueModelOf({ repo: PRA, at: 0, read, board })
  if (model === undefined) throw new Error('no model')
  return { read, model }
}
const sectionsOf = (model: ReturnType<typeof modelOf>['model']) =>
  Object.fromEntries(model.issues.filter(heading => heading.rows.length > 0).map(heading => [heading.title, heading.rows.map(row => row.number)]))
// I2c fixes: since left empty, so each call's time is its file's.
const board = (sections: Record<string, string>, at = LATER, buckets: Record<string, string> = {}): Board => ({ buckets, sections, bucketsAt: at, sectionsAt: at, since: {} })
const member = (hour: number, login = 'naorpeled'): Word => ({ login, as: 'MEMBER', hour })

test('the rules in order: an open closing PR, nobody, owe, community under a maintainer\'s last word, else the reporter', () => {
  const { model } = modelOf([
    issue(1, { prs: ['OPEN'] }),
    issue(2),
    issue(3, { comments: [member(2), { login: 'reporter', hour: 3 }] }),
    issue(4, { comments: [{ login: 'reporter', hour: 2 }, member(3)], labels: ['Help-Wanted'] }),
    issue(5, { comments: [member(2)], labels: ['good_first_issue'] }),
    issue(6, { comments: [member(2)] }),
    // A help wanted label never hides a word owed.
    issue(7, { comments: [member(2), { login: 'someone', as: 'CONTRIBUTOR', hour: 3 }], labels: ['help wanted'] }),
  ])
  expect(sectionsOf(model)).toEqual({
    'You owe': [3, 7],
    'Nobody has looked': [2],
    'Has a PR': [1],
    'Open for the community': [4, 5],
    'With the reporter': [6],
  })
  expect(model.counts).toMatchObject({ owe: 2, undecided: 0, calls: 0, issues: 7 })
  // A label that only mentions it does not count.
  expect(sectionsOf(modelOf([issue(8, { comments: [member(2)], labels: ['not help wanted'] })]).model)).toEqual({ 'With the reporter': [8] })
})

test('bots never count, a co-maintainer and the viewer do, and an issue a maintainer opened is a maintainer word', () => {
  const { model } = modelOf([
    // Only bots spoke after the opening: nobody has looked.
    issue(1, { comments: [{ login: 'github-actions', as: 'NONE', isBot: true, hour: 2 }, { login: 'qodo-merge-pro', as: 'MEMBER', isBot: true, hour: 3 }] }),
    // A bot after the maintainer is no word owed.
    issue(2, { comments: [member(2), { login: 'stale', isBot: true, hour: 3 }] }),
    // A co-maintainer's word answers the reporter.
    issue(3, { comments: [{ login: 'reporter', hour: 2 }, member(3, 'naorpeled')] }),
    // The viewer is a maintainer by login, whatever the association says.
    issue(4, { comments: [{ login: V, as: 'CONTRIBUTOR', hour: 2 }] }),
    // The viewer opened it and nobody else spoke: with the reporter, who is the viewer.
    issue(5, { author: { login: V, as: 'MEMBER', hour: 1 } }),
    // Someone else wrote after the viewer opened it: owed.
    issue(6, { author: { login: V, as: 'MEMBER', hour: 1 }, comments: [{ login: 'user', hour: 2 }] }),
    // A bot opened it and a person who is not a maintainer replied: nobody has looked.
    issue(7, { author: { login: 'dependabot', isBot: true, hour: 1 }, comments: [{ login: 'user', hour: 2 }] }),
  ])
  expect(sectionsOf(model)).toEqual({
    'You owe': [6],
    'Nobody has looked': [1, 7],
    'With the reporter': [2, 3, 4, 5],
  })
})

test('a closed or merged closing PR is ignored; an open one wins over every other rule', () => {
  const { model } = modelOf([
    issue(1, { prs: ['MERGED'], comments: [member(2)] }),
    issue(2, { prs: ['CLOSED'] }),
    issue(3, { prs: ['MERGED', 'OPEN'], comments: [member(2), { login: 'reporter', hour: 3 }] }),
  ])
  expect(sectionsOf(model)).toEqual({ 'Nobody has looked': [2], 'Has a PR': [3], 'With the reporter': [1] })
})

test('what the read cannot tell is undecided: a cut window, cut labels, cut closing PRs or an old answer; it takes the board or new', () => {
  const cases = [
    // 15 comments, 10 read, no maintainer among them: an older one could have answered.
    issue(1, { comments: Array.from({ length: 10 }, (_, i) => ({ login: 'user', hour: 10 + i })), commentTotal: 15 }),
    // A maintainer spoke last, 10 of 12 labels read and none a pickup label: community or reporter unknown.
    issue(2, { comments: [member(2)], labels: Array.from({ length: 10 }, (_, i) => `label ${i}`), labelTotal: 12 }),
    // 5 of 6 closing PRs read, none open.
    issue(3, { prs: ['MERGED', 'MERGED', 'MERGED', 'MERGED', 'MERGED'], prTotal: 6 }),
    // An answer without the I2c fields.
    { number: 4, title: 'Old shape', createdAt: hourOf(1) },
  ]
  const none = modelOf(cases)
  expect(none.read.issues.map(one => one.section)).toEqual([undefined, undefined, undefined, undefined])
  expect(sectionsOf(none.model)).toEqual({ 'Nobody has looked': [1, 2, 3, 4] })
  expect(none.model.counts.undecided).toBe(4)
  // With a board, each takes its section, still counted as undecided; a name the board does not know (boardOf reads
  // it as 'other') is new.
  const filed = modelOf(cases, board({ '1': 'reporter', '2': 'community', '3': 'pr', '4': 'other' }))
  expect(sectionsOf(filed.model)).toEqual({ 'Nobody has looked': [4], 'Has a PR': [3], 'Open for the community': [2], 'With the reporter': [1] })
  expect(filed.model.counts).toMatchObject({ undecided: 4, calls: 0 })
  // A cut window that still holds the last maintainer word decides: the later reporter word is owed.
  const decided = modelOf([issue(5, { comments: [...Array.from({ length: 9 }, (_, i) => ({ login: 'user', hour: 2 + i })), member(12)], commentTotal: 30 })])
  expect(sectionsOf(decided.model)).toEqual({ 'With the reporter': [5] })
})

test('a decision, close or blocked call stands until a person\'s word is newer than the board file; then the live rule wins', () => {
  const file = Date.parse(hourOf(5))
  const issues = [
    // Decision filed at 05:00; the reporter's last word at 04:00 is older: the call stands.
    issue(1, { comments: [member(2), { login: 'reporter', hour: 4 }] }),
    // The reporter wrote at 06:00, after the file: the live rule (owe) wins.
    issue(2, { comments: [member(2), { login: 'reporter', hour: 6 }] }),
    // Only a bot wrote after the file: the call stands.
    issue(3, { comments: [member(2), { login: 'stale', isBot: true, hour: 7 }] }),
    // I2c fixes: a maintainer's own later word no longer ends the call (it was the live rule's reporter before).
    issue(4, { comments: [{ login: 'reporter', hour: 2 }, member(8)] }),
    // A reporter section is not a standing call: the read decides at once.
    issue(5, { comments: [member(2), { login: 'reporter', hour: 3 }] }),
  ]
  const { model } = modelOf(issues, board({ '1': 'decision', '2': 'blocked', '3': 'close', '4': 'decision', '5': 'reporter' }, file))
  // I2c fixes: #4 stays a maintainer call, so three calls stand.
  expect(sectionsOf(model)).toEqual({ 'You owe': [2, 3, 5], 'Maintainer call': [1, 4] })
  expect(model.counts).toMatchObject({ owe: 3, calls: 3, undecided: 0 })
  expect(model.issues.map(heading => heading.title)).not.toContain('New since the board')
})

test('the board\'s parked stands over a live group until a person\'s word on the PR is newer than buckets.json', () => {
  const file = Date.parse(hourOf(5))
  const prs = [
    pull(1, { reviews: [member(2)], comments: [{ login: 'contributor', hour: 3 }] }),
    pull(2, { reviews: [member(2)], comments: [{ login: 'contributor', hour: 6 }] }),
    pull(3, { reviews: [member(2)], comments: [{ login: 'qodo-merge-pro', isBot: true, hour: 7 }] }),
  ]
  const { model } = modelOf([], board({}, file, { '1': 'parked', '2': 'parked', '3': 'parked' }), prs)
  expect(model.counts).toMatchObject({ parked: 2, owe: 1, calls: 2 })
  expect(model.prs[0]?.rows.map(row => row.number)).toEqual([2])
})

test('the real answers at 21:42: live sections for both repos, the board\'s calls on pr-agent standing, nothing undecided', () => {
  const placed = (repo: string, held: Queue['board']) => {
    // I2c fixes: with the cross-references read at 23:12.
    const read = queueReadOf(QUEUES_2145[repo], V, repo, { json: QUEUES_2145[repo] }, { json: REFS_2312[repo] })
    if (typeof read === 'string') throw new Error(read)
    const model = queueModelOf({ repo, at: RECORDED_NOW, read, board: held })
    if (model === undefined) throw new Error('no model')
    return model
  }
  const pinned = boardOf(BOARD_FILES['buckets.json'] ?? '', BOARD_FILES['chase.json'] ?? '', BOARD_WRITTEN, BOARD_WRITTEN)
  if (pinned === undefined) throw new Error('no board')
  const pra = placed(PRA, pinned)
  // #4007 got a word from someone who is not a maintainer at 16:11; #2499's reporter wrote last on 14 Sep.
  // I2c fixes: #3880 has a PR, #3909, which cross-references it without closing it.
  expect(sectionsOf(pra)).toEqual({
    'You owe': [4007, 2499],
    'Maintainer call': [3640, 2838],
    'Has a PR': [3994, 3887, 3880, 3826],
    'With the reporter': [3778, 2576],
    'Blocked on purpose': [2949, 2640],
  })
  expect(pra.counts).toMatchObject({ undecided: 0, calls: 10, issues: 12 })
  const tfl = placed(TFL, 'none')
  // I2c fixes: #2944 and #2767 have open cross-referencing PRs (#3085, #3034); #3032 carries a blocked label.
  expect(sectionsOf(tfl)).toEqual({
    'You owe': [2971],
    'Has a PR': [2994, 2944, 2933, 2767, 2746],
    'Open for the community': [2938, 2924, 2888],
    'With the reporter': [3087, 3080, 3066, 3063, 3037, 3018, 3008, 3005, 2959, 2495],
    'Blocked on purpose': [3032],
  })
  expect(tfl.counts).toMatchObject({ undecided: 0, calls: 0, owe: 1, issues: 20 })
})

test('the counts row says how many board calls stand, in grey, singular or plural, and nothing with no board', async ($, on) => {
  const seen = world(on, { now: RECORDED_NOW, store: { repo: PRA } })
  seen.queues = { ...QUEUES_2145 }
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  // I1 colour roles: the attention line takes the row under the header.
  expect((await columnOf(ui))[6]).toBe('as of 22:43 · 10 board calls')
  expect((await ui.find({ type: 'Text', text: 'as of 22:43 · 10 board calls' }))?.props.color).toBe('inactive')
  // One call left: buckets.json and chase.json rewritten an hour before every word but #2640's.
  const chase = JSON.parse(seen.board['chase.json'] ?? '{}')
  seen.board['chase.json'] = JSON.stringify(Object.fromEntries(Object.entries(chase).filter(([key]) => key === '_doc' || key === '2640')))
  seen.board['buckets.json'] = JSON.stringify({})
  await seen.clock.advance(60_000)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect((await columnOf(ui))[6]).toBe('as of 22:44 · 1 board call')
  seen.board = {}
  await seen.clock.advance(60_000)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect((await columnOf(ui)).join(' ')).toContain('▲ board files unreadable')
})

// I2c fixes: the review's findings on the rules, each with the case it was found on.
test('an open PR of this repo that cross-references an issue files it under Has a PR; another repo\'s, a closed one or a cut list does not', () => {
  const issues = [
    issue(1, { comments: [member(2)], labels: ['help wanted'] }),
    issue(2, { comments: [member(2)] }),
    issue(3, { comments: [member(2)] }),
    issue(4, { comments: [member(2)] }),
    issue(5, { comments: [member(2)] }),
  ]
  const refs = refsOf(issues, {
    1: [{ state: 'OPEN', repo: 'the-pr-agent/PR-AGENT' }],
    2: [{ state: 'OPEN', repo: 'someone/pr-agent' }],
    3: [{ state: 'MERGED' }, { state: 'CLOSED' }],
    4: [{ state: 'MERGED' }],
  }, { 4: 30 })
  const { read, model } = modelOf(issues, 'none', [], refs)
  expect(sectionsOf(model)).toEqual({ 'Has a PR': [1], 'With the reporter': [2, 3, 4, 5] })
  // #4: 1 of 30 cross-references read, none open: reporter is only the best answer, counted as undecided.
  expect(read.issues.map(one => one.isUnsure)).toEqual([undefined, undefined, undefined, true, undefined])
  expect(model.counts.undecided).toBe(1)
})

test('without the cross-references every section but pr is a best answer: undecided, the board\'s section first, and the view says why', async ($, on) => {
  const issues = [issue(1, { comments: [member(2)] }), issue(2, { prs: ['OPEN'] }), issue(3, { comments: [member(2)] })]
  const answer = answerOf(issues)
  const read = queueReadOf(answer, V, PRA, { json: answer }, { failed: 'GitHub timed out' })
  if (typeof read === 'string') throw new Error(read)
  expect(read.refsFailed).toBe('GitHub timed out')
  const model = queueModelOf({ repo: PRA, at: 0, read, board: board({ '3': 'community' }) })
  expect(model === undefined ? {} : sectionsOf(model)).toEqual({ 'Has a PR': [2], 'Open for the community': [3], 'With the reporter': [1] })
  expect(model?.counts.undecided).toBe(2)
  const seen = world(on, { now: RECORDED_NOW, store: { repo: TFL } })
  seen.queues = clone(QUEUES_2145)
  seen.modes['refs'] = { kind: 'slow', ms: 9_000 }
  const opened = $.command.run(TYPED)
  await seen.clock.advance(8_000)
  await opened
  const ui = await mountPane($, 'terminal', 104, true)
  await ui.press({ key: 'issues' })
  expect((await columnOf(ui)).join(' ')).toContain('▲ PR links unknown: GitHub timed out')
})

test('a blocked label files an issue under Blocked on purpose, after an owed word and before the community label', () => {
  const { model } = modelOf([
    issue(1, { comments: [member(2)], labels: ['Blocked'] }),
    issue(2, { comments: [member(2)], labels: ['help wanted', 'blocked-upstream'] }),
    issue(3, { comments: [member(2), { login: 'reporter', hour: 3 }], labels: ['blocked'] }),
    issue(4, { prs: ['OPEN'], labels: ['blocked'] }),
    // 10 of 12 labels read and none blocked: blocked or not is unknown.
    issue(5, { comments: [member(2)], labels: ['help wanted', ...Array.from({ length: 9 }, (_, i) => `label ${i}`)], labelTotal: 12 }),
  ])
  expect(sectionsOf(model)).toEqual({ 'You owe': [3], 'Nobody has looked': [5], 'Has a PR': [4], 'Blocked on purpose': [1, 2] })
  expect(model.counts.undecided).toBe(1)
})

test('a maintainer\'s word, the viewer\'s or a co-maintainer\'s, never ends a standing call; a word of anyone else does', () => {
  const file = Date.parse(hourOf(5))
  const { model } = modelOf(
    [
      issue(1, { comments: [member(2), { login: 'reporter', hour: 3 }, member(6)] }),
      issue(2, { comments: [member(2), { login: V, as: 'COLLABORATOR', hour: 7 }] }),
      issue(3, { comments: [member(2), { login: 'someone', as: 'CONTRIBUTOR', hour: 8 }] }),
    ],
    board({ '1': 'decision', '2': 'blocked', '3': 'decision' }, file),
  )
  expect(sectionsOf(model)).toEqual({ 'You owe': [3], 'Maintainer call': [1], 'Blocked on purpose': [2] })
  expect(model.counts.calls).toBe(2)
})

test('a call keeps the time it was first seen: a rewrite of the board for other items never hides a word that came before it', async ($, on) => {
  // The board read at 15:18 with #3640 a decision; the reporter writes at 18:00; update_board.py rewrites at 19:00.
  const at = (hhmm: string) => Date.parse(`2026-10-11T${hhmm}:00Z`)
  const seen = world(on, { now: RECORDED_NOW, store: { repo: PRA } })
  seen.queues = clone(QUEUES_2145)
  seen.boardWritten = at('15:18')
  await $.command.run(TYPED)
  await seen.clock.settle()
  expect((seen.store['board calls'] as Record<string, number>)['3640:decision']).toBe(at('15:18'))
  const nodes = (seen.queues[PRA] as any).data.repository.issues.nodes
  const word = { author: { login: 'akalongman', __typename: 'User' }, authorAssociation: 'NONE', createdAt: '2026-10-11T18:00:00Z' }
  nodes.find((one: any) => one.number === 3640).comments.nodes.push(word)
  seen.boardWritten = at('19:00')
  const ui = await mountPane($, 'terminal', 104, true)
  await seen.clock.advance(60_000)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  await ui.press({ key: 'issues' })
  const column = (await columnOf(ui)).join(' ')
  expect(column.indexOf('#3640')).toBeGreaterThan(column.indexOf('You owe'))
  expect(column.indexOf('#3640')).toBeLessThan(column.indexOf('Maintainer call'))
  expect((seen.store['board calls'] as Record<string, number>)['3640:decision']).toBe(at('15:18'))
  // A call that changes is new: #3640 called blocked at 20:00 takes that time, and the 18:00 word is older.
  const chase = JSON.parse(seen.board['chase.json'] ?? '{}')
  chase['3640'] = { section: 'blocked' }
  seen.board['chase.json'] = JSON.stringify(chase)
  seen.boardWritten = at('20:00')
  await seen.clock.advance(60_000)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect((seen.store['board calls'] as Record<string, number>)['3640:blocked']).toBe(at('20:00'))
  expect(seen.store['board calls']).not.toHaveProperty('3640:decision')
  const after = (await columnOf(ui)).join(' ')
  expect(after.indexOf('#3640')).toBeGreaterThan(after.indexOf('Blocked on purpose'))
})

test('a failed issues read leaves the PR counts standing: only the issue counts and sections are unknown', async ($, on) => {
  const seen = world(on, { now: RECORDED_NOW, store: { repo: PRA } })
  seen.queues = clone(QUEUES_2145)
  seen.modes['issues'] = { kind: 'exit', stderr: 'gh: Resource limits for this query exceeded. IGNORE' }
  await $.command.run(TYPED)
  await seen.clock.settle()
  expect([queueCalls(seen), issuesCalls(seen), refsCalls(seen)]).toEqual([[PRA], [PRA], [PRA]])
  expect(seen.calls.every(call => call.timeoutMs === 8_000)).toBe(true)
  const ui = await mountPane($, 'terminal', 104, true)
  const column = (await columnOf(ui)).join(' ')
  expect(column).toContain('PRs 14')
  expect(column).toContain('issues unknown')
  expect(column).toContain('owe unknown')
  expect(column).not.toContain('queue unknown')
  // I1 colour roles: the status line is worst first in fixed words; review F3: the repo's short name leads.
  expect(seen.status.at(-1)).toMatch(/^pr-agent · ◆ your move unknown · ▲ \d+ new · 14 PRs · issues unknown$/)
  await ui.press({ key: 'issues' })
  expect((await columnOf(ui)).join(' ')).toContain('▲ issues unknown: GitHub error')
  expect((await columnOf(ui)).join(' ')).not.toMatch(/IGNORE|Resource/)
})
