import { expect, test } from 'claude-code/testing'

import { EVIDENCE_LETTERS, PAIR_LETTERS } from '../hooks/views'
import { lint } from './lint'
import { PAIR, PRA, SHOWN, SURFACES, TOOL, clone, detailed, mountPane, paneProps, textOf, world } from './world'
import type { World } from './world'

// The evidence bullets under Claude's reason: e and a count on one row, closed at the start; open, one bullet a row in
// autoAccept, the one colour besides text and grey that clears 5:1 on all four themes. An item without evidence draws
// as before.

type Drawn = { type?: string; key?: string; props?: Record<string, unknown>; children?: Drawn[] }

const ITEM_4045 = PAIR.items[0]!
const ITEM_2450 = PAIR.items[1]!
const BULLETS = [
  'It stops building and token-counting diff chunks once the call limit is reached.',
  'The agent compared it with main on 30,000 random inputs and the chunks and file lists matched every time.',
  'With 50 oversized files, preparation drops from 308 ms to 28 ms, which reproduces the PR\'s "207 to 23" figure.',
  '1 test fails with the fix reverted; its other tests check behaviour that doesn\'t change.',
]

const show = ($: any, id: string, input: object) => $.tool.call({ tool: TOOL, tool_use_id: id, ...input })

// Every Button's hotkey in a drawn tree, in document order.
function hotkeysOf(node: Drawn | undefined, found: string[] = []): string[] {
  if (node === null || typeof node !== 'object' || node === undefined) return found
  if (node.type === 'Button' && node.props?.hotkey !== undefined) found.push(String(node.props.hotkey))
  for (const child of node.children ?? []) hotkeysOf(child, found)
  return found
}

async function bulletsOf(ui: any): Promise<{ text: string; colors: unknown[] }[]> {
  const found: { text: string; colors: unknown[] }[] = []
  for (let i = 0; ; i += 1) {
    const row = (await ui.find({ type: 'Box', key: `evidence-${i}` })) as Drawn | undefined
    if (row === undefined) return found
    const texts: Drawn[] = []
    const walk = (node: Drawn | undefined) => {
      if (node === undefined || typeof node !== 'object') return
      if (node.type === 'Text') texts.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    walk(row)
    found.push({ text: textOf(row), colors: texts.map(one => one.props?.color) })
  }
}

test('evidence: closed at the start as one e row with its count, under the reason; e opens and closes it in autoAccept', async ($, on) => {
  const seen = world(on)
  const answer = await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, evidence: BULLETS }, ITEM_2450] })
  expect(String(answer.result)).toContain('Shown in the review-pair pane.')
  for (const surface of SURFACES) {
    for (const columns of [39, 104]) {
      const ui = await mountPane($, surface, columns, true)
      const key = (await ui.find({ type: 'Button', key: 'evidence-key' })) as Drawn | undefined
      expect(key?.props?.label).toBe('▸ evidence (4)')
      expect(key?.props?.hotkey).toBe('e')
      expect(await bulletsOf(ui)).toEqual([])
      expect(lint(await ui.drawn()), `${surface} ${columns} closed`).toEqual([])
      // The e row sits after the reason and before the draft block.
      const root = (await ui.drawn()) as Drawn
      const children = root.children ?? []
      const at = children.findIndex(child => child?.props?.key === 'evidence')
      expect(textOf(children[at - 1])).toBe(ITEM_4045.why)
      expect(children[at + 1]?.props?.key).toBe('draft')
      await ui.press({ key: 'evidence-key' })
      await seen.clock.settle()
      expect(((await ui.find({ type: 'Button', key: 'evidence-key' })) as Drawn | undefined)?.props?.label).toBe('▾ evidence (4)')
      const open = await bulletsOf(ui)
      expect(open.map(one => one.text)).toEqual(BULLETS.map(bullet => `•${bullet}`))
      for (const one of open) expect(one.colors.every(color => color === 'autoAccept')).toBe(true)
      expect(lint(await ui.drawn()), `${surface} ${columns} open`).toEqual([])
      // e is bound once, to the evidence key.
      expect(hotkeysOf((await ui.drawn()) as Drawn).filter(hotkey => hotkey === 'e')).toEqual(['e'])
      await ui.press({ key: 'evidence-key' })
      await seen.clock.settle()
      expect(await bulletsOf(ui)).toEqual([])
      await ui.unmount()
    }
  }
})

test('evidence: open per item, kept for an item a show carries over, closed for one it does not, emptied by a clear', async ($, on) => {
  const seen = world(on)
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, evidence: BULLETS }, { ...ITEM_2450, evidence: ['Only one.'] }] })
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'evidence-key' })
  await seen.clock.settle()
  expect((await bulletsOf(ui)).length).toBe(4)
  // The second tab's evidence is its own, closed.
  await ui.press({ key: 'tab-1' })
  await seen.clock.settle()
  expect(((await ui.find({ type: 'Button', key: 'evidence-key' })) as Drawn | undefined)?.props?.label).toBe('▸ evidence (1)')
  await ui.press({ key: 'tab-0' })
  await seen.clock.settle()
  // A revised show carrying #4045 keeps it open.
  await show($, 'c2', { repo: PRA, items: [{ ...ITEM_4045, evidence: BULLETS }] })
  expect((await bulletsOf(ui)).length).toBe(4)
  // A show without #4045 drops its mark, so a later show of it starts closed.
  await show($, 'c3', { repo: PRA, items: [ITEM_2450] })
  await show($, 'c4', { repo: PRA, items: [{ ...ITEM_4045, evidence: BULLETS }] })
  expect(await bulletsOf(ui)).toEqual([])
  // A clear empties it too.
  await ui.press({ key: 'evidence-key' })
  await seen.clock.settle()
  expect((await bulletsOf(ui)).length).toBe(4)
  await ui.unmount()
  await show($, 'c5', { repo: PRA, items: [] })
  await show($, 'c6', { repo: PRA, items: [{ ...ITEM_4045, evidence: BULLETS }] })
  await seen.clock.settle()
  const again = await mountPane($, 'terminal', 39, true)
  await again.press({ key: 'tab-0' })
  expect(await bulletsOf(again)).toEqual([])
  await again.unmount()
})

