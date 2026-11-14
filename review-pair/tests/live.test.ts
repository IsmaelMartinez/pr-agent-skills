import { expect, test } from 'claude-code/testing'

import { WRITE_TOOLS, writesOf } from '../hooks/github'
import { PAIR, PRA, QUEUE_NOW, SHOWN, TFL, TFL_PAIR, TOOL, TURN, TYPED, clone, ghCalls, mountPane, queueCalls, world } from './world'
import type { World } from './world'

// I1c: live refresh after Claude's own writes (2a), the 60 s poll while the pane is placed (2b) and change
// toasts in fixed words (2c).
const MINUTE = 60_000
const MERGE = `gh pr merge 4045 --squash --delete-branch --repo ${PRA}`
const TOAST = /^review-pair: #[1-9][0-9]* (merged|closed|reopened|head moved|CI failing|CI passing|approved|changes requested|has conflicts)$/

// The next answer GitHub gives for one card, edited from the recorded one.
function edit(seen: World, key: string, change: (pr: any) => void) {
  const answer = clone(seen.answers[key])
  change(answer.data.repository.pullRequest ?? answer.data.repository.issue)
  seen.answers[key] = answer
}

async function shown($: any, on: any, pair: object = PAIR): Promise<World> {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-1', ...pair })
  return seen
}

const bash = ($: any, command: string, extra: object = {}) => $.tool.call({ tool: 'Bash', tool_use_id: `b-${command.length}`, command, ...extra })

test('a Bash gh merge of a shown number reads that card once and toasts merged; the call itself is untouched', async ($, on) => {
  const seen = await shown($, on)
  expect(seen.toasts).toEqual([])
  const before = ghCalls(seen).length
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  const answer = await bash($, MERGE)
  expect(answer).toEqual({ result: { stdout: '', stderr: '', interrupted: false }, text: 'done' })
  await seen.clock.settle()
  expect(ghCalls(seen).slice(before)).toEqual([`${PRA}#4045`])
  expect(seen.toasts).toEqual(['review-pair: #4045 merged'])
  expect(seen.toolRuns).toEqual([`Bash ${MERGE}`])
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'merged' })).toBeDefined()
})

test('the read waits for the call: a slow card read never holds the Bash result, which returns first', async ($, on) => {
  const seen = await shown($, on)
  seen.modes[`${PRA}#4045`] = { kind: 'slow', ms: 3_000 }
  let isAnswered = false
  const pending = bash($, MERGE).then((answer: unknown) => {
    isAnswered = true
    return answer
  })
  await seen.clock.settle()
  expect(isAnswered).toBe(true)
  expect(ghCalls(seen).at(-1)).toBe(`${PRA}#4045`)
  await pending
  // I2d REV-4: the slow read lands before the test returns. Left asleep on the mock clock at teardown, it woke into
  // the unloaded module and its $.clock.now refusal was a rejection nothing handled, seen under load as a failure of
  // the whole file after every test had passed.
  await seen.clock.advance(3_000)
})

test('a gh command on a number not shown, another repo, a read-only gh, a non-gh Bash call and a subagent read nothing', async ($, on) => {
  const seen = await shown($, on)
  const before = ghCalls(seen).length
  const quiet = [
    `gh pr merge 4046 --squash --repo ${PRA}`,
    `gh pr merge 4045 --squash --repo ${TFL}`,
    'gh pr merge 4045 --squash',
    `gh pr view 4045 --repo ${PRA}`,
    `gh pr checks 4045 -R ${PRA}`,
    `gh api repos/${PRA}/pulls/4045`,
    `gh api repos/${PRA}/pulls/4045 --method GET`,
    `gh api repos/${PRA}/pulls/comments/4045 -X PATCH -f body=x`,
    `gh issue list -R ${PRA}`,
    'ls -la && git status',
    `echo gh pr merge 4045 --repo ${PRA}`,
  ]
  for (const command of quiet) await bash($, command)
  await bash($, MERGE, { agentId: 'agent-1' })
  await seen.clock.settle()
  expect(ghCalls(seen).length).toBe(before)
  expect(seen.toasts).toEqual([])
  expect(seen.toolRuns).toHaveLength(quiet.length + 1)
})

