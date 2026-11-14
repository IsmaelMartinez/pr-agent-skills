import { expect, test } from 'claude-code/testing'

import { QUEUE, queueModelOf, queueReadOf } from '../hooks/github'
import type { Board, Queue } from '../types'
import { QUEUES, TILES, VIEWER_LOGIN, answerOf, pull } from './queue-fixtures'
import { PRA, QUEUE_NOW, TFL, TYPED, mountPane, textOf, world, opened } from './world'

// I2a: every ready PR's group worked out from the queue read, by the board's own definitions.
const V = VIEWER_LOGIN
const maintainer = (hour: number, login = 'naorpeled', as = 'MEMBER') => ({ login, as, hour })
// I2c: a board call stands until a person's word is newer than its file; these files postdate every built word.
const LATER = Date.parse('2026-10-12T00:00:00Z')
// I2c fixes: a Board carries since, empty here so each call's time is its file's.
const boardOf = (buckets: Record<string, string>): Board => ({ buckets, sections: {}, bucketsAt: LATER, sectionsAt: LATER, since: {} })

function modelOf(prs: unknown[], board: Queue['board'] = 'none') {
  // I2c fixes: the issues and their cross-references are read on their own; here both are the same empty answer.
  const answer = answerOf(prs)
  const read = queueReadOf(answer, V, PRA, { json: answer }, { json: answer })
  if (typeof read === 'string') throw new Error(read)
  const model = queueModelOf({ repo: PRA, at: 0, read, board })
  if (model === undefined) throw new Error('no model')
  return model
}
// I2: the parked PRs are a heading of their own (the view collapses it); these tests pin the three live groups.
const groupsOf = (model: ReturnType<typeof modelOf>) => Object.fromEntries(model.prs.filter(heading => heading.key !== 'parked').map(heading => [heading.key, heading.rows.map(row => row.number)]))

// The words of a drawn node with its parts spaced, a plain Button as the terminal paints it ('a: #4060').
function wordsOf(node: unknown): string {
  const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (typeof node === 'string') return node
  if (element?.type === 'Button') {
    const label = String(element.props?.label ?? '')
    return element.props?.hotkey === undefined ? label : `${String(element.props.hotkey)}: ${label}`
  }
  if (element?.type === 'Text') return textOf(node)
  // I2: the cursor cell is one space on every row but the cursor's, and reads as nothing.
  return (element?.children ?? []).map(wordsOf).filter(words => words !== '' && words !== ' ').join(' ')
}

async function columnOf(ui: any): Promise<string[]> {
  const root = (await ui.drawn()) as { children?: unknown[] }
  return (root.children ?? []).map(wordsOf)
}

// Each heading the view draws and the numbers of the rows under it.
// I2: a collapsible group (the queue's author and parked, a long issues section) draws as one focusable row until
// opened, its heading the row's Button; the rows under it are read with every group opened, as Enter opens them.
async function sectionsOf(ui: any): Promise<Record<string, number[]>> {
  for (const button of await ui.findAll({ type: 'Button' })) {
    const key = String(button.key ?? '')
    if (key.startsWith('group-')) await opened(ui, key)
  }
  const root = (await ui.drawn()) as { children?: { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }[] }
  const sections: Record<string, number[]> = {}
  let heading = ''
  for (const child of root.children ?? []) {
    const key = String(child.key ?? child.props?.key ?? '')
    if (child.type === 'Text' && child.props?.bold === true) sections[(heading = String((child.children ?? []).join('')))] = []
    const group = /^row-(group-[a-z]+)$/.exec(key)
    if (group !== null) sections[(heading = String((await ui.find({ type: 'Button', key: group[1] }))?.props.label))] = []
    const row = /^row-(pull|issues)-([0-9]+)$/.exec(key)
    if (row !== null) sections[heading]?.push(Number(row[2]))
  }
  return sections
}

test('a draft is draft and the viewer\'s own PR is mine, whatever else either carries', () => {
  const model = modelOf([
    pull(1, { isDraft: true, comments: [maintainer(3)], labels: ['do not merge'] }),
    pull(2, { author: V, labels: ['do not merge'], assignees: ['naorpeled'], comments: [{ login: V, hour: 3 }] }),
  ])
  expect(model.counts).toMatchObject({ draft: 1, yours: 1, parked: 0, owe: 0, new: 0, author: 0, undecided: 0 })
})

