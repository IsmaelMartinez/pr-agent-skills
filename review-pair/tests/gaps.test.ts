import { expect, test } from 'claude-code/testing'

import { writesOf } from '../hooks/github'
import { PAIR, PRA, SHOWN, TOOL, clone, ghCalls, world } from './world'

const MINUTE = 60_000

test('W10: -R as a github.com URL or host path names the repo', () => {
  expect(writesOf(`gh pr merge 4045 -R https://github.com/${PRA}`)).toEqual([{ repo: PRA, number: 4045 }])
  expect(writesOf(`gh pr merge 4045 --repo github.com/${PRA}`)).toEqual([{ repo: PRA, number: 4045 }])
})

test('W15: a follow-up queued behind a running read is dropped once the pane is hidden', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 's', ...PAIR })
  seen.modes[`${PRA}#4045`] = { kind: 'slow', ms: 3_000 }
  await seen.clock.advance(MINUTE)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: `gh pr merge 4045 -R ${PRA}` })
  await seen.clock.settle()
  seen.panes = [{ ...SHOWN, isShown: false }]
  const before = ghCalls(seen).length
  await seen.clock.advance(5_000)
  expect(ghCalls(seen).slice(before)).toEqual([])
})

test('T01: a head first read as unknown, then known, is no head moved', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 's', ...PAIR })
  const set = (sha: string) => {
    const answer = clone(seen.answers[`${PRA}#4045`])
    answer.data.repository.pullRequest.headRefOid = sha
    seen.answers[`${PRA}#4045`] = answer
  }
  set('not-a-sha')
  await seen.clock.advance(MINUTE)
  set('a'.repeat(40))
  await seen.clock.advance(MINUTE)
  expect(seen.toasts).toEqual([])
})