test('a denied call ran nothing and reads nothing', async ($, on) => {
  const seen = await shown($, on)
  const before = ghCalls(seen).length
  seen.denyTools = true
  const answer = await bash($, MERGE)
  expect(answer.deny).toBe('denied by a PreToolUse hook')
  await seen.clock.settle()
  expect(ghCalls(seen).length).toBe(before)
})

test('a write while the pane is hidden, or with no pair shown, reads nothing', async ($, on) => {
  const seen = await shown($, on)
  seen.panes = [{ ...SHOWN, isShown: false }]
  const before = ghCalls(seen).length
  await bash($, MERGE)
  await seen.clock.settle()
  expect(ghCalls(seen).length).toBe(before)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'clear', repo: PRA, items: [] })
  await seen.clock.settle()
  await bash($, MERGE)
  await seen.clock.settle()
  expect(ghCalls(seen).length).toBe(before)
})

test('each gh write form names its target: review, close, comment, issue close and comment, api POST, PUT, PATCH', async ($, on) => {
  const seen = await shown($, on, { repo: PRA, items: [PAIR.items[0], PAIR.items[1], { number: 882, kind: 'issue', action: 'close' }] })
  const writes: [string, string][] = [
    [`gh pr review 2450 --approve --body "Thanks, #4045 next" --repo ${PRA}`, `${PRA}#2450`],
    [`gh pr close 4045 -R ${PRA} --comment "superseded by #2450"`, `${PRA}#4045`],
    [`gh pr comment --body-file - -R ${PRA} 2450`, `${PRA}#2450`],
    [`gh issue close 882 --reason "not planned" -R ${PRA}`, `${PRA}#882`],
    [`gh issue comment https://github.com/${PRA}/issues/882 --body hi`, `${PRA}#882`],
    [`gh api repos/${PRA}/issues/2450/comments -f body='a reply'`, `${PRA}#2450`],
    [`gh api -X PUT /repos/${PRA}/pulls/4045/merge -f merge_method=squash`, `${PRA}#4045`],
    [`gh api --method PATCH repos/${PRA}/issues/882 -f state=closed`, `${PRA}#882`],
    [`gh api --method=POST repos/${PRA}/pulls/2450/reviews --input review.json`, `${PRA}#2450`],
    [`GH_REPO=${PRA} gh pr merge 4045 --squash`, `${PRA}#4045`],
    [`cd /tmp && gh pr merge https://github.com/${PRA}/pull/4045 --squash; echo done`, `${PRA}#4045`],
  ]
  for (const [command, key] of writes) {
    const before = ghCalls(seen).length
    await bash($, command)
    await seen.clock.settle()
    expect(ghCalls(seen).slice(before), command).toEqual([key])
  }
})

test('a review then a merge in one command, and two writes during a slow read, coalesce into one more read', async ($, on) => {
  const seen = await shown($, on)
  let before = ghCalls(seen).length
  await bash($, `gh pr review 4045 --approve -R ${PRA} && gh pr merge 4045 --squash -R ${PRA}`)
  await seen.clock.settle()
  expect(ghCalls(seen).slice(before)).toEqual([`${PRA}#4045`])
  // A read already running when the write lands may have started before it: one more read follows it, once.
  seen.modes[`${PRA}#4045`] = { kind: 'slow', ms: 3_000 }
  const ui = await mountPane($, 'terminal')
  before = ghCalls(seen).length
  void ui.press({ key: 'refresh' })
  await seen.clock.settle()
  await seen.clock.advance(1_000)
  await bash($, MERGE)
  await bash($, `gh pr comment 4045 -R ${PRA} -b thanks`)
  await seen.clock.settle()
  expect(ghCalls(seen).slice(before).filter(key => key === `${PRA}#4045`)).toHaveLength(1)
  await seen.clock.advance(2_000)
  await seen.clock.settle()
  expect(ghCalls(seen).slice(before).filter(key => key === `${PRA}#4045`)).toHaveLength(2)
  await seen.clock.advance(3_000)
  expect(ghCalls(seen).slice(before).filter(key => key === `${PRA}#4045`)).toHaveLength(2)
})

