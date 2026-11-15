import { expect, test } from 'claude-code/testing'

import { canonicalText } from '../hooks/text'
import { PAIR, PRA, SHOWN, TOOL, clone, mountPane, paneProps, textOf, world } from './world'

// I5 prove pins: one assertion each for the four mutants the suite let through (tmp/i5-prove/mut/genuine.txt).
const ITEM_4045 = PAIR.items[0]!
const longDraft = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long review.`).join('\n')

const factsOf = async (ui: any) => {
  const row = (await ui.find({ type: 'Box', key: 'row-facts' })) as any
  return `${textOf(row?.children?.[0])} ${(row?.children?.[1]?.children ?? []).map(textOf).join(' ')}`
}

test('I5 pin H04: inline comments enter the canonical string in the order given', () => {
  expect(canonicalText('D', [{ path: 'a', line: 1, body: 'x' }, { path: 'b', line: 2, body: 'y' }])).toBe('["D",[["a",1,"x"],["b",2,"y"]]]')
})

test('I5 pin H09: the draft is hashed as stored, untrimmed', async ($, on) => {
  world(on)
  // printf '%s' '["  Thanks.\n",[]]' | shasum -a 256 -> 2e7efe05... (JSON writes the newline as backslash n)
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'p1', repo: PRA, items: [{ ...ITEM_4045, draft: '  Thanks.\n' }] })
  expect(String(answer.result)).toContain('#4045 text 2e7efe head 35a07eb.')
})

test('I5 pin S09: a focused window one row short of the long draft\'s end (77 in the 39-column dock) is not seen', async ($, on) => {
  const seen = world(on)
  seen.panes = [{ ...SHOWN, isFocused: true }]
  await $.tool.call({ tool: TOOL, tool_use_id: 'p1', repo: PRA, items: [{ ...ITEM_4045, draft: longDraft }] })
  const ui = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: { ...paneProps(39, true), scroll: { offset: 42, bodyRows: 34 } } })
  await ui.drawn()
  await seen.clock.settle()
  await ui.unmount()
  const glance = await mountPane($, 'terminal', 39, false)
  expect(await factsOf(glance)).toMatch(/^○ not seen /)
})

test('I5 pin W03: a card that said merged before Claude\'s write leaves the item written, not merged', async ($, on) => {
  const seen = world(on)
  const merged = clone(seen.answers[`${PRA}#4045`])
  merged.data.repository.pullRequest.state = 'MERGED'
  seen.answers[`${PRA}#4045`] = merged
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'p1', ...PAIR })
  seen.panes = []
  await seen.clock.advance(60_000)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: `gh pr comment 4045 --body hi --repo ${PRA}` })
  await seen.clock.settle()
  const glance = await mountPane($, 'terminal', 104, false)
  expect(await factsOf(glance)).toMatch(/^✓ written /)
})