test('a hold label parks it however it is spelled; one that only mentions it does not, and no label is drawn', () => {
  const said = { reviews: [maintainer(3)] }
  const model = modelOf([
    pull(1, { ...said, labels: ['enhancement', 'Do-Not_Merge (wip)'] }),
    pull(2, { ...said, labels: ['do not merge'] }),
    pull(3, { ...said, labels: ['DO_NOT_MERGE'] }),
    pull(4, { ...said, labels: ['please do not merge'] }),
    pull(5, { ...said, labels: ['merge-ready', 'do-not-review'] }),
  ])
  expect(model.counts).toMatchObject({ parked: 3, author: 2, undecided: 0 })
  expect(groupsOf(model).author).toEqual([4, 5])
  expect(JSON.stringify(model)).not.toMatch(/wip|Merge|merge|review/)
})

test('an assignee parks it unless the assignee is the viewer or the PR\'s own author', () => {
  const said = { reviews: [maintainer(3)] }
  const model = modelOf([
    pull(1, { ...said, author: 'PeterDaveHello', assignees: ['peterdavehello'] }),
    pull(2, { ...said, assignees: [V] }),
    pull(3, { ...said, assignees: ['naorpeled'] }),
    pull(4, { ...said, author: 'utsab345', assignees: ['utsab345', 'mrT23'] }),
  ])
  expect(groupsOf(model).author).toEqual([1, 2])
  expect(model.counts.parked).toBe(2)
})

test('the board\'s parked stays over a live group, and its other buckets give way to the read', () => {
  const model = modelOf(
    [
      pull(5, { reviews: [maintainer(3)], comments: [{ login: 'contributor', hour: 4 }] }),
      pull(6, { reviews: [maintainer(3)] }),
      pull(7, {}),
    ],
    boardOf({ '5': 'parked', '6': 'owe', '7': 'author' }),
  )
  expect(groupsOf(model)).toEqual({ owe: [], nobody: [7], author: [6] })
  expect(model.counts).toMatchObject({ parked: 1, undecided: 0 })
  // The viewer's own PR stays mine even when the board files it parked.
  const own = modelOf([pull(8, { author: V, reviews: [maintainer(3)] })], boardOf({ '8': 'parked' }))
  expect(own.counts).toMatchObject({ yours: 1, parked: 0 })
})

test('nobody has looked: bots, community comments and the author reviewing their own PR never count as a maintainer', () => {
  const model = modelOf([
    pull(1, { comments: [{ login: 'qodo-merge-pro', as: 'MEMBER', isBot: true, hour: 3 }], reviews: [{ login: 'copilot-pull-request-reviewer', as: 'NONE', isBot: true, hour: 4 }] }),
    pull(2, { comments: [{ login: 'itsvrushabh', as: 'CONTRIBUTOR', hour: 3 }, { login: 'ashearin', as: 'NONE', hour: 5 }] }),
    pull(3, { author: 'naorpeled', reviews: [{ login: 'naorpeled', as: 'MEMBER', hour: 3 }], comments: [{ login: 'naorpeled', as: 'MEMBER', hour: 4 }] }),
    // The viewer counts whatever GitHub calls them on this repo.
    pull(4, { comments: [{ login: V, as: 'CONTRIBUTOR', hour: 3 }] }),
  ])
  expect(groupsOf(model)).toEqual({ owe: [], nobody: [1, 2, 3], author: [4] })
})

