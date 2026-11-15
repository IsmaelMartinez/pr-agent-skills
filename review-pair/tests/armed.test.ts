import { expect, test } from 'claude-code/testing'

import { PAIR, PRA, QUEUE_NOW, SHOWN, TOOL, TURN, TYPED, ghCalls, mountPane, queueCalls, world } from './world'
import type { World } from './world'

// I2e: the mod loads in every session on the machine, so it is dormant until this session is armed: by the skill's
// show call, by the Skill tool naming pr-maintainer, by the skill's own prompt, or by /review-pair. Dormant, it reads
// nothing, sets no status line and runs no poll, whatever repo the machine-wide store names.
const MINUTE = 60_000
const STATUS = 'pr-agent · ◆ 4 your move · ▲ 2 new · 18 PRs · 12 issues'
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const skillCall = (skill: string, id: string, agentId?: string) => ({ tool: 'Skill' as const, tool_use_id: id, skill, ...(agentId === undefined ? {} : { agentId }) })

// Nothing the arming paths do posts: only read-only GraphQL reads reach gh, nothing reaches the prompt, MCP or HTTP,
// and the engine ran only the Skill calls the test raised.
const nothingPosted = (seen: World) => {
  expect(seen.outward).toEqual([])
  expect(seen.toolRuns.every(run => run.startsWith('Skill '))).toBe(true)
  expect(seen.calls.every(call => call.argv[1] === 'api' && call.argv[2] === 'graphql' && !call.argv.join(' ').includes('mutation'))).toBe(true)
}

// A fresh session with the store's repo, started and left through three turn ends and a poll period.
async function dormant($: any, on: any): Promise<World> {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.session.start(START)
  await seen.clock.settle()
  for (let i = 0; i < 3; i += 1) {
    await $.turn.complete(TURN)
    await seen.clock.settle()
  }
  await seen.clock.advance(MINUTE)
  return seen
}

test('a fresh session with a store repo makes no gh call and sets no status over three turn ends and a poll period', async ($, on) => {
  const seen = await dormant($, on)
  expect(seen.calls).toEqual([])
  expect(seen.status).toEqual([])
  expect(seen.opened).toEqual([])
  expect(seen.toasts).toEqual([])
  nothingPosted(seen)
})

test('a show call in a dormant session arms and draws: the pair shows, and the turn\'s end reads the queue once and sets the status', async ($, on) => {
  const seen = await dormant($, on)
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  expect(String(answer.result)).toContain('Shown in the review-pair pane.')
  expect(seen.opened).toEqual(['review-pair'])
  // The call's own reads are its cards; the queue waits for the turn's end, as before.
  expect(ghCalls(seen).sort()).toEqual([`${PRA}#2450`, `${PRA}#4045`])
  expect(queueCalls(seen)).toEqual([])
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: '5 under review' })).toBeDefined()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  nothingPosted(seen)
})

test('the Skill tool naming pr-maintainer arms after its own run; another skill\'s name does not', async ($, on) => {
  const seen = await dormant($, on)
  for (const [skill, id] of [['commit', 's1'], ['pr-maintainer-notes', 's2'], ['PR-maintainer', 's3']] as const) {
    const other = await $.tool.call(skillCall(skill, id))
    expect(other.text).toBe('done')
    await $.turn.complete(TURN)
    await seen.clock.settle()
  }
  expect(seen.calls).toEqual([])
  expect(seen.status).toEqual([])
  const duty = await $.tool.call(skillCall('pr-maintainer', 's4'))
  expect(duty.text).toBe('done')
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  // Arming opens no pane, and the turn's end inside the minute reads nothing more.
  expect(seen.opened).toEqual([])
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.toolRuns).toEqual(['Skill commit', 'Skill pr-maintainer-notes', 'Skill PR-maintainer', 'Skill pr-maintainer'])
  nothingPosted(seen)
})

test('the skill\'s own prompt arms, typed or through the Skill tool', async ($, on) => {
  const seen = await dormant($, on)
  await $.skill.prompt({ skill: 'commit', text: 'Write a commit.' })
  await seen.clock.settle()
  expect(seen.calls).toEqual([])
  await $.skill.prompt({ skill: 'pr-maintainer', text: 'Maintainer duty.' })
  await seen.clock.settle()
  expect(seen.opened).toEqual(['review-pair'])
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  nothingPosted(seen)
})

