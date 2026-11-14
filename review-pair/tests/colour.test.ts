import { expect, test } from 'claude-code/testing'

import { lint } from './lint'
import { PAIR, PRA, QUEUE_NOW, SHOWN, SURFACES, TFL, TOOL, TYPED, columnOf, detailed, glyphOf, mountPane, textOf, world } from './world'

// I1c 2d and 2e: each element's colour by role, and the legend: closed by default, l toggles it in every view, it
// fits 39 and 104 columns, and it stays as the viewer left it across refreshes and view switches.
const LEGEND = [
  // I1 colour roles: one line per pill role, its swatch an example pill, then the bare row's meaning. Review F9: these
  // come first, so a one-column legend (56 columns) shows them in the 11-row strip.
  ' CI FAILED  act now: broken or late',
  ' YOU OWE 2  your move, next: first',
  ' READY  all green; CLEAR: none owed',
  ' MERGED  done; POSTED for one refresh',
  ' NOT READ  failed or over 5 min old',
  'no pill: nothing to act on',
  '✓ passed, holds, as reviewed',
  '▲ unknown, partial or worth a look',
  '✗ blocks: moved, failing, conflicts',
  '● merged',
  // I5 (review F3): ○ also marks an item not yet seen.
  '○ a note or not seen; grey: reasons',
  "✻ Claude's ask, what you say yes to",
  '▎ draft, verbatim; blue letters: keys',
  // I2c: the trend's colours.
  '▅ open PRs a week; purple: this week',
  '▼ queue falling; ▲ rising, ● flat',
  "Aa plain words: GitHub's data",
  // I4 (review F8): where an unbound key goes.
  'other keys: typed into the prompt',
  's: the rows behind the status line',
  'a: the maintainer board, in a browser',
  // I5: the decision ledger's marks and the text hash.
  '◆ seen: draft read to its end',
  '◇ changed since you looked',
  '‖ held by h: a mark, nothing more',
  '✓ grey: written by Claude, or merged',
  // I5 (review F3): the hash covers the inline comments too.
  'text 3f9a1c: sha256, draft + inline',
]

// The legend is one wrapping Box of 37-column lines: one line a row at 39 columns, two at 104.
const legendBox = async (ui: any) => (await ui.find({ type: 'Box', key: 'legend-lines' })) as any
const lineOf = (line: any) => (line.children as any[]).map(textOf).join(' ')
async function legendOf(ui: any): Promise<string[]> {
  const box = await legendBox(ui)
  return box === undefined ? [] : (box.children as any[]).map(lineOf)
}
const rootKeys = async (ui: any) => (((await ui.drawn()) as any).children as any[]).map(child => String(child.props?.key ?? ''))

test('colour by role: the draft block has a blue left rule and words in text; reason and clear in inactive; data in text', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  for (const surface of SURFACES) {
    for (const columns of [39, 104]) {
      const ui = await mountPane($, surface, columns)
      await ui.press({ key: 'tab-0' })
      // The status line's glyph carries the colour and its words stay in text; s opens the rows behind it.
      expect(await glyphOf(ui, '1 open thread ·')).toEqual({ glyph: '▲', color: 'warning' })
      expect((await ui.find({ type: 'Text', text: '1 open thread ·' }))?.props.color).toBeUndefined()
      await detailed(ui)
      // Tab 1: Claude's reason, the draft, the clear line.
      const block = (await ui.find({ type: 'Box', key: 'draft' })) as any
      expect(block.props).toMatchObject({ borderStyle: 'quote', borderColor: 'suggestion', flexDirection: 'column' })
      const inBlock = (words: string) => (block.children as any[]).some(child => textOf(child) === words)
      // The rule and the legend name the block: no heading inside it, whose row the quote's blank top would cost
      // the draft on the 104-column strip.
      expect(inBlock('Draft, verbatim')).toBe(false)
      expect(await ui.find({ type: 'Text', text: 'Draft, verbatim' })).toBeUndefined()
      expect(textOf(block.children[0])).toBe('Thanks @PeterDaveHello, approving and merging.')
      expect((await ui.find({ type: 'Text', text: 'Thanks @PeterDaveHello, approving and merging.' }))?.props.color).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^Narrow fix with tests/ }))?.props.color).toBe('inactive')
      // I2d: the reason wraps in full, said outright.
      expect((await ui.find({ type: 'Text', text: /^Narrow fix with tests/ }))?.props.wrap).toBe('wrap')
      expect((await ui.find({ type: 'Text', text: /^clear: / }))?.props.color).toBe('inactive')
      // Data: title and byline in text.
      expect((await ui.find({ type: 'Text', text: /^fix\(github\): avoid retrying/ }))?.props.color).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^@PeterDaveHello · contributor/ }))?.props.color).toBeUndefined()
      // Claude's ask is data in text; the batch count beside the tabs is info in inactive.
      expect((await ui.find({ type: 'Text', text: 'Claude 9/10: approve and merge' }))?.props).toMatchObject({ bold: true })
      expect((await ui.find({ type: 'Text', text: 'Claude 9/10: approve and merge' }))?.props.color).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: '5 under review' }))?.props.color).toBe('inactive')
      // Status: the glyph carries the colour, the words stay in text.
      const head = (await ui.findAll({ type: 'Box', text: 'head 35a07eb as reviewed' })).filter((box: any) => String(box.key).startsWith('row-')).pop() as any
      expect(head.children[0].children[0].props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: 'head 35a07eb as reviewed' }))?.props.color).toBeUndefined()
      // Tab 2: inline comments sit in the same block, the path as info, the body as the draft.
      await ui.press({ key: 'tab-1' })
      const inline = (await ui.find({ type: 'Box', key: 'draft' })) as any
      expect(textOf(inline)).toContain('Could this reuse `_as_line`?')
      expect((await ui.find({ type: 'Text', text: 'pr_agent/git_providers/gitlab_provider.py:979' }))?.props.color).toBe('inactive')
      expect((await ui.find({ type: 'Text', text: 'Could this reuse `_as_line`?' }))?.props.color).toBeUndefined()
      expect(lint(await ui.drawn())).toEqual([])
      await ui.unmount()
    }
  }
})