test('owe, with back, when the author\'s word, own review or own commit comes after the last maintainer word; else author', () => {
  const model = modelOf([
    pull(1, { author: 'PeterDaveHello', reviews: [maintainer(5)], comments: [{ login: 'PeterDaveHello', as: 'CONTRIBUTOR', hour: 6 }] }),
    pull(2, { author: 'PeterDaveHello', reviews: [maintainer(7)], comments: [{ login: 'PeterDaveHello', hour: 6 }] }),
    pull(3, { author: 'utsab345', comments: [maintainer(7, 'mrT23', 'OWNER')], commit: { login: 'utsab345', hour: 8 } }),
    pull(4, { author: 'utsab345', comments: [maintainer(7, 'okotek', 'COLLABORATOR')], commit: { login: 'naorpeled', hour: 8 } }),
    pull(5, { author: 'utsab345', reviews: [maintainer(4), { login: 'utsab345', hour: 6 }] }),
    // A co-maintainer's word after the viewer's review is the last maintainer word; a bot after the author is nothing.
    pull(6, { reviews: [{ login: V, hour: 3 }], comments: [{ login: 'contributor', hour: 4 }, maintainer(5), { login: 'qodo-merge-pro', isBot: true, hour: 6 }] }),
  ])
  expect(groupsOf(model)).toEqual({ owe: [1, 3, 5], nobody: [], author: [2, 4, 6] })
  const owed = model.prs[0]?.rows ?? []
  expect(owed.map(row => [row.tier, row.note])).toEqual([
    ['warn', 'back'],
    ['warn', 'back'],
    ['warn', 'back'],
  ])
  expect(model.prs[2]?.rows.every(row => row.tier === 'note' && row.note === undefined)).toBe(true)
})

test('a window cut short that could hide a maintainer word falls back to the board, or to new, and is counted', () => {
  const hidden = { commentTotal: 14, comments: [{ login: 'itsvrushabh', hour: 3 }, { login: 'contributor', hour: 4 }, { login: 'the-pr-agent-bot', isBot: true as const, hour: 6 }] }
  const prs = [
    pull(1, hidden),
    // Cut short, but its oldest comment read is older than a maintainer review read: nothing hidden can be later.
    pull(2, { ...hidden, reviews: [maintainer(5)] }),
    pull(3, { reviews: [maintainer(3)], labels: ['bug'], labelTotal: 12 }),
    pull(4, { reviewTotal: 11, reviews: [maintainer(4)], comments: [maintainer(2)] }),
  ]
  const board = modelOf(prs, boardOf({ '1': 'author', '3': 'owe' }))
  expect(groupsOf(board)).toEqual({ owe: [3], nobody: [], author: [1, 2, 4] })
  expect(board.counts.undecided).toBe(2)
  // No back note on a row the board filed.
  expect(board.prs[0]?.rows[0]?.note).toBeUndefined()
  const none = modelOf(prs)
  expect(groupsOf(none)).toEqual({ owe: [], nobody: [1, 3], author: [2, 4] })
  expect(none.counts.undecided).toBe(2)
})

test('the 07:35 answer without the new fields falls back to the board whole, and the board\'s own tiles hold', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  seen.queues[PRA] = QUEUES[PRA]
  await $.command.run(TYPED)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  const column = await columnOf(ui)
  // I2c: its issues lack the new fields too, so the eight the board does not hold by a standing call are undecided and
  // take its section; the board-age caption gave way to the read's time and the calls in effect.
  // I2c fixes: four of those eight (#3994, #3887, #3880, #3826) have an open cross-referencing PR, which decides pr
  // whatever else the answer lacks.
  // I1 colour roles: the attention line (CLEAR here) takes one row under the header, so the counts move down one.
  expect(column[2]).toBe(' CLEAR ')
  expect(column.slice(3, 7)).toEqual(['owe 0 ▲ new 2', 'author 9 ▲ 15 undecided', 'PRs 18 issues 12', 'as of 08:35 · 11 board calls'])
  const sections = await sectionsOf(ui)
  expect(sections).toMatchObject({
    'Nobody has looked (2)': [4060, 4061],
    'Waiting on the author (9)': [3752, 3995, 4042, 4043, 4048, 4049, 4053, 4054, 4059],
  })
  expect(TILES['Nobody has looked']).toBe(2)
  expect(TILES['PRs waiting on the author']).toBe(9)
  expect(TILES['You owe the next move']).toBe(0)
  // I1 colour roles: the status line is worst first in fixed words, its zero parts dropped; review F3: the repo's
  // short name leads (every status string in this file).
  expect(seen.status.at(-1)).toBe('pr-agent · ▲ 2 new · 18 PRs · 12 issues')
})