test('the GitHub MCP write tools re-read the shown item they name; read tools and other numbers do not', async ($, on) => {
  const seen = await shown($, on, { repo: PRA, items: [PAIR.items[0], { number: 3887, kind: 'issue', action: 'close' }] })
  const [owner, repo] = PRA.split('/')
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  edit(seen, `${PRA}#3887`, issue => void (issue.state = 'CLOSED'))
  const calls: [string, object, string[]][] = [
    ['mcp__plugin_github_github__merge_pull_request', { owner, repo, pullNumber: 4045, merge_method: 'squash' }, [`${PRA}#4045`]],
    ['mcp__plugin_github_github__issue_write', { method: 'update', owner, repo, issue_number: 3887, state: 'closed' }, [`${PRA}#3887`]],
    ['mcp__plugin_github_github__add_issue_comment', { owner, repo, issue_number: 4046, body: 'x' }, []],
    ['mcp__plugin_github_github__update_pull_request', { owner: 'IsmaelMartinez', repo: 'teams-for-linux', pullNumber: 4045 }, []],
    ['mcp__plugin_github_github__pull_request_review_write', { method: 'create', event: 'APPROVE', owner, repo, pullNumber: 4045 }, [`${PRA}#4045`]],
  ]
  for (const [tool, input, reads] of calls) {
    const before = ghCalls(seen).length
    await $.tool.call({ tool, tool_use_id: `m-${tool}`, ...input } as any)
    await seen.clock.settle()
    expect(ghCalls(seen).slice(before), tool).toEqual(reads)
  }
  expect(seen.toasts).toEqual(['review-pair: #4045 merged', 'review-pair: #3887 closed'])
  expect(WRITE_TOOLS.every(tool => tool.startsWith('mcp__plugin_github_github__'))).toBe(true)
  expect(WRITE_TOOLS).not.toContain('mcp__plugin_github_github__pull_request_read')
})

test('every tool on the allow-list reaches the write hook and re-reads the item its number field names', async ($, on) => {
  const seen = await shown($, on, { repo: PRA, items: [PAIR.items[0], { number: 3887, kind: 'issue', action: 'reply' }] })
  const [owner, repo] = PRA.split('/')
  expect(WRITE_TOOLS).toHaveLength(7)
  for (const tool of WRITE_TOOLS) {
    const isIssue = tool.endsWith('issue_comment') || tool.endsWith('issue_write')
    const input = isIssue ? { owner, repo, issue_number: 3887, method: 'update' } : { owner, repo, pullNumber: 4045, method: 'create' }
    const before = ghCalls(seen).length
    await $.tool.call({ tool, tool_use_id: `all-${tool}`, ...input } as any)
    await seen.clock.settle()
    expect(ghCalls(seen).slice(before), tool).toEqual([isIssue ? `${PRA}#3887` : `${PRA}#4045`])
  }
})

test('the command parser: shell separators, quotes, flags with values, env and URLs, in linear time', () => {
  expect(writesOf(`gh pr merge 4045 --repo ${PRA}`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf('gh pr merge 4045')).toEqual([{ number: 4045 }])
  expect(writesOf(`gh pr review --body "LGTM 12" -R ${PRA} 2450 --approve`)).toEqual([{ repo: PRA, number: 2450 }])
  expect(writesOf(`gh pr comment --repo=${PRA} -b 77 2450`)).toEqual([{ repo: PRA, number: 2450 }])
  expect(writesOf(`gh pr comment 1 -R ${PRA} --body "x; gh pr merge 2 -R ${PRA}"`)).toEqual([{ repo: PRA, number: 1 }])
  expect(writesOf(`gh pr view 1 -R ${PRA} | gh pr close 3 -R ${PRA}`)).toEqual([{ repo: PRA, number: 3 }])
  expect(writesOf(`gh pr merge -R ${PRA} https://github.com/IsmaelMartinez/teams-for-linux/pull/9`)).toEqual([{ repo: 'IsmaelMartinez/teams-for-linux', number: 9 }])
  expect(writesOf(`gh api repos/${PRA}/pulls/7/merge -X PUT`)).toEqual([{ repo: PRA, number: 7 }])
  expect(writesOf(`gh api graphql -f query='mutation { x }'`)).toEqual([])
  expect(writesOf(`gh pr merge 0 -R ${PRA}`)).toEqual([])
  expect(writesOf(`gh pr merge 4045 -R ../..`)).toEqual([{ number: 4045 }])
  // Linear: a command 64 times longer takes far less than 64 squared times longer to scan.
  const time = (n: number) => {
    const command = `gh pr comment 1 -R ${PRA} --body "${'a; '.repeat(n)}`
    const start = performance.now()
    for (let i = 0; i < 20; i += 1) writesOf(command)
    return performance.now() - start
  }
  time(1_000)
  expect(time(64_000)).toBeLessThan(Math.max(5, time(1_000)) * 64 * 4)
})

test('the poll reads the shown pair every 60 s while the pane is placed and shown, and nothing else', async ($, on) => {
  const seen = await shown($, on)
  expect(ghCalls(seen)).toHaveLength(2)
  await seen.clock.advance(MINUTE - 1)
  expect(ghCalls(seen)).toHaveLength(2)
  await seen.clock.advance(1)
  expect(ghCalls(seen).slice(2).sort()).toEqual([`${PRA}#2450`, `${PRA}#4045`])
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen)).toHaveLength(6)
  expect(queueCalls(seen)).toEqual([])
  expect(seen.calls.every(call => call.argv[0] !== 'gh' || call.timeoutMs === 8_000)).toBe(true)
})