test('/review-pair on arms without opening a pane; off clears the status, closes the pane and stops the poll; on arms again', async ($, on) => {
  const seen = await dormant($, on)
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(seen.opened).toEqual([])
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  // The bare command shows the pane; its poll reads each minute.
  await $.command.run(TYPED)
  await seen.clock.settle()
  expect(seen.opened).toEqual(['review-pair'])
  seen.panes = [SHOWN]
  await seen.clock.advance(MINUTE)
  expect(queueCalls(seen)).toEqual([PRA, PRA])
  expect(seen.status).toEqual([STATUS, STATUS])
  await $.command.run({ ...TYPED, args: 'off' })
  expect(seen.closed).toEqual(['review-pair'])
  expect(seen.status).toEqual([STATUS, STATUS, undefined])
  seen.panes = []
  // Zero gh calls after: two poll periods and two turn ends.
  const calls = seen.calls.length
  for (let i = 0; i < 2; i += 1) {
    await seen.clock.advance(MINUTE)
    await $.turn.complete(TURN)
    await seen.clock.settle()
  }
  expect(seen.calls).toHaveLength(calls)
  expect(seen.status).toHaveLength(3)
  // The pair is forgotten for this session, not in the store.
  expect(seen.store['repo']).toBe(PRA)
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, PRA, PRA])
  expect(seen.status.at(-1)).toBe(STATUS)
  expect(seen.opened).toEqual(['review-pair'])
  nothingPosted(seen)
})

test('the bare /review-pair arms: it opens the pane, reads once and sets the status', async ($, on) => {
  const seen = await dormant($, on)
  await $.command.run(TYPED)
  await seen.clock.settle()
  expect(seen.opened).toEqual(['review-pair'])
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  nothingPosted(seen)
})

test('/review-pair on with a pair held opens the pane, and hiding the pane with the bare command keeps the session armed', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW })
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  expect(seen.opened).toEqual(['review-pair'])
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  // Opened on the pair view, as the bare command opens it: its cards are read again, the queue at the turn's end.
  expect(seen.opened).toEqual(['review-pair', 'review-pair'])
  expect(ghCalls(seen)).toHaveLength(4)
  expect(queueCalls(seen)).toEqual([])
  seen.panes = [SHOWN]
  await $.command.run(TYPED)
  expect(seen.closed).toEqual(['review-pair'])
  seen.panes = []
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  nothingPosted(seen)
})

test('/review-pair with any other word says what it takes and arms nothing', async ($, on) => {
  const seen = await dormant($, on)
  const answer = await $.command.run({ ...TYPED, args: 'please' })
  expect(answer.text).toBe('/review-pair takes on or off.')
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.calls).toEqual([])
  expect(seen.status).toEqual([])
  nothingPosted(seen)
})

// The engine's /clear: every value the plugin holds reads as never written, until the plugin writes it again.
function clearing(on: any): Set<string> {
  const cleared = new Set<string>()
  on('state.get', async ($: any, e: any, next: any) => {
    const held: any = await next(e)
    return cleared.has(e.key) ? { value: { value: undefined, version: held.value.version } } : held
  })
  on('state.set', async ($: any, e: any, next: any) => {
    cleared.delete(e.key)
    return next(e)
  })
  return cleared
}
const STATE = ['armed', 'pair', 'cards', 'tab', 'view', 'repo', 'queue', 'detail', 'detailCard', 'trend', 'refreshing', 'cursor', 'expanded']

test('after /clear the pane still placed keeps the session armed: it reads again and the status comes back', async ($, on) => {
  const cleared = clearing(on)
  const seen = await dormant($, on)
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  expect(queueCalls(seen)).toEqual([PRA])
  for (const key of STATE) cleared.add(key)
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, PRA])
  expect(seen.status).toEqual([STATUS, STATUS])
  await seen.clock.advance(MINUTE)
  expect(queueCalls(seen)).toEqual([PRA, PRA, PRA])
  nothingPosted(seen)
})

test('after /clear with no pane the session stays dormant: no read, no status, until armed again', async ($, on) => {
  const cleared = clearing(on)
  const seen = await dormant($, on)
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  for (const key of STATE) cleared.add(key)
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  // Review R2: the engine keeps a plugin's status line across /clear, so the dormant session clears it.
  expect(seen.status).toEqual([STATUS, undefined])
  for (let i = 0; i < 2; i += 1) {
    await seen.clock.advance(MINUTE)
    await $.turn.complete(TURN)
    await seen.clock.settle()
  }
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS, undefined])
  await $.tool.call(skillCall('pr-maintainer', 's1'))
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, PRA])
  expect(seen.status).toEqual([STATUS, undefined, STATUS])
  nothingPosted(seen)
})