test('an item with no draft and no inline draws no block; the queue rows are text and its captions inactive', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW })
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: PRA, items: [{ number: 4045, action: 'approve and merge' }] })
  const ui = await mountPane($, 'terminal', 39, true)
  expect(await ui.find({ type: 'Box', key: 'draft' })).toBeUndefined()
  await ui.press({ key: 'queue' })
  // I2c: the trend is read from GitHub after the queue lands.
  await seen.clock.settle()
  expect((await ui.find({ type: 'Text', text: 'fix(azure): surface diff collection failures' }))?.props.color).toBeUndefined()
  // I2c: narrow, the trend's caption carries its peak.
  expect((await ui.find({ type: 'Text', text: /open PRs, weekly mean, last 16 weeks$/ }))?.props.color).toBe('inactive')
  expect((await ui.find({ type: 'Text', text: 'Nobody has looked (2)' }))?.props.color).toBeUndefined()
  // Counts and row trailers are data: words in text, with an amber glyph beside an amber count.
  for (const words of ['owe 0', 'PRs 18', 'issues 12', 'new 2']) {
    expect((await ui.find({ type: 'Text', text: words }))?.props.color, words).toBeUndefined()
  }
  expect((await ui.find({ type: 'Text', text: /^back · [0-9]+h$/ }))?.props.color).toBeUndefined()
})

test('the legend is closed by default; focused, the header offers l: legend where the ctrl+x tab hint sits', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW })
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  for (const surface of SURFACES) {
    for (const columns of [39, 104]) {
      for (const view of ['pair', 'queue', 'issues']) {
        const unfocused = await mountPane($, surface, columns, false)
        if (view !== 'pair') await unfocused.press({ key: view })
        expect(await unfocused.find({ type: 'Button', key: 'legend' })).toBeUndefined()
        expect(await unfocused.find({ type: 'Text', text: 'ctrl+x tab: keys' })).toBeDefined()
        expect(await legendOf(unfocused)).toEqual([])
        await unfocused.unmount()
        const ui = await mountPane($, surface, columns, true)
        expect((await ui.find({ type: 'Button', key: 'legend' }))?.props).toMatchObject({ label: 'legend', hotkey: 'l', plain: true })
        expect(await ui.find({ type: 'Text', text: 'ctrl+x tab: keys' })).toBeUndefined()
        expect(await legendOf(ui)).toEqual([])
        if (view !== 'pair') await ui.press({ key: 'pair' })
        await ui.unmount()
      }
    }
  }
})