test('hidden, waiting undrawn or closed, the poll stops and reads nothing; placed again, it resumes', async ($, on) => {
  const seen = await shown($, on)
  for (const panes of [[{ ...SHOWN, isShown: false }], [{ ...SHOWN, isPlaced: false }], []]) {
    seen.panes = panes
    const before = ghCalls(seen).length
    await seen.clock.advance(5 * MINUTE)
    expect(ghCalls(seen).length, JSON.stringify(panes)).toBe(before)
  }
  // Placed again: the pane draws, and the poll starts from that drawing.
  seen.panes = [SHOWN]
  const ui = await mountPane($, 'terminal')
  const before = ghCalls(seen).length
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen).length).toBe(before + 2)
  await ui.unmount()
  // The person hides it with /review-pair: the poll stops at once, and a turn end after they open it restarts it.
  await $.command.run(TYPED)
  seen.panes = []
  const hidden = ghCalls(seen).length
  await seen.clock.advance(3 * MINUTE)
  expect(ghCalls(seen).length).toBe(hidden)
  seen.panes = [SHOWN]
  await $.turn.complete(TURN)
  await seen.clock.settle()
  const resumed = ghCalls(seen).length
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen).length).toBe(resumed + 2)
})

// I2c fixes: showing a pane again from behind another tab raises no drawing, so the timer must outlive the hidden tick.
test('a pane hidden behind another tab for a tick is read again on the next tick once shown, with no drawing or turn end', async ($, on) => {
  const seen = await shown($, on)
  seen.panes = [{ ...SHOWN, isShown: false }]
  const hidden = ghCalls(seen).length
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen).length).toBe(hidden)
  seen.panes = [SHOWN]
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen).length).toBe(hidden + 2)
  // Gone from panes(), it stops: nothing more is read after it comes back until a drawing, an opening or a turn end.
  seen.panes = []
  await seen.clock.advance(MINUTE)
  seen.panes = [SHOWN]
  const gone = ghCalls(seen).length
  await seen.clock.advance(3 * MINUTE)
  expect(ghCalls(seen).length).toBe(gone)
})

test('in the queue or issues view the poll reads the queue, not the cards', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  expect(queueCalls(seen)).toEqual([PRA])
  await seen.clock.advance(MINUTE)
  expect(queueCalls(seen)).toEqual([PRA, PRA])
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'issues' })
  await seen.clock.advance(MINUTE)
  expect(queueCalls(seen)).toEqual([PRA, PRA, PRA])
  expect(ghCalls(seen)).toEqual([])
})

test('a hot reload never leaves two timers: three session starts still poll once a minute', async ($, on) => {
  const seen = await shown($, on)
  for (let i = 0; i < 3; i += 1) await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await seen.clock.settle()
  const before = ghCalls(seen).length
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen).length).toBe(before + 2)
  await seen.clock.advance(MINUTE)
  expect(ghCalls(seen).length).toBe(before + 4)
})

