import { expect, test } from 'claude-code/testing'

import { PAIR, PRA, QUEUE_NOW, SHOWN, TFL, TOOL, TURN, TYPED, queueCalls, world } from './world'

// I2e prove pins: one assertion each for the mutants of the armed flag that the I2e suite let through.
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

// D03: a hot reload (or the promotion from a build with no armed key) finds the pane placed: duty was running here.
test('I2e pin: a session start with the pane placed arms, so the turn end reads the queue', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  seen.panes = [SHOWN]
  await $.session.start(START)
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
})

// D05: a pane placed behind another tab across /clear is still a placed pane.
test('I2e pin: /clear with the pane placed but hidden keeps the session armed', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  seen.panes = [{ ...SHOWN, isShown: false }]
  await $.classic.SessionStart({ source: 'clear' })
  await seen.clock.settle()
  await $.turn.complete(TURN)
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA])
})

// C04: on never hides a shown pane.
test('I2e pin: /review-pair on with the pane shown leaves it open', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(seen.closed).toEqual([])
})

// O07: off forgets the pair, so on afterwards has no pair to open the pane for.
test('I2e pin: after off, on finds no pair held and opens no pane', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW })
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  await seen.clock.settle()
  await $.command.run({ ...TYPED, args: 'off' })
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(seen.opened).toEqual(['review-pair'])
})

// O08: off forgets the queue, so on inside the minute reads again and the status line comes back.
test('I2e pin: on straight after off reads the queue again', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  await $.command.run({ ...TYPED, args: 'off' })
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, PRA])
})

// O06: off forgets the repo for this session, so the next arming takes the store's repo as it is then.
test('I2e pin: after off, on takes the repo the store names now', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  await $.command.run({ ...TYPED, args: 'off' })
  seen.store['repo'] = TFL
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  expect(queueCalls(seen)).toEqual([PRA, TFL])
})

// C06: the word is read trimmed.
test('I2e pin: /review-pair with " off " disarms', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: PRA } })
  await $.command.run({ ...TYPED, args: 'on' })
  await seen.clock.settle()
  await $.command.run({ ...TYPED, args: ' off ' })
  expect(seen.status.at(-1)).toBeUndefined()
})