test('the real queue grouped live: returned authors sit under You owe, and the status line drops back', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  // I2c: issues are placed live too: #2499's reporter wrote after the last maintainer word, so it is owed.
  // I1 colour roles: the status line is worst first in fixed words; the attention line takes a row under the header.
  expect(seen.status.at(-1)).toBe('pr-agent · ◆ 4 your move · ▲ 2 new · 18 PRs · 12 issues')
  const ui = await mountPane($, 'terminal', 39, true)
  const column = await columnOf(ui)
  expect(column[2]).toBe(' YOU OWE 4  next: #4042')
  expect(column.slice(3, 7)).toEqual(['▲ owe 4 ▲ new 2', 'author 6', 'PRs 18 issues 12', 'as of 08:35 · 11 board calls'])
  expect(await sectionsOf(ui)).toMatchObject({
    'You owe the next move (4)': [4042, 4048, 4053, 2499],
    'Nobody has looked (2)': [4060, 4061],
    'Waiting on the author (6)': [3752, 3995, 4043, 4049, 4054, 4059],
  })
  expect(column.find(row => row.includes('#4048'))).toMatch(/ back · [0-9]+h$/)
  // I2: the parked PRs are a collapsed group now, so the chip keeps the drafts.
  expect(column.at(-1)).toBe('draft 1')
  expect(column.join(' ')).not.toMatch(/[0-9]+ back|back unknown/)
  await ui.unmount()
  const wide = await mountPane($, 'terminal', 104, true)
  expect((await columnOf(wide)).slice(2, 4)).toEqual(['▲ owe 4 ▲ new 2 author 6', 'PRs 18 issues 12 as of 08:35 · 11 board calls'])
})

test('a repo with no board groups its PRs too: owe, nobody and author from the read, undecided ones as new', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: TFL } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 39, true)
  const column = await columnOf(ui)
  // I2c: its issues are placed live as well (#2971 is owed); the five closed by 21:42 have no fields and are undecided.
  // With no board there is no caption about it, only the read's time.
  // I1 colour roles: teams-for-linux breaches both thresholds at this clock (its oldest live PR is 68 days old, and an
  // issue nobody has looked at 13 days), so the attention line leads with the two act pills, then the owe pill.
  expect(column[2]).toBe(' STALE 68d   NOBODY 13d   YOU OWE 1  next: #2971')
  expect(column.slice(3, 7)).toEqual(['▲ owe 1 ▲ new 2', 'author 9 ▲ 5 undecided', 'PRs 11 issues 25', 'as of 08:35'])
  expect(await sectionsOf(ui)).toEqual({
    'You owe the next move (1)': [2971],
    'Nobody has looked (2)': [3090, 3091],
    'Waiting on the author (9)': [2789, 2791, 2872, 2891, 2935, 2998, 3020, 3031, 3036],
  })
  // I2: nothing is parked, so no parked group draws, and the chip keeps the drafts.
  expect(column.at(-1)).toBe('draft 4')
  // Review F2: blocked is the 5 stale PRs; the rows nobody has looked at are the new count, not blocked as well.
  expect(seen.status.at(-1)).toBe('teams-for-linux · ✗ 5 blocked · ◆ 1 your move · ▲ 2 new · 11 PRs · 25 issues')
  expect(seen.fsCalls).toEqual([])
})

// I2a fixes, from the review of the first build.
test('the queue asks for the viewer\'s last submitted review, so a pending one never stands in for it', () => {
  expect(QUEUE).toContain('mine: reviews(last: 1, author: $me, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED])')
})

test('the queue asks for every count the groups need, or every live PR would fall back undecided', () => {
  for (const field of ['reviews(last: 10) { totalCount', 'comments(last: 10) { totalCount', 'labels(first: 10) { totalCount', 'assignees(first: 5) { totalCount']) {
    expect(QUEUE).toContain(field)
  }
})

test('a PR whose author is gone cannot be decided: it falls back and is counted', () => {
  const model = modelOf([
    { ...pull(1, { comments: [maintainer(3)] }), author: null },
    { ...pull(2, { reviews: [{ login: V, hour: 3 }] }), author: null },
  ])
  expect(groupsOf(model)).toEqual({ owe: [], nobody: [1, 2], author: [] })
  expect(model.counts.undecided).toBe(2)
})

