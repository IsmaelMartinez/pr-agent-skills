import { expect, test } from 'claude-code/testing'

import { PAIR_LETTERS } from '../hooks/views'
import { lint } from './lint'
import { PAIR, PRA, SHOWN, SURFACES, TOOL, clone, columnOf, glyphOf, mountPane, paneProps, textOf, world } from './world'
import type { World } from './world'

// One status line per item: the worst tier's glyph, the worst signals, then the merge and draft slots, a glyph on a
// slot only when it is not green. s opens the head, CI, exception and clear rows under it, per item, kept across
// refreshes; collapsed, none of them draws.

const ITEM = { ...PAIR.items[0]!, head: '35a07eb' }
const NUMBER = 4045
const show = ($: any, id: string, items: object[]) => $.tool.call({ tool: TOOL, tool_use_id: id, repo: PRA, items })

// #4045 as recorded, less its one bot thread: every signal green.
function green(seen: World, number = NUMBER, edit: (pr: any) => void = () => {}) {
  const card = clone(seen.answers[`${PRA}#${NUMBER}`])
  const pr = card.data.repository.pullRequest
  pr.reviewThreads.nodes = []
  pr.reviewThreads.totalCount = 0
  edit(pr)
  seen.answers[`${PRA}#${number}`] = card
}

const statusOf = async (ui: any) => (await columnOf(ui)).find(row => / s: (details|collapse)$/.test(row))
// The glyphs drawn on the status line, in order.
async function glyphsOf(ui: any): Promise<string[]> {
  const status = (await ui.find({ type: 'Box', key: 'status' })) as any
  return (status?.children ?? []).filter((part: any) => String(part.key ?? part.props?.key).startsWith('row-')).map((part: any) => textOf(part.children[0]))
}

test('status line: all green draws one row with a single ✓, all clear and the check count, and the plain slots', async ($, on) => {
  const seen = world(on)
  green(seen)
  await show($, 'c1', [{ ...ITEM, number: NUMBER }])
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 104)
    expect(await statusOf(ui)).toBe('✓ all clear · 9 checks · clean · not draft s: details')
    expect(await glyphsOf(ui)).toEqual(['✓'])
    expect(await glyphOf(ui, 'all clear · 9 checks ·')).toEqual({ glyph: '✓', color: 'success' })
    // Collapsed: no head, CI, exception or clear row.
    const column = await columnOf(ui)
    expect(column.filter(row => /^. (head|CI|clear:) /.test(row))).toEqual([])
    expect(await ui.find({ type: 'Box', key: 'status-rows' })).toBeUndefined()
    await ui.unmount()
  }
})

test('status line: each amber signal alone draws ▲ first; a slot keeps its own ▲, and green slots stay plain', async ($, on) => {
  const seen = world(on)
  const thread = clone(seen.answers[`${PRA}#${NUMBER}`]).data.repository.pullRequest.reviewThreads
  const cases: [string, (pr: any) => void, object, string][] = [
    ['draft', pr => (pr.isDraft = true), {}, '▲ 9 checks · clean · ▲ draft'],
    ['merge unknown', pr => (pr.mergeStateStatus = 'UNKNOWN'), {}, '▲ 9 checks · ▲ merge unknown · not draft'],
    ['thread', pr => (pr.reviewThreads = thread), {}, '▲ 1 open thread · clean · not draft'],
    ['CI running', pr => (pr.commits.nodes[0].commit.statusCheckRollup.state = 'PENDING'), {}, '▲ CI running · clean · not draft'],
    ['head unknown', () => {}, { head: undefined }, '▲ head unknown · clean · not draft'],
    ['base', pr => (pr.baseRefName = 'release'), {}, '▲ base release · clean · not draft'],
  ]
  let number = 7100
  for (const [what, edit, extra, line] of cases) {
    number += 1
    green(seen, number, edit)
    await show($, `c-${number}`, [{ ...ITEM, number, ...extra }])
    const ui = await mountPane($, 'terminal', 104)
    expect(await statusOf(ui), what).toBe(`${line} s: details`)
    expect(await glyphOf(ui, /(9 checks|1 open thread|CI running|head unknown|base release) ·$/), what).toEqual({ glyph: '▲', color: 'warning' })
    expect(await glyphsOf(ui), what).not.toContain('✗')
    await ui.unmount()
  }
})