test('l opens the legend under the header in every view, and it stays open across refreshes, views and pairs', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW })
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'legend' })
  // The legend follows the header (the tabs, then the batch row in the tall dock), before the gap and Claude's row.
  let keys = await rootKeys(ui)
  expect(keys[keys.indexOf('row-claude') - 1]).toBe('gap-claude')
  expect(keys[keys.indexOf('gap-claude') - 1]).toBe('legend-lines')
  expect(keys[keys.indexOf('legend-lines') - 1]).toBe('batch')
  expect(keys[keys.indexOf('batch') - 1]).toBe('tabs')
  expect(await legendOf(ui)).toEqual(LEGEND)
  await ui.press({ key: 'refresh' })
  expect(await legendOf(ui)).toEqual(LEGEND)
  await ui.press({ key: 'queue' })
  // At 39 columns the queue's header is two rows, the second the legend key.
  keys = await rootKeys(ui)
  // I1 colour roles: the attention line sits between the header and the legend.
  expect(keys.slice(2, 4)).toEqual(['attention', 'legend-lines'])
  expect((await columnOf(ui))[4]).toMatch(/^(▲ ?)?owe /)
  await ui.press({ key: 'issues' })
  expect((await rootKeys(ui)).indexOf('legend-lines')).toBe(3)
  await ui.press({ key: 'refresh' })
  expect(await legendOf(ui)).toEqual(LEGEND)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c2', repo: TFL, items: [{ number: 2998, action: 'COMMENT' }] })
  expect(await legendOf(ui)).toEqual(LEGEND)
  const wide = await mountPane($, 'desktop', 104, true)
  expect(await legendOf(wide)).toEqual(LEGEND)
  expect(lint(await wide.drawn())).toEqual([])
  await wide.press({ key: 'legend' })
  expect(await legendOf(ui)).toEqual([])
  expect(await legendOf(wide)).toEqual([])
  await $.command.run(TYPED)
})

test('the legend is 37-column lines in one wrapping row: one a row at 39 columns, two at 104; words in text, cut at the end', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW })
  seen.panes = [SHOWN]
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  for (const surface of SURFACES) {
    for (const columns of [39, 104]) {
      const ui = await mountPane($, surface, columns, true)
      await ui.press({ key: 'legend' })
      const box = await legendBox(ui)
      // 37 + 2 + 37 fits 104 and not 39: the layout needs no column count, and the head and CI rows stay in the
      // strip's window with the legend open.
      expect(box.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 })
      const lines = box.children as any[]
      expect(lines).toHaveLength(LEGEND.length)
      for (const line of lines) {
        const words = lineOf(line)
        expect(line.type).toBe('Box')
        expect(line.props.width, words).toBe(37)
        expect(words.length, words).toBeLessThanOrEqual(37)
        const last = line.children[line.children.length - 1].children[0]
        expect(last.props.wrap, words).toBe('truncate-end')
        expect(last.props.color, words).toBeUndefined()
      }
      // I1 colour roles (review F9's order): five pill swatches, the bare row's plain line, nine glyph swatches, then
      // the data line.
      const swatches = [...lines.slice(0, 5), ...lines.slice(6, 15)]
      expect(swatches).toHaveLength(14)
      expect(swatches.map(line => line.children[0].props.flexShrink)).toEqual(Array(swatches.length).fill(0))
      // Colours: each glyph in its own key, the swatch in the draft's blue, then (I2c) the trend's bars and direction.
      expect(swatches.slice(5).map(line => line.children[0].children[0].props.color)).toEqual(['success', 'warning', 'error', 'merged', 'inactive', 'claude', 'suggestion', 'remember', 'success'])
      // I1: each pill swatch on its role's key, its words in inverseText.
      // 2.1.303 reports a bold Text with weight 'semibold' beside it, so each swatch's props are checked as a subset.
      for (const [i, backgroundColor] of ['error', 'planMode', 'success', 'merged', 'inactive'].entries()) {
        expect(swatches[i]?.children[0].children[0].props).toMatchObject({ color: 'inverseText', backgroundColor, bold: true })
      }
      expect(lint(await ui.drawn())).toEqual([])
      await ui.press({ key: 'legend' })
      await ui.unmount()
    }
  }
})

test('no row takes l: the rows skip it, so the legend key never clashes with a row key', async ($, on) => {
  const seen = world(on, { now: QUEUE_NOW, store: { repo: TFL } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  const ui = await mountPane($, 'terminal', 104, true)
  await ui.press({ key: 'issues' })
  const hotkeys = (await ui.findAll({ type: 'Button' })).map((button: any) => button.props.hotkey).filter(Boolean)
  expect(hotkeys.filter((key: string) => key === 'l')).toEqual(['l'])
  expect(new Set(hotkeys).size).toBe(hotkeys.length)
})