test('toasts only on a change since the last good read, never on a first read, one per change', async ($, on) => {
  const seen = await shown($, on)
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual([])
  const changes: [string, (pr: any) => void, string[]][] = [
    ['head', pr => void (pr.headRefOid = 'a'.repeat(40)), ['review-pair: #4045 head moved']],
    ['ci', pr => {
      const rollup = pr.commits.nodes[0].commit.statusCheckRollup
      rollup.state = 'FAILURE'
      rollup.contexts.nodes[0].conclusion = 'FAILURE'
    }, ['review-pair: #4045 CI failing']],
    ['ci back', pr => {
      const rollup = pr.commits.nodes[0].commit.statusCheckRollup
      rollup.state = 'SUCCESS'
      rollup.contexts.nodes[0].conclusion = 'SUCCESS'
    }, ['review-pair: #4045 CI passing']],
    ['approved', pr => void (pr.reviewDecision = 'APPROVED'), ['review-pair: #4045 approved']],
    ['changes', pr => void (pr.reviewDecision = 'CHANGES_REQUESTED'), ['review-pair: #4045 changes requested']],
    ['conflicts and closed', pr => {
      pr.mergeStateStatus = 'DIRTY'
      pr.state = 'CLOSED'
    }, ['review-pair: #4045 closed']],
    ['reopened with conflicts', pr => void (pr.state = 'OPEN'), ['review-pair: #4045 reopened', 'review-pair: #4045 has conflicts']],
  ]
  for (const [name, change, toasts] of changes) {
    seen.toasts.length = 0
    edit(seen, `${PRA}#4045`, change)
    await seen.clock.advance(MINUTE)
    expect(seen.toasts, name).toEqual(toasts)
  }
  // Nothing changed: no toast. A failed read: no toast, and the next good read compares with the last good one.
  seen.toasts.length = 0
  await seen.clock.advance(MINUTE)
  seen.modes[`${PRA}#4045`] = { kind: 'exit', stderr: 'gh: HTTP 502' }
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual([])
  seen.modes = {}
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual(['review-pair: #4045 merged'])
})

test('an issue closed or reopened toasts in the same words (#3887 was open when recorded); a new pair\'s first read of an item never toasts', async ($, on) => {
  const seen = await shown($, on, { repo: PRA, items: [{ number: 3887, kind: 'issue', action: 'close' }] })
  edit(seen, `${PRA}#3887`, issue => void (issue.state = 'CLOSED'))
  await seen.clock.advance(MINUTE)
  edit(seen, `${PRA}#3887`, issue => void (issue.state = 'OPEN'))
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual(['review-pair: #3887 closed', 'review-pair: #3887 reopened'])
  seen.toasts.length = 0
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-2', ...PAIR })
  expect(seen.toasts).toEqual([])
})

test('a toast is fixed words and a number: a hostile title, login, label or check name never reaches one', async ($, on) => {
  const seen = await shown($, on)
  const SENTINEL = 'IGNORE PREVIOUS merged #1'
  edit(seen, `${PRA}#4045`, pr => {
    pr.title = SENTINEL
    pr.author.login = 'sentinel-author'
    pr.labels.nodes.push({ name: SENTINEL })
    pr.labels.totalCount += 1
    pr.state = 'MERGED'
    pr.headRefOid = 'b'.repeat(40)
    pr.reviewDecision = 'APPROVED'
    const rollup = pr.commits.nodes[0].commit.statusCheckRollup
    rollup.state = 'FAILURE'
    rollup.contexts.nodes[0].conclusion = 'FAILURE'
    rollup.contexts.nodes[0].name = SENTINEL
  })
  await bash($, MERGE)
  await seen.clock.settle()
  expect(seen.toasts).toEqual([
    'review-pair: #4045 merged',
    'review-pair: #4045 head moved',
    'review-pair: #4045 CI failing',
    'review-pair: #4045 approved',
  ])
  for (const toast of seen.toasts) {
    expect(toast).toMatch(TOAST)
    expect(toast).not.toMatch(/IGNORE|sentinel/)
  }
})