test('status line: each red signal alone draws ✗ first and beats amber; merged draws ● with its pill', async ($, on) => {
  const seen = world(on)
  const cases: [string, (pr: any) => void, object, string][] = [
    ['head moved', () => {}, { head: '1234567' }, '✗ head moved · clean · not draft'],
    ['CI failing', pr => {
      const rollup = pr.commits.nodes[0].commit.statusCheckRollup
      rollup.state = 'FAILURE'
      rollup.contexts.nodes[0].conclusion = 'FAILURE'
    }, {}, '✗ CI 1 failing · clean · not draft'],
    ['conflicts', pr => (pr.mergeStateStatus = 'DIRTY'), {}, '✗ 9 checks · ✗ conflicts · not draft'],
    ['changes requested', pr => (pr.reviewDecision = 'CHANGES_REQUESTED'), {}, '✗ changes requested · clean · not draft'],
  ]
  let number = 7300
  for (const [what, edit, extra, line] of cases) {
    number += 1
    // Each red case also carries an amber draft: red still leads.
    green(seen, number, pr => {
      edit(pr)
      pr.isDraft = true
    })
    await show($, `c-${number}`, [{ ...ITEM, number, ...extra }])
    const ui = await mountPane($, 'terminal', 104)
    expect(await statusOf(ui), what).toBe(`${line.replace(' · not draft', ' · ▲ draft')} s: details`)
    expect((await glyphsOf(ui))[0], what).toBe('✗')
    await ui.unmount()
  }
  green(seen, 7400, pr => (pr.state = 'MERGED'))
  await show($, 'c-7400', [{ ...ITEM, number: 7400 }])
  const ui = await mountPane($, 'terminal', 104)
  expect(await statusOf(ui)).toBe('● 9 checks · ● merged · not draft s: details')
  expect(await glyphOf(ui, '9 checks ·')).toEqual({ glyph: '●', color: 'merged' })
  expect(await ui.find({ type: 'Text', text: ' MERGED ' })).toBeDefined()
  await ui.unmount()
})

test('status line: the lead names two phrases then +N; the merge and draft slots always draw', async ($, on) => {
  const seen = world(on)
  green(seen, 7500, pr => {
    pr.mergeStateStatus = 'DIRTY'
    pr.isDraft = true
    pr.baseRefName = 'release'
    pr.reviewDecision = 'CHANGES_REQUESTED'
    pr.commits.nodes[0].commit.statusCheckRollup.state = 'PENDING'
  })
  await show($, 'c1', [{ ...ITEM, number: 7500, head: '1234567' }])
  const ui = await mountPane($, 'terminal', 104)
  expect(await statusOf(ui)).toBe('✗ head moved · ✗ changes requested · +2 · ✗ conflicts · ▲ draft s: details')
  await ui.unmount()
})

test('status line: rows that read alike are one phrase, and a stale read names its age', async ($, on) => {
  const seen = world(on)
  green(seen, 7800, pr => {
    pr.files.totalCount += 50
    pr.labels.totalCount += 50
  })
  await show($, 'c1', [{ ...ITEM, number: 7800 }])
  const ui = await mountPane($, 'terminal', 104)
  expect(await statusOf(ui)).toBe('▲ short read · clean · not draft s: details')
  await seen.clock.advance(10 * 60_000)
  await seen.clock.settle()
  expect(await statusOf(ui)).toMatch(/^▲ short read · ▲ read [0-9]+ min old · clean · not draft s: details$/)
  await ui.unmount()
})

