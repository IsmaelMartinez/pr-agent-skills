import { expect, test } from 'claude-code/testing'

import { DETAIL_ISSUE, DETAIL_PR, detailOf, uncommented } from '../hooks/github'
import { DETAIL_NOW, ISSUE_4007, PR_3995 } from './detail-fixtures'
import { PAIR, PRA, REAL, SHOWN, SURFACES, TOOL, TYPED, clone, hhmm, mountPane, openCalls, paneProps, queueCalls, textOf, world, opened as openGroup } from './world'
import type { World } from './world'

// I2: #3995 sits under the queue's author group, which draws collapsed, so every press of its row opens the group first
// (openGroup), as Enter on the group row does.

// I2b: the detail view, one PR or issue read from GitHub inside the pane.
const MINUTE = 60_000
const PR_KEY = `detail ${PRA}#3995`
const ASOF = hhmm(DETAIL_NOW)

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

// I2d: the bodies are drawn whole, so a detail outgrows the dock's 34-row window; a pane tall enough to hold it all,
// for the tests that read past the description. The head rows of Latest, one an entry, among the rows under it.
const mountTall = ($: any, columns = 39, isFocused = true) =>
  $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: { ...paneProps(columns, isFocused), scroll: { offset: 0, bodyRows: 2_000 } } })
const heads = (rows: string[]) => rows.filter(text => /^[✓✗○●] (you|author|@)/.test(text))

const detailCalls = (seen: World) => seen.calls.filter(call => call.argv[4] === `query=${DETAIL_PR}` || call.argv[4] === `query=${DETAIL_ISSUE}`)