test('a subagent never arms: its turn ends, its Skill call and its show call leave the session dormant', async ($, on) => {
  const seen = await dormant($, on)
  for (let i = 0; i < 3; i += 1) {
    await $.turn.complete({ ...TURN, agentId: `agent-${i}` })
    await seen.clock.settle()
  }
  await $.tool.call(skillCall('pr-maintainer', 's1', 'agent-1'))
  await seen.clock.settle()
  const fromAgent = await $.tool.call({ tool: TOOL, tool_use_id: 'c1', agentId: 'agent-1', ...PAIR })
  expect(String(fromAgent.result)).toContain('Ignored')
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.calls).toEqual([])
  expect(seen.status).toEqual([])
  expect(seen.opened).toEqual([])
  nothingPosted(seen)
})

// Review R1: a queue read awaited inside the command's own invocation reads that invocation's view of $.state when it
// lands, so the shownRepo check cannot see that off ran meanwhile; the landing must be dropped another way.
async function offMidRead($: any, on: any, args: string): Promise<World> {
  const seen = await dormant($, on)
  seen.modes['queue'] = { kind: 'slow', ms: 3_000 }
  const running = $.command.run({ ...TYPED, args })
  await seen.clock.advance(1_000)
  expect(queueCalls(seen)).toEqual([PRA])
  // The bare command opened the pane before its read; the world's open does not place it by itself.
  if (seen.opened.length > 0) seen.panes = [SHOWN]
  await $.command.run({ ...TYPED, args: 'off' })
  seen.panes = []
  await seen.clock.advance(3_000)
  await running
  await seen.clock.settle()
  expect(seen.status).toEqual([undefined])
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.status).toEqual([undefined])
  // Nothing landed: on reads again at once rather than finding a queue held within the minute.
  delete seen.modes['queue']
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, PRA])
  expect(seen.status).toEqual([undefined, STATUS])
  nothingPosted(seen)
  return seen
}

test('a queue read in flight when off is pressed lands nowhere: /review-pair on', async ($, on) => {
  await offMidRead($, on, 'on')
})

test('a queue read in flight when off is pressed lands nowhere: the bare /review-pair', async ($, on) => {
  const seen = await offMidRead($, on, '')
  expect(seen.closed).toEqual(['review-pair'])
})

// Review R3: the real engine draws the pane once more while it closes, and a drawing restarts the poll; off stops it
// last of all, so no timer outlives it. The world's close draws here as the engine did; the panes list it reads is
// what a tick asks for first.
test('/review-pair off stops the poll for good: a drawing raised while the pane closes restarts nothing', async ($, on) => {
  const seen = await dormant($, on)
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  seen.onClose = async () => {
    await mountPane($, 'terminal')
  }
  await $.command.run({ ...TYPED, args: 'off' })
  expect(seen.closed).toEqual(['review-pair'])
  seen.panes = []
  const reads = seen.paneReads
  const calls = seen.calls.length
  await seen.clock.advance(2 * MINUTE)
  expect(seen.paneReads).toBe(reads)
  expect(seen.calls).toHaveLength(calls)
  expect(seen.status).toEqual([STATUS, undefined])
  nothingPosted(seen)
})

// Review R4: only a Skill run that happened arms; one a PreToolUse hook denied or one the engine could not run names
// the skill all the same.
test('the published skill name, pr-agent-maintainer, arms through the Skill tool', async ($, on) => {
  const seen = await dormant($, on)
  await $.tool.call(skillCall('pr-agent-maintainer', 's1'))
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.opened).toEqual([])
})

test('the published skill name\'s own prompt arms and opens the pane, as pr-maintainer\'s does', async ($, on) => {
  const typed = await dormant($, on)
  await $.skill.prompt({ skill: 'pr-agent-maintainer', text: 'Maintainer duty.' })
  await typed.clock.settle()
  expect(typed.opened).toEqual(['review-pair'])
  expect(queueCalls(typed)).toEqual([PRA])
})

test('a Skill call naming pr-maintainer that was denied or errored does not arm', async ($, on) => {
  const seen = await dormant($, on)
  seen.denyTools = true
  const denied = await $.tool.call(skillCall('pr-maintainer', 's1'))
  expect(denied.deny).toBe('denied by a PreToolUse hook')
  await seen.clock.settle()
  seen.denyTools = false
  seen.skillErrors = true
  const errored = await $.tool.call(skillCall('pr-maintainer', 's2'))
  expect(errored.isError).toBe(true)
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(seen.calls).toEqual([])
  expect(seen.status).toEqual([])
  expect(seen.toolRuns).toEqual([])
  seen.skillErrors = false
  const ran = await $.tool.call(skillCall('pr-maintainer', 's3'))
  expect(ran.text).toBe('done')
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
  expect(seen.status).toEqual([STATUS])
  nothingPosted(seen)
})