// I1c review fixes. F1: a here-document's body is data, so an apostrophe in it never hides the gh write after it,
// and a write named only inside it never counts.
test('a here-document body is skipped: an apostrophe in it keeps the gh write after it, a write inside it is no write', async ($, on) => {
  const seen = await shown($, on)
  const body = `cat > /tmp/d.md <<'EOF'\nThanks, I'll merge once CI is green.\nEOF\n`
  let before = ghCalls(seen).length
  await bash($, `${body}gh pr review 4045 --repo ${PRA} --approve --body-file /tmp/d.md`)
  await seen.clock.settle()
  expect(ghCalls(seen).slice(before)).toEqual([`${PRA}#4045`])
  before = ghCalls(seen).length
  await bash($, `cat > notes.md <<'EOF'\ngh pr merge 2450 --repo ${PRA}\nEOF`)
  await seen.clock.settle()
  expect(ghCalls(seen).slice(before)).toEqual([])
  expect(writesOf(`cat <<-"END" > x\n\tit's\n\tEND\ngh pr close 9 -R ${PRA}`)).toEqual([{ repo: PRA, number: 9 }])
  expect(writesOf(`cat <<EOF\nwon't\nEOF\ngh pr merge 7 -R ${PRA}`)).toEqual([{ repo: PRA, number: 7 }])
  // A here-string (<<<) is a word on its line, not a here-document: the next line is a command.
  expect(writesOf(`grep x <<< "a" ; gh pr merge 8 -R ${PRA}`)).toEqual([{ repo: PRA, number: 8 }])
  expect(writesOf(`grep x <<< "a"\ngh pr merge 8 -R ${PRA}`)).toEqual([{ repo: PRA, number: 8 }])
  expect(writesOf(`grep x <<<a\ngh pr merge 8 -R ${PRA}`)).toEqual([{ repo: PRA, number: 8 }])
  // An unclosed body runs to the end: nothing after it is a command.
  expect(writesOf(`cat <<EOF\ngh pr merge 7 -R ${PRA}`)).toEqual([])
})