// The person opens the queue with /review-pair on the day the detail answers were recorded.
async function queued($: any, on: any): Promise<World> {
  const seen = world(on, { now: DETAIL_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  return seen
}

// The plugin's debug lines about bringing a row back into view (the kit has no engine to move the window).
function revealsOf(on: any): string[] {
  const lines: string[] = []
  on('ui.log', async ($$: unknown, e: { text: string; to: string }) => {
    if (e.text.includes('back into view')) lines.push(`${e.to} ${e.text}`)
    return { value: undefined }
  })
  return lines
}

const withPr = (seen: World, change: (pr: any) => void) => {
  const answer = clone(PR_3995)
  change(answer.data.repository.pullRequest)
  seen.details[`${PRA}#3995`] = answer
}

test('a queue row letter opens its PR detail in the pane, read once with the constant document, never the browser', async ($, on) => {
  const seen = await queued($, on)
  const ui = await mountTall($)
  await openGroup(ui, 'group-author')
  const row = await ui.find({ type: 'Button', key: 'pull-3995' })
  expect(row?.props).toMatchObject({ label: '#3995', plain: true })
  expect(String(row?.props.hotkey)).toMatch(/^[a-z]$/)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  expect(openCalls(seen)).toEqual([])
  const reads = detailCalls(seen)
  expect(reads.map(call => call.argv)).toEqual([['gh', 'api', 'graphql', '-f', `query=${DETAIL_PR}`, '-f', 'owner=The-PR-Agent', '-f', 'name=pr-agent', '-F', 'number=3995']])
  expect(reads[0]?.timeoutMs).toBe(8_000)
  const column = await columnOf(ui)
  // I1 colour roles: the attention line (the queue's owe pill and the first item owed) is one of the head's rows.
  expect(column.slice(0, 9)).toEqual([
    // I2c: r is always 'refresh'; the read's time is a grey caption at the byline's end.
    // I2: the neighbours in the author group share the key row, the position the hint's; a opens the board here too.
    'o: open q: back a: board r: refresh k: ‹ #3752 j: #4043 ›',
    'l: legend 2 of 6 in Waiting on the author',
    ' YOU OWE 4  next: #4042',
    '#3995 fix(gitlab): retry the first merge request lookup on 404 for new MR webhooks',
    '○ open  ✓ CI passed  +181 −1',
    `@jadhavgaurav · opened 3d · head ce5ba15 · bug, 🕐 20-40 Minutes as of ${ASOF}`,
    'Description',
    'Fixes #3994.',
    ' ',
  ])
  // I2d: each line is wrapped whole at the 39 columns, never cut: the paragraph's rows joined read the paragraph (one
  // row down from I2d's own count, under I1's attention line).
  expect(column[9]).toBe('A merge request that was opened a')
  const latest = column.indexOf('Latest')
  const paragraph = column.slice(9, column.indexOf(' ', 9))
  expect(paragraph.join(' ')).toBe('A merge request that was opened a moment ago can still answer 404 to the first API lookup. The webhook has already returned 200 by then, so GitLab does not redeliver and the MR is never reviewed.')
  for (const text of column.slice(7, latest)) expect(Array.from(text).length, text).toBeLessThanOrEqual(39)
  expect(column.slice(7, latest).join('\n')).not.toContain('…')
  expect(heads(column.slice(latest + 1))).toEqual([
    '✓ you APPROVED 2h',
    '○ @itsvrushabh comment 31h',
    '○ you COMMENT 2d',
    '○ @qodo-free-for-… bot comment 3d',
    '○ @qodo-free-for-… bot comment 3d',
  ])
  // I2d: an entry's words follow its head row, two columns in and wrapped whole.
  expect(column[latest + 1]).toBe('✓ you APPROVED 2h')
  expect(column[latest + 2]).toMatch(/^  Merged main and applied the review/)
  expect(column.slice(latest + 2, column.indexOf('○ @itsvrushabh comment 31h')).join(' ').replace(/ {3}/g, ' ')).toMatch(/^  Merged main and applied the review suggestions, thanks\./)
  // Each path is cut from its start to what the 39 columns leave beside its counts.
  const path = 'pr_agent/servers/gitlab_webhook.py'
  const files = column.indexOf('Files (2)')
  expect(column.slice(files, files + 2)).toEqual(['Files (2)', `…${path.slice(path.length - (39 - '+26 −1'.length - 2))} +26 −1`])
  const testPath = 'tests/unittest/test_gitlab_webhook_new_mr_retry.py'
  expect(column[files + 2]).toBe(`…${testPath.slice(testPath.length - (39 - '+155 −0'.length - 2))} +155 −0`)
  expect(column).toHaveLength(files + 3)
  // The two reviews with no words (a bot's thread shells) are not words in the list.
  expect(column.join('\n')).not.toMatch(/github-advanced/)
})

test('an issues row letter opens its issue detail: no CI, no files, i goes back', async ($, on) => {
  const reveals = revealsOf(on)
  const seen = await queued($, on)
  const ui = await mountPane($, 'desktop', 104, false)
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  expect(detailCalls(seen).map(call => call.argv[4])).toEqual([`query=${DETAIL_ISSUE}`])
  const column = await columnOf(ui)
  // Wide: one header row with the hint, the title and the facts on one row.
  // I2: the neighbours (none: #4007 is the one community issue) and the position join the wide header row.
  // I2: the walk keys stay bound at both ends, as inert Buttons (prove fix).
  expect(column[0]).toBe('o: open i: back a: board r: refresh k: ‹ — j: — › 1 of 1 in Open for the community ctrl+x tab: keys')
  // I1 colour roles: the attention line is the head's second row.
  expect(column[1]).toBe(' YOU OWE 4  next: #4042')
  expect(column[2]).toBe('#4007 Shared cacheable prompt prefix across /review, /describe and /improve ○ open')
  expect(column[3]).toBe(`@IsmaelMartinez · opened 3d · enhancement, help wanted, performance as of ${ASOF}`)
  expect(column[4]).toBe('Description')
  expect(column.join('\n')).not.toMatch(/CI|Files/)
  expect(await ui.find({ type: 'Button', key: 'detail-back' })).toMatchObject({ props: { hotkey: 'i', label: 'back' } })
  await ui.press({ key: 'detail-back' })
  expect(await columnOf(ui)).toContain(`Open issues (12) as of ${ASOF}`)
  await seen.clock.settle()
  await seen.clock.advance(100)
  expect(reveals.map(text => text.split(' ')[2])).toEqual(['issues-4007'])
})

test('the issue detail lists the newest five words newest first, the viewer as you, and the whole description', async ($, on) => {
  const seen = await queued($, on)
  // I2d: the tall pane, since the whole body is drawn.
  const ui = await mountTall($)
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  expect(heads(column.slice(latest + 1))).toEqual([
    '○ @utsab345 comment 1h',
    '○ you comment 1h',
    '○ @utsab345 comment 2h',
    '○ you comment 2d',
    '○ @utsab345 comment 3d',
  ])
  // I2d: every line of the body is drawn (the fixture has well over the 8 the detail used to keep) and none is left.
  const description = column.slice(column.indexOf('Description') + 1, latest)
  expect(description.filter(text => text.trim() !== '').length).toBeGreaterThan(8)
  expect(description.join('\n')).not.toMatch(/\([0-9]+ more lines?\)/)
  expect(seen.toasts).toEqual([])
})

test('back puts the view and the legend back and asks for the opened row by its key; o opens only the allow-listed URL; r reads again', async ($, on) => {
  const reveals = revealsOf(on)
  const seen = await queued($, on)
  const props = { ...paneProps(104, true), scroll: { offset: 6, bodyRows: 11 } }
  const ui = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props })
  await ui.press({ key: 'legend' })
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  expect(await ui.find({ type: 'Text', text: 'plain words' })).toBeDefined()
  await ui.press({ key: 'detail-open' })
  expect(openCalls(seen)).toEqual([['/usr/bin/open', 'https://github.com/The-PR-Agent/pr-agent/pull/3995']])
  await ui.press({ key: 'detail-refresh' })
  expect(detailCalls(seen)).toHaveLength(2)
  await ui.press({ key: 'detail-back' })
  await seen.clock.settle()
  const column = await columnOf(ui)
  expect(column[0]).toMatch(/^i: issues r: refresh /)
  expect(await ui.find({ type: 'Text', text: 'plain words' })).toBeDefined()
  // The engine's $.ui.scroll brings the row that opened the detail back into view by its key. The kit has no engine
  // to move the window, so every try is refused here: one at once, one more 100 ms later, then one debug line.
  await seen.clock.settle()
  expect(reveals).toEqual([])
  await seen.clock.advance(100)
  expect(reveals).toHaveLength(1)
  expect(reveals[0]).toMatch(/^debug review-pair: pull-3995 did not come back into view \(/)
  // Only the first drawing after back asks.
  await columnOf(ui)
  await seen.clock.advance(1_000)
  expect(reveals).toHaveLength(1)
  // Nothing was posted, merged, approved or commented: only gh reads and the one open ran.
  expect(seen.calls.every(call => call.argv[0] === '/usr/bin/open' || (call.argv[1] === 'api' && call.argv[2] === 'graphql' && !call.argv.join(' ').includes('mutation')))).toBe(true)
  expect(seen.toolRuns).toEqual([])
  expect(seen.outward).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('the pair view opens the shown item with 0, and p goes back to the same tab', async ($, on) => {
  const reveals = revealsOf(on)
  const seen = world(on, { now: DETAIL_NOW })
  seen.panes = [SHOWN]
  const answer = clone(PR_3995)
  answer.data.repository.pullRequest.number = 2450
  seen.details[`${PRA}#2450`] = answer
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 39, true)
    await ui.press({ key: 'tab-1' })
    expect((await ui.find({ type: 'Button', key: 'detail' }))?.props).toMatchObject({ hotkey: '0', label: 'detail', plain: true })
    await ui.press({ key: 'detail' })
    // I2: from the pair, k walks to the first tab's item and j has nowhere to go.
    // I2: j stays bound at the end, as an inert Button (prove fix).
    expect((await columnOf(ui))[0]).toBe('o: open p: back a: board r: refresh k: ‹ #4045 j: — ›')
    expect((await columnOf(ui))[4]).toMatch(new RegExp(`as of ${hhmm(DETAIL_NOW)}$`))
    expect((await columnOf(ui))[2]).toMatch(/^#2450 /)
    await ui.press({ key: 'detail-back' })
    expect(await ui.find({ type: 'Text', text: 'Thanks, one ask below.' })).toBeDefined()
    await seen.clock.settle()
    await seen.clock.advance(100)
    await ui.unmount()
  }
  expect(reveals.map(text => text.split(' ')[2])).toEqual(['detail', 'detail'])
  // Every key of the detail view is its own, and none is one of the views' or a row's.
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'detail' })
  const keys = (await ui.findAll({ type: 'Button' })).map((button: any) => button.props.hotkey)
  // I2: k walks to the pair's first item; j has nowhere to go from the last tab.
  // I2: j is bound at the end too, as an inert Button (prove fix).
  // a opens the board from the detail too.
  expect(keys.sort()).toEqual(['a', 'j', 'k', 'l', 'o', 'p', 'r'])
})