test('evidence: an item without it, or with an empty list, draws exactly as before; a bad list is refused whole', async ($, on) => {
  const seen = world(on)
  await show($, 'c1', { repo: PRA, items: [ITEM_4045, ITEM_2450] })
  // The drawing less each Button's press handle, which is new on every drawing.
  const tree = async (ui: any) => JSON.stringify(await ui.drawn(), (key, value) => (key === 'press' ? undefined : value))
  const plain = await mountPane($, 'terminal', 104, true)
  const before = await tree(plain)
  expect(await plain.find({ type: 'Box', key: 'evidence' })).toBeUndefined()
  expect(hotkeysOf((await plain.drawn()) as Drawn)).not.toContain('e')
  await plain.unmount()
  await show($, 'c2', { repo: PRA, items: [{ ...ITEM_4045, evidence: [] }, ITEM_2450] })
  const empty = await mountPane($, 'terminal', 104, true)
  expect(await tree(empty)).toBe(before)
  await empty.unmount()
  const calls = seen.calls.length
  for (const [evidence, reason] of [
    ['one string', '#4045 evidence must be a list.'],
    [['ok', ''], '#4045 evidence must be a list of visible strings.'],
    [['ok', 3], '#4045 evidence must be a list of visible strings.'],
  ] as const) {
    const answer = await show($, 'bad', { repo: PRA, items: [{ ...ITEM_4045, evidence }, ITEM_2450] })
    expect(answer.deny).toBe(`Not shown: ${reason}`)
  }
  expect(seen.calls.length).toBe(calls)
})

test('evidence: open bullets count toward the draft end, so a draft pushed out of the window is not seen until scrolled to', async ($, on) => {
  const seen: World = world(on)
  seen.panes = [SHOWN]
  const many = Array.from({ length: 40 }, (_, i) => `Bullet ${i + 1} of the evidence.`)
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, evidence: many }] })
  const facts = async () => {
    const ui = await mountPane($, 'terminal', 39, false)
    const row = (await ui.find({ type: 'Box', key: 'row-facts' })) as Drawn | undefined
    const words = textOf(row?.children?.[0])
    await ui.unmount()
    return words
  }
  const look = async (offset: number) => {
    const ui = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: { ...paneProps(39, true), scroll: { offset, bodyRows: 34 } } })
    await ui.drawn()
    await seen.clock.settle()
    return ui
  }
  // Open the evidence unfocused, which marks nothing.
  const opener = await mountPane($, 'terminal', 39, false)
  await opener.press({ key: 'evidence-key' })
  await seen.clock.settle()
  await opener.unmount()
  expect(await facts()).toBe('○')
  // Focused at the top: the forty bullets push the draft past the dock's 34 rows.
  await (await look(0)).unmount()
  expect(await facts()).toBe('○')
  // Scrolled to the end: seen.
  await (await look(60)).unmount()
  expect(await facts()).toBe('◆')
})

test('evidence: an item with it gives e to its key and its lettered rows skip e; one without keeps the letters it had', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${PRA}#2450`])
  const pr = card.data.repository.pullRequest
  const issue = pr.closingIssuesReferences.nodes[0]
  for (const number of [2460, 2461, 2462]) issue.timelineItems.nodes.push({ source: { number, state: 'OPEN', repository: { nameWithOwner: PRA } } })
  issue.timelineItems.totalCount += 3
  seen.answers[`${PRA}#2450`] = card
  const lettersOf = async (ui: any) => {
    const buttons = (await ui.findAll({ type: 'Button' })) as Drawn[]
    return buttons.filter(button => /^(log|issue-|pr-)/.test(String((button as any).key))).map(button => String(button.props?.hotkey))
  }
  await show($, 'c1', { repo: PRA, items: [ITEM_2450] })
  const plain = await mountPane($, 'terminal', 104, true)
  await detailed(plain)
  const before = await lettersOf(plain)
  expect(before.length).toBeGreaterThanOrEqual(3)
  expect(before).toEqual(Array.from(PAIR_LETTERS.slice(0, before.length)))
  expect(before).toContain('e')
  await plain.unmount()
  await show($, 'c2', { repo: PRA, items: [{ ...ITEM_2450, evidence: BULLETS }] })
  const withEvidence = await mountPane($, 'terminal', 104, true)
  await detailed(withEvidence)
  expect(await lettersOf(withEvidence)).toEqual(Array.from(EVIDENCE_LETTERS.slice(0, before.length)))
  expect(hotkeysOf((await withEvidence.drawn()) as Drawn).filter(hotkey => hotkey === 'e')).toEqual(['e'])
  expect(((await withEvidence.find({ type: 'Button', key: 'evidence-key' })) as Drawn | undefined)?.props?.hotkey).toBe('e')
  await withEvidence.unmount()
})