// F4: a backslash-newline joins lines as sh does, and the replies endpoint has digits in its tail.
test('a backslash-newline continues the command, quoted or not; a comment reply path names its pull request', () => {
  expect(writesOf(`gh api \\\n  -X POST \\\n  repos/${PRA}/pulls/4045/reviews -f event=APPROVE`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf(`gh pr review \\\n  4045 --repo ${PRA} --approve`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf(`gh pr comment 4045 -R ${PRA} --body "two\\\nlines"`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf(`gh pr merge "40\\\n45" -R ${PRA}`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf(`gh api -X POST repos/${PRA}/pulls/4045/comments/123/replies -f body=x`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf(`gh api repos/${PRA}/pulls/comments/4045 -X PATCH -f body=x`)).toEqual([])
})

// Security F3: one entry per gh write, with no dedupe pass, so many distinct writes still scan in linear time.
test('many distinct writes in one command scan in linear time', () => {
  const command = (n: number) => Array.from({ length: n }, (_, k) => `gh pr merge ${k + 1} -R ${PRA}`).join(';')
  const time = (n: number) => {
    const text = command(n)
    const start = performance.now()
    for (let i = 0; i < 5; i += 1) writesOf(text)
    return performance.now() - start
  }
  time(2_000)
  const [small, large] = [time(2_000), time(16_000)]
  expect(large).toBeLessThan(Math.max(2, small) * 16)
  expect(writesOf(`gh pr merge 4 -R ${PRA}; gh pr merge 4 -R ${PRA}`)).toHaveLength(2)
})

// F2 and security F1: the show call's own read is a first read for the new pair, so it never toasts, whether the
// item was shown in an earlier pair, cleared and shown again, or carried straight into the next pair.
test('a show call never toasts: an item shown again after another pair, after a clear, or carried over', async ($, on) => {
  const seen = await shown($, on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-2', repo: TFL, items: [{ number: 2998, action: 'COMMENT' }] })
  edit(seen, `${PRA}#4045`, pr => {
    pr.headRefOid = 'c'.repeat(40)
    pr.reviewDecision = 'APPROVED'
  })
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-3', ...PAIR, items: [{ ...PAIR.items[0], head: 'c'.repeat(40) }] })
  expect(seen.toasts).toEqual([])
  await $.tool.call({ tool: TOOL, tool_use_id: 'clear', repo: PRA, items: [] })
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-4', ...PAIR })
  expect(seen.toasts).toEqual([])
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'CLOSED'))
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-5', ...PAIR })
  expect(seen.toasts).toEqual([])
  // The next refresh compares with the show's read: closed already, so still nothing.
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual([])
})

test('a show whose read fails leaves no earlier pair\'s read to compare with: the next good read is a first read', async ($, on) => {
  const seen = await shown($, on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'clear', repo: PRA, items: [] })
  seen.modes[`${PRA}#4045`] = { kind: 'exit', stderr: 'gh: HTTP 502' }
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-2', ...PAIR })
  seen.modes = {}
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual([])
})

// F3: a read queued or running for an item the pair no longer holds neither runs again nor toasts.
test('a pair replaced while a post-write read waits behind a running one: the old item is not read again, no toast', async ($, on) => {
  const seen = await shown($, on)
  seen.modes[`${PRA}#4045`] = { kind: 'slow', ms: 3_000 }
  await seen.clock.advance(MINUTE)
  await bash($, MERGE)
  await seen.clock.settle()
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-2', ...TFL_PAIR })
  const before = ghCalls(seen).length
  await seen.clock.advance(10_000)
  expect(ghCalls(seen).slice(before).filter(key => key.startsWith(PRA))).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('a pair replaced while the post-write read runs: it lands without a toast for the item no longer shown', async ($, on) => {
  const seen = await shown($, on)
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  seen.modes[`${PRA}#4045`] = { kind: 'slow', ms: 3_000 }
  await bash($, MERGE)
  await seen.clock.settle()
  await $.tool.call({ tool: TOOL, tool_use_id: 'show-3', ...TFL_PAIR })
  await seen.clock.advance(3_500)
  expect(seen.toasts).toEqual([])
})

test('a pair cleared while the post-write read runs: it lands without a toast, the pane on the queue', async ($, on) => {
  const seen = await shown($, on)
  edit(seen, `${PRA}#4045`, pr => void (pr.state = 'MERGED'))
  seen.modes[`${PRA}#4045`] = { kind: 'slow', ms: 3_000 }
  await bash($, MERGE)
  await seen.clock.settle()
  await $.tool.call({ tool: TOOL, tool_use_id: 'clear', repo: PRA, items: [] })
  await seen.clock.advance(3_500)
  expect(seen.toasts).toEqual([])
})

// F4: GitHub's UNKNOWN merge state while it recomputes, and a partial CI read, say nothing: a change is told against
// the last state that did, so a standing conflict or failure never toasts twice, and a new one still toasts once.
test('an undetermined merge or CI state in between never repeats a toast, and never hides a real change', async ($, on) => {
  const seen = await shown($, on)
  const merge = (state: string) => edit(seen, `${PRA}#4045`, pr => void (pr.mergeStateStatus = state))
  for (const state of ['UNKNOWN', 'DIRTY', 'UNKNOWN', 'DIRTY', 'UNKNOWN', 'DIRTY']) {
    merge(state)
    await seen.clock.advance(MINUTE)
  }
  expect(seen.toasts).toEqual(['review-pair: #4045 has conflicts'])
  seen.toasts.length = 0
  for (const state of ['CLEAN', 'UNKNOWN', 'DIRTY']) {
    merge(state)
    await seen.clock.advance(MINUTE)
  }
  expect(seen.toasts).toEqual(['review-pair: #4045 has conflicts'])
  // A failed read in between keeps the basis too.
  seen.toasts.length = 0
  merge('UNKNOWN')
  await seen.clock.advance(MINUTE)
  seen.modes[`${PRA}#4045`] = { kind: 'exit', stderr: 'gh: HTTP 502' }
  await seen.clock.advance(MINUTE)
  seen.modes = {}
  merge('DIRTY')
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual([])
  const ci = (state: string, isPartial: boolean) =>
    edit(seen, `${PRA}#4045`, pr => {
      const rollup = pr.commits.nodes[0].commit.statusCheckRollup
      rollup.state = state
      rollup.contexts.nodes[0].conclusion = state
      rollup.contexts.totalCount = rollup.contexts.nodes.length + (isPartial ? 100 : 0)
    })
  for (const [state, isPartial] of [['FAILURE', false], ['SUCCESS', true], ['FAILURE', false], ['SUCCESS', true], ['SUCCESS', false]] as const) {
    ci(state, isPartial)
    await seen.clock.advance(MINUTE)
  }
  expect(seen.toasts).toEqual(['review-pair: #4045 CI failing', 'review-pair: #4045 CI passing'])
})