test('the 60 s poll reads the shown detail only while the pane is placed and shown', async ($, on) => {
  const seen = await queued($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const queues = queueCalls(seen).length
  expect(detailCalls(seen)).toHaveLength(1)
  await seen.clock.advance(MINUTE)
  expect(detailCalls(seen)).toHaveLength(2)
  expect(queueCalls(seen)).toHaveLength(queues)
  seen.panes = [{ ...SHOWN, isPlaced: false }]
  await seen.clock.advance(5 * MINUTE)
  expect(detailCalls(seen)).toHaveLength(2)
  await ui.unmount()
})

test('a failed read says unknown and keeps the last good read with its time; a first failed read shows no data', async ($, on) => {
  const seen = await queued($, on)
  // I2d: the tall pane, so the files sit in the window under the whole body.
  const ui = await mountTall($)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  seen.modes[PR_KEY] = { kind: 'exit', stderr: REAL.gateway }
  await seen.clock.advance(MINUTE)
  const column = await columnOf(ui)
  // I1 colour roles: a failed read adds the NOT READ pill to the attention line, which keeps its row.
  expect(column[2]).toBe(' YOU OWE 4   NOT READ  next: #4042')
  expect(column[3]).toMatch(/^#3995 fix\(gitlab\)/)
  expect(column[6]).toBe(`▲ detail unknown: GitHub error, as of ${ASOF}`)
  expect(column).toContain('Files (2)')
  await ui.press({ key: 'detail-back' })
  seen.modes[PR_KEY] = { kind: 'slow', ms: 20_000 }
  await openGroup(ui, 'group-author')
  const pressed = ui.press({ key: 'pull-3995' })
  await seen.clock.advance(8_000)
  await pressed
  expect((await columnOf(ui)).slice(3, 7)).toEqual(['#3995 title unknown', 'state unknown', 'author unknown', '▲ detail unknown: GitHub timed out'])
  expect(seen.toasts).toEqual([])
})

test('a partial answer says which part is unknown and keeps that part of the last good read with its time', async ($, on) => {
  const seen = await queued($, on)
  // I2d: the tall pane, so the files sit in the window under the whole body.
  const ui = await mountTall($)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const partial = clone(PR_3995)
  partial.data.repository.pullRequest.files = null
  partial.errors = [{ type: 'SERVICE_UNAVAILABLE', path: ['repository', 'pullRequest', 'files'], message: 'files timed out' }]
  // gh exits 1 on an answer with errors and prints it whole (recorded on #4007 asked as a pull request).
  seen.modes[PR_KEY] = { kind: 'exit', exitCode: 1, stderr: 'gh: files timed out', stdout: JSON.stringify(partial) }
  await seen.clock.advance(MINUTE)
  let column = await columnOf(ui)
  expect(column).toContain(`▲ files unknown, as of ${ASOF}`)
  expect(column.some(text => /gitlab_webhook\.py \+26 −1$/.test(text))).toBe(true)
  expect(column).toContain('Latest')
  // I1 colour roles: the attention line is one of the head's rows.
  expect(column[5]).toMatch(new RegExp(`as of ${hhmm(DETAIL_NOW + MINUTE)}$`))
  // Opened afresh, nothing earlier is kept: the part is unknown and has no rows; comments null too.
  await ui.press({ key: 'detail-back' })
  partial.data.repository.pullRequest.comments = null
  seen.modes[PR_KEY] = { kind: 'exit', exitCode: 1, stderr: '', stdout: JSON.stringify(partial) }
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  column = await columnOf(ui)
  expect(column).toContain('▲ files unknown')
  expect(column).toContain('▲ latest unknown')
  expect(column.join('\n')).not.toMatch(/gitlab_webhook\.py/)
  expect(column).toContain('Description')
})

test('a hostile body and comments draw as wrapped, marked text and reach no toast, status line, tool result, shell or URL', async ($, on) => {
  const seen = await queued($, on)
  const secret = 'SECRET-IN-COMMENT'
  const body = [
    'top \u{202E}evil\u{202C} and zero\u{200B}width',
    '\u001b[31mred\u001b[0m',
    `<!-- ${secret} -->visible after`,
    'x'.repeat(10_000),
    '',
    '',
    '',
    'y'.repeat(100_000),
    `<!-- never closed ${secret}`,
    'hidden by the open comment',
  ].join('\n')
  withPr(seen, pr => {
    pr.body = body
    pr.title = 'title \u{202E}hidden'
    pr.comments.nodes.push({ author: { login: 'jadhavgaurav', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: `\u{200B}<!-- ${secret} -->\n\u001b]8;;https://evil\u0007link\u001b]8;;\u0007 ${'z'.repeat(10_000)}` })
  })
  for (const columns of [39, 104]) {
    // I2d: the tall pane, so the comment sits in the window under the whole body.
    const ui = await mountTall($, columns)
    await openGroup(ui, 'group-author')
    await ui.press({ key: 'pull-3995' })
    const drawn = JSON.stringify(await ui.drawn())
    const column = await columnOf(ui)
    expect(column.join('\n')).not.toMatch(/[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u)
    expect(drawn).not.toContain('hidden by the open comment')
    expect(drawn).not.toContain(secret)
    expect(drawn).toContain('{U+202E}')
    expect(drawn).toContain('{U+200B}')
    // I2d: the storage cap (40,000 code points) bounds the tree; the 100,000 y's are cut to what the x's left.
    expect(drawn.length).toBeLessThan(400_000)
    expect(column).toContain('[31mred[0m')
    expect(column).toContain('visible after')
    // I2d: a long word is cut hard into whole rows, never with an ellipsis; the rows joined are the word kept.
    expect(column.find(text => text.startsWith('xxx'))).toBe('x'.repeat(columns))
    expect(column.filter(text => text.startsWith('xxx')).join('')).toBe('x'.repeat(10_000))
    expect(column.find(text => text.startsWith('yyy'))).toBe('y'.repeat(columns))
    const ys = column.filter(text => text.startsWith('yyy')).join('')
    expect(ys.length).toBeLessThan(40_000 - 10_000)
    expect(ys.length).toBeGreaterThan(29_000)
    // The author's own word reads 'author'; its words follow its head row, the hidden run as a token, then the link.
    const head = column.findIndex(text => text.includes(' author comment '))
    expect(column[head]).toMatch(/^○ author comment [0-9]+m$/)
    expect(column[head + 1]).toBe('  {U+200B}')
    expect(column[head + 2]).toMatch(/^  \]8;;https:\/\/evillink\]8;;/)
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: PRA, items: [{ number: 3995, action: 'approve' }] })
  const said = [...seen.toasts, ...seen.status.map(String), JSON.stringify(seen.calls.map(call => call.argv.slice(5)))]
  for (const text of said) expect(text).not.toMatch(/evil|SECRET|xxxx|yyyy|hidden|zzzz/)
})

test('no description, a template left as a comment, a bot author, and long file paths cut from the left', async ($, on) => {
  const seen = await queued($, on)
  const deep = `pr_agent/${'nested/'.repeat(12)}gitlab_provider.py`
  withPr(seen, pr => {
    pr.body = ''
    pr.author = { login: 'dependabot', __typename: 'Bot' }
    pr.files = { totalCount: 12, nodes: Array.from({ length: 8 }, (_, i) => ({ path: i === 0 ? deep : `docs/${i}.md`, additions: i, deletions: 2 * i })) }
  })
  // I2d: the tall pane, so the files sit in the window under the whole comments.
  const ui = await mountTall($)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  let column = await columnOf(ui)
  // I1 colour roles: the attention line is one of the head's rows.
  expect(column[5]).toMatch(/^@dependabot bot · opened 3d · /)
  expect(column).toContain('(no description)')
  const files = column.slice(column.indexOf('Files (12)') + 1)
  expect(files[0]).toMatch(/^….*\/gitlab_provider\.py \+0 −0$/)
  expect(Array.from((files[0] ?? '').replace(/ \+0 −0$/, ''))).toHaveLength(39 - '+0 −0'.length - 1)
  expect(files.slice(1, 8)).toEqual(Array.from({ length: 7 }, (_, i) => `docs/${i + 1}.md +${i + 1} −${2 * (i + 1)}`))
  expect(files[8]).toBe('(+4 more)')
  await ui.press({ key: 'detail-back' })
  withPr(seen, pr => {
    pr.body = '<!-- Describe your change -->\n\n\n<!-- Link the issue -->\n'
  })
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  column = await columnOf(ui)
  expect(column).toContain('(no description)')
})

test('in the 10-row strip the body scrolls under the fixed head rows, clamped at both ends', async ($, on) => {
  const seen = await queued($, on)
  const ui = await mountPane($, 'terminal', 104, true)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  // I1 colour roles: the attention line is the head's second row, so the head is four rows and the window one fewer.
  const head = (await columnOf(ui)).slice(0, 4)
  // I2: #3995 is the second of the six author rows; its neighbours and position sit in the wide header row.
  expect(head[0]).toBe('o: open q: back a: board r: refresh k: ‹ #3752 j: #4043 › 2 of 6 in Waiting on the author l: legend')
  expect(head[1]).toBe(' YOU OWE 4  next: #4042')
  expect(await columnOf(ui)).toHaveLength(11)
  expect((await columnOf(ui))[4]).toBe('Description')
  const scroll = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset: 0, by, bodyRows: 11, contentRows: 11, origin: { kind: 'person' } } as any)
  await scroll(1)
  let column = await columnOf(ui)
  expect(column.slice(0, 4)).toEqual(head)
  expect(column[4]).toBe('Fixes #3994.')
  await scroll(1_000)
  column = await columnOf(ui)
  expect(column.slice(0, 4)).toEqual(head)
  expect(column).toHaveLength(11)
  expect(column.at(-1)).toMatch(/test_gitlab_webhook_new_mr_retry\.py \+155 −0$/)
  await scroll(-1_000)
  expect((await columnOf(ui))[4]).toBe('Description')
  // The legend open (eight rows here since I1 named the pill roles, one entry of the column), the head keeps it and
  // the window shrinks to the one row the head leaves.
  await ui.press({ key: 'legend' })
  column = await columnOf(ui)
  expect(column.slice(0, 2)).toEqual(head.slice(0, 2))
  // Review F9: the legend's first line is the act-now pill's, the glyph lines following.
  expect(column[2]).toMatch(/^ CI FAILED  act now/)
  expect(column.slice(3, 5)).toEqual(head.slice(2, 4))
  expect(column.slice(5)).toEqual(['Description'])
  expect(column).toHaveLength(6)
  expect(seen.toasts).toEqual([])
})