test('status line: s opens the rows with their letters, s again closes them, per item; a refresh keeps it', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${PRA}#2450`])
  const rollup = card.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup
  rollup.state = 'FAILURE'
  rollup.contexts.nodes[0].conclusion = 'FAILURE'
  seen.answers[`${PRA}#2450`] = card
  await show($, 'c1', [ITEM, PAIR.items[1]!])
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 104, true)
    await ui.press({ key: 'tab-1' })
    // Collapsed: the rows' Buttons are not drawn, so none takes a letter.
    expect(await ui.find({ type: 'Button', key: 'log' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'issue-2445' })).toBeUndefined()
    await ui.press({ key: 'details' })
    await seen.clock.settle()
    expect((await ui.find({ type: 'Button', key: 'details' }))?.props).toMatchObject({ label: 'collapse', hotkey: 's', plain: true })
    expect((await ui.find({ type: 'Button', key: 'log' }))?.props.hotkey).toBe(PAIR_LETTERS[0])
    expect((await ui.find({ type: 'Button', key: 'issue-2445' }))?.props.hotkey).toBe(PAIR_LETTERS[1])
    const column = await columnOf(ui)
    const at = column.findIndex(row => row.endsWith(' s: collapse'))
    expect(column[at + 1]).toMatch(/^✗ head moved to /)
    expect(column[at + 2]).toMatch(/^✗ CI failing · .* b: log$/)
    // The other tab is its own, collapsed.
    await ui.press({ key: 'tab-0' })
    expect((await ui.find({ type: 'Button', key: 'details' }))?.props.label).toBe('details')
    await ui.press({ key: 'tab-1' })
    // A refresh reads again and leaves it open.
    await ui.press({ key: 'refresh' })
    await seen.clock.settle()
    expect((await ui.find({ type: 'Button', key: 'details' }))?.props.label).toBe('collapse')
    await ui.press({ key: 'details' })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Box', key: 'status-rows' })).toBeUndefined()
    await ui.unmount()
  }
})

test('status line: at 39, 53, 104 and 120 columns it lints clean open and closed, s is bound once and is no row letter', async ($, on) => {
  const seen = world(on)
  green(seen, 7600, pr => (pr.isDraft = true))
  await show($, 'c1', [{ ...ITEM, number: 7600 }, PAIR.items[1]!])
  expect(PAIR_LETTERS).not.toContain('s')
  const hotkeys = async (ui: any) => ((await ui.findAll({ type: 'Button' })) as any[]).map(button => String(button.props?.hotkey ?? ''))
  for (const surface of SURFACES) {
    for (const columns of [39, 53, 104, 120]) {
      const ui = await mountPane($, surface, columns, true)
      for (const tab of [0, 1]) {
        await ui.press({ key: `tab-${tab}` })
        for (const isOpen of [false, true]) {
          const what = `${surface} ${columns} tab ${tab} ${isOpen ? 'open' : 'closed'}`
          expect(lint(await ui.drawn()), what).toEqual([])
          expect((await hotkeys(ui)).filter(key => key === 's'), what).toEqual(['s'])
          // Each part is one Box of whole words: the line wraps between parts, and no part is cut.
          const status = (await ui.find({ type: 'Box', key: 'status' })) as any
          expect(status.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
          const words = (node: any): any[] => (node?.type === 'Text' ? [node] : (node?.children ?? []).flatMap(words))
          for (const text of words(await ui.find({ type: 'Box', key: 'status' }))) expect(text.props?.wrap, what).toBeUndefined()
          await ui.press({ key: 'details' })
          await seen.clock.settle()
        }
      }
      await ui.unmount()
    }
  }
})

test('status line: the draft end counts the status line, and the rows s opens, so the draft is seen only once in view', async ($, on) => {
  const seen: World = world(on)
  seen.panes = [SHOWN]
  green(seen, 7700)
  green(seen, 7701)
  await show($, 'c1', [{ ...ITEM, number: 7700 }])
  const markOf = async (number: number) => {
    const ui = await mountPane($, 'terminal', 104, false)
    const facts = await ui.find({ type: 'Box', key: 'row-facts' })
    const mark = textOf((facts as any)?.children?.[0])
    await ui.unmount()
    return { number, mark }
  }
  const look = async (offset: number) => {
    const ui = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: { ...paneProps(104, true), scroll: { offset, bodyRows: 11 } } })
    await ui.drawn()
    await seen.clock.settle()
    await ui.unmount()
  }
  // Collapsed, the lone item's draft ends inside the strip's 11 rows: seen at the top.
  await look(0)
  expect(await markOf(7700)).toEqual({ number: 7700, mark: '◆' })
  // Opened (unfocused, which marks nothing), head, CI and clear push the end past the strip: seen only scrolled.
  await show($, 'c2', [{ ...ITEM, number: 7701 }])
  const opener = await mountPane($, 'terminal', 104, false)
  await opener.press({ key: 'details' })
  await seen.clock.settle()
  await opener.unmount()
  await look(0)
  expect(await markOf(7701)).toEqual({ number: 7701, mark: '○' })
  await look(8)
  expect(await markOf(7701)).toEqual({ number: 7701, mark: '◆' })
})