test('the viewer\'s review of the head holds over a later-dated commit, a pending review is no word, a cut-short assignee list is undecided', () => {
  const guarded = pull(1, { reviews: [{ login: V, hour: 3 }], commit: { login: 'contributor', hour: 5 } })
  guarded.mine.nodes[0]!.commit.oid = guarded.headRefOid
  const pending = pull(2, { reviews: [maintainer(3)], comments: [{ login: 'contributor', hour: 5 }] })
  pending.reviews.nodes.push({ author: { login: V, __typename: 'User' }, authorAssociation: 'MEMBER', submittedAt: null as unknown as string })
  const model = modelOf([guarded, pending, pull(3, { reviews: [maintainer(3)], assignees: [V], assigneeTotal: 6 })])
  expect(groupsOf(model)).toEqual({ owe: [2], nobody: [3], author: [1] })
  expect(model.counts.undecided).toBe(1)
})

// A PR the board does not list, cut short, is filed as new: the words never say the board filed it.
for (const repo of [PRA, TFL]) {
  test(`the counts row says undecided in the same fixed words on ${repo}, board or not`, async ($, on) => {
    const hidden = { commentTotal: 14, comments: [{ login: 'itsvrushabh', hour: 3 }, { login: 'contributor', hour: 4 }] }
    const seen = world(on, { now: QUEUE_NOW, store: { repo } })
    seen.queues[repo] = answerOf([pull(9001, hidden), pull(9002, { reviews: [maintainer(3)] })])
    await $.command.run(TYPED)
    await seen.clock.settle()
    const column = (await columnOf(await mountPane($, 'terminal', 39, true))).join(' | ')
    expect(column).toContain('author 1 ▲ 1 undecided')
    expect(column).not.toContain('from the board')
  })
}

// The viewer runs pr-agent locally and publishes its output with their own token: that is a tool's comment, no maintainer word.
const guide = (hour: number) => ({ login: V, as: 'COLLABORATOR', hour, body: '## PR Reviewer Guide 🔍\n\n<!-- pr-agent:review:full -->\nlong text' })

test('the queue reads comment bodies, to tell the viewer\'s pr-agent output from their words', () => {
  expect(QUEUE).toContain('comments(last: 10) { totalCount nodes { author { login __typename } authorAssociation createdAt body } }')
})

test('a PR whose only viewer comment is a pr-agent guide is nobody\'s, not waiting on the author', () => {
  const marked = { login: V, as: 'COLLABORATOR', hour: 3, body: 'text\n<!-- pr-agent:code_suggestions -->' }
  const suggestions = { login: V, as: 'COLLABORATOR', hour: 3, body: '## PR Code Suggestions ✨' }
  const model = modelOf([pull(1, { comments: [guide(3)] }), pull(2, { comments: [marked] }), pull(3, { comments: [suggestions] }), pull(4, { comments: [{ login: V, as: 'COLLABORATOR', hour: 3, body: 'looks fine' }] })])
  expect(groupsOf(model)).toEqual({ owe: [], nobody: [1, 2, 3], author: [4] })
})

test('a real viewer review stays the last maintainer word under a later guide', () => {
  const model = modelOf([pull(1, { reviews: [{ login: V, as: 'COLLABORATOR', hour: 3 }], comments: [guide(6)] })])
  expect(groupsOf(model)).toEqual({ owe: [], nobody: [], author: [1] })
})

test('the author answering a real review before a guide owes the maintainer the move', () => {
  const model = modelOf([pull(1, { reviews: [{ login: V, as: 'COLLABORATOR', hour: 3 }], comments: [{ login: 'contributor', hour: 5 }, guide(6)] })])
  expect(groupsOf(model)).toEqual({ owe: [1], nobody: [], author: [] })
})

test('only the viewer\'s own marked comments are dropped: another maintainer\'s or a bot\'s stay as they were', () => {
  const other = { login: 'naorpeled', as: 'MEMBER', hour: 3, body: '## PR Reviewer Guide 🔍' }
  const model = modelOf([pull(1, { comments: [other] }), pull(2, { comments: [{ login: 'pr-agent-bot', isBot: true, hour: 3, body: '## PR Reviewer Guide' }] })])
  expect(groupsOf(model)).toEqual({ owe: [], nobody: [2], author: [1] })
})