test('a page key moves the detail by the rows under its head, so no row is skipped', async ($, on) => {
  await queued($, on)
  const ui = await mountPane($, 'terminal', 104, true)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  // I1 colour roles: the head is four rows with the attention line.
  const first = (await columnOf(ui)).slice(4)
  const page = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset: 0, by, bodyRows: 11, contentRows: 11, origin: { kind: 'person' } } as any)
  await page(11)
  const second = (await columnOf(ui)).slice(4)
  expect(first).toHaveLength(7)
  // The next page starts on the row after the last one shown.
  await page(-11)
  expect((await columnOf(ui)).slice(4)).toEqual(first)
  await page(1)
  expect((await columnOf(ui)).slice(4).at(-1)).toBe(second[0])
})

test('Latest keeps the newest real words when empty review-thread shells crowd the reviews window', async ($, on) => {
  const seen = await queued($, on)
  // GitHub answers the last N reviews of the list, oldest first: N as the shipped document asks for it.
  const window = Number(/reviews\(last: ([0-9]+)/.exec(DETAIL_PR)?.[1])
  const shell = (hour: number) => ({ author: { login: 'PeterDaveHello', __typename: 'User' }, state: 'COMMENTED', submittedAt: `2026-10-11T1${hour}:00:00Z`, body: '' })
  const all = [
    { author: { login: 'reviewer-one', __typename: 'User' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-10-09T08:29:29Z', body: 'Please rename the helper.' },
    ...[0, 1, 2, 3, 4].map(shell),
  ]
  withPr(seen, pr => {
    pr.comments = { totalCount: 0, nodes: [] }
    pr.reviews = { totalCount: all.length, nodes: all.slice(-window) }
  })
  const ui = await mountPane($, 'terminal', 104, false)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const scroll = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset: 0, by, bodyRows: 11, contentRows: 11, origin: { kind: 'person' } } as any)
  await scroll(1_000)
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  // I2d: the words on the row under the head, two columns in.
  expect(column[latest + 1]).toMatch(/ @reviewer-one CHANGES_REQUESTED 2d$/)
  expect(column[latest + 2]).toBe('  Please rename the helper.')
  expect(column.join('\n')).not.toMatch(/no comments or reviews|PeterDaveHello/)
})

test('a stranger whose login is the word you or author never reads as the viewer or the author', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.comments.nodes.push({ author: { login: 'you', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: 'a comment by @you' })
    pr.comments.nodes.push({ author: { login: 'author', __typename: 'User' }, createdAt: '2026-10-11T17:49:00Z', body: 'a comment by @author' })
    pr.reviews.nodes.push({ author: { login: 'you', __typename: 'User' }, state: 'APPROVED', submittedAt: '2026-10-11T17:52:00Z', body: 'approved by @you, not the viewer' })
  })
  // I2d: the tall pane, so Latest sits in the window under the whole body.
  const ui = await mountTall($)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  expect(heads(column.slice(latest + 1)).slice(0, 4)).toEqual([
    '✓ @you APPROVED 3m',
    '○ @you comment 5m',
    '○ @author comment 6m',
    '✓ you APPROVED 2h',
  ])
})

test('HTML comments are dropped as GitHub renders them: before control characters go, empty ones kept apart, inline unclosed ones as text', () => {
  expect(uncommented('<!--> shown on GitHub')).toBe(' shown on GitHub')
  expect(uncommented('<!---> shown on GitHub too')).toBe(' shown on GitHub too')
  expect(uncommented('Intro text <!-- unclosed inline\n\nnext paragraph shows')).toBe('Intro text <!-- unclosed inline\n\nnext paragraph shows')
  expect(uncommented('kept\n<!-- a template never closed\nhidden')).toBe('kept\n')
  expect(uncommented('a <!-- x --> b <!--\ny\n--> c')).toBe('a  b  c')
  const pr = clone(PR_3995)
  pr.data.repository.pullRequest.body = 'shown <!-\u{1B}- hidden in pane --> after esc'
  // A comment whose body is not a string reads as no words, not as a failed read.
  pr.data.repository.pullRequest.comments.nodes.push({ author: { login: 'jadhavgaurav', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: null })
  const read = detailOf(pr, 'pr', 3995, DETAIL_NOW) as any
  expect(read.description.value.lines).toEqual(['shown <!-- hidden in pane --> after esc'])
  // I2d: an entry carries its body whole, as lines.
  expect(read.latest.value[0]).toMatchObject({ who: 'author', kind: 'comment', body: { lines: [], more: 0 } })
})

// The words of a drawn node as the terminal paints them, parts side by side; a plain Button reads 'o: open'.
function painted(node: any): string {
  if (typeof node === 'string') return node
  if (node?.type === 'Button') return node.props?.hotkey === undefined ? String(node.props.label) : `${String(node.props.hotkey)}: ${String(node.props.label)}`
  return (node?.children ?? []).map(painted).join('')
}

// How many rows a wrapping row takes at `columns`, its children laid out in order `gap` columns apart.
function wrappedRows(box: any, columns: number, gap: number): number {
  let [rows, used] = [1, -gap]
  for (const child of box.children ?? []) {
    const width = Array.from(painted(child)).length
    if (used + gap + width > columns) [rows, used] = [rows + 1, width]
    else used += gap + width
  }
  return rows
}

test('the pair header is the tabs row then a batch row in the 39-column dock, with more left in the batch; 0 opens from the title row', async ($, on) => {
  const seen = world(on, { now: DETAIL_NOW })
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  const ui = await mountPane($, 'terminal', 39, false)
  for (const tab of ['tab-0', 'tab-1']) {
    await ui.press({ key: tab })
    const root = (await ui.drawn()) as any
    // The dock is tall: the tabs row is navigation only, and the count of the batch heads the batch row under it.
    expect(root.children[0].props.key).toBe('tabs')
    expect(painted(root.children[0])).not.toContain('under review')
    expect(root.children[1].props.key).toBe('batch')
    expect(painted(root.children[1])).toContain('5 under review')
    // I2c: the read's time left the r label for a caption of its own.
    expect(painted(root.children[0])).toContain(`i: issuesas of ${hhmm(DETAIL_NOW)}`)
    expect(wrappedRows(root.children[0], 39, 2)).toBe(4)
    expect(painted(root.children[0])).not.toContain('0: detail')
    const title = root.children.find((child: any) => child.props?.key === 'title')
    // I1 colour roles: the shown item's pill leads the title row: none on tab 1 (an open thread is amber, no pill),
    // HEAD MOVED on tab 2.
    expect(title.children.map(painted)).toEqual([...(tab === 'tab-0' ? [] : [' HEAD MOVED ']), '0: detail', expect.stringMatching(/^[a-z]+\(/)])
  }
})

test('one detail read per item at a time: r and the poll while it runs share it', async ($, on) => {
  const seen = await queued($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  await seen.clock.advance(55_000)
  seen.modes[PR_KEY] = { kind: 'slow', ms: 7_000 }
  await openGroup(ui, 'group-author')
  const opened = ui.press({ key: 'pull-3995' })
  await seen.clock.advance(1_000)
  const pressed = ui.press({ key: 'detail-refresh' })
  // The poll's 60 s tick falls inside the read.
  await seen.clock.advance(6_000)
  await opened
  await pressed
  expect(detailCalls(seen)).toHaveLength(1)
  delete seen.modes[PR_KEY]
  await ui.press({ key: 'detail-refresh' })
  expect(detailCalls(seen)).toHaveLength(2)
})

test('a late read of one item never draws under another item\'s head', async ($, on) => {
  const seen = await queued($, on)
  const ui = await mountPane($, 'terminal', 39, true)
  seen.modes[PR_KEY] = { kind: 'slow', ms: 6_000 }
  await openGroup(ui, 'group-author')
  const opened = ui.press({ key: 'pull-3995' })
  await seen.clock.advance(1_000)
  await ui.press({ key: 'detail-back' })
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  await seen.clock.advance(8_000)
  await opened
  const column = await columnOf(ui)
  // I1 colour roles: the attention line is one of the head's rows.
  expect(column[3]).toMatch(/^#4007 Shared cacheable prompt prefix/)
  expect(column.join('\n')).not.toMatch(/gitlab/)
})

test('Latest draws exactly five entries when more were read', async ($, on) => {
  const seen = await queued($, on)
  const answer = clone(ISSUE_4007)
  answer.data.repository.issue.comments.nodes.push({ author: { login: 'newcomer', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: 'sixth' })
  seen.details[`${PRA}#4007`] = answer
  // I2d: the tall pane; five head rows, each with its words under it.
  const ui = await mountTall($)
  await ui.press({ key: 'issues' })
  await ui.press({ key: 'issues-4007' })
  const column = await columnOf(ui)
  const rows = column.slice(column.indexOf('Latest') + 1)
  expect(heads(rows)).toHaveLength(5)
  expect(rows.slice(0, 2)).toEqual(['○ @newcomer comment 5m', '  sixth'])
})

test('the pair\'s 0 on an issue item reads the issue document', async ($, on) => {
  const seen = world(on, { now: DETAIL_NOW })
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: PRA, items: [{ number: 4045, action: 'approve' }, { number: 4007, kind: 'issue', action: 'reply' }] })
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'tab-1' })
  await ui.press({ key: 'detail' })
  expect(detailCalls(seen).map(call => [call.argv[4], call.argv[10]])).toEqual([[`query=${DETAIL_ISSUE}`, 'number=4007']])
  // No queue read here, so no attention line: the title is the head's second row.
  expect((await columnOf(ui))[2]).toMatch(/^#4007 Shared cacheable prompt prefix/)
})

test('the detail documents ask for the newest words and only as many files and labels as are drawn', () => {
  for (const field of ['files(first: 8) {', 'comments(last: 5) {', 'labels(first: 5) {', 'viewer { login }']) expect(DETAIL_PR).toContain(field)
  for (const field of ['comments(last: 5) {', 'labels(first: 5) {', 'viewer { login }']) expect(DETAIL_ISSUE).toContain(field)
})
