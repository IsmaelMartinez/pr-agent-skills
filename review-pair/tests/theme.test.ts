import { expect, test } from 'claude-code/testing'

import { RULE_FLOOR, WORD_FLOOR, contrast, lint, worst } from './lint'
import { BACKGROUNDS, PALETTES } from './palette'
import { PAIR, PRA, REAL, SURFACES, TFL_PAIR, TOOL, clone, mountPane, textOf, world } from './world'

// G7: the lint over ui.drawn() at 36, 40, 60 and 104 columns on both surfaces finds nothing on every state
// the card can be in, and still flags a deliberately bad palette.
const WIDTHS = [36, 40, 60, 104]

async function lintAll($: any, tabs: number): Promise<string[]> {
  const problems: string[] = []
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      for (const isFocused of [false, true]) {
        const ui = await mountPane($, surface, columns, isFocused)
        for (let tab = 0; tab < tabs; tab += 1) {
          await ui.press({ key: `tab-${tab}` })
          problems.push(...lint(await ui.drawn()).map(problem => `${surface} ${columns} tab ${tab}: ${problem}`))
        }
        await ui.unmount()
      }
    }
  }
  return problems
}

// A CPU-bound sweep (3.7 s on 2.1.303 before I5), given room for a loaded machine.
test('the theme lint finds no problem on fresh, held, failing, merged, issue, hostile, stale and failed cards', { timeoutMs: 15_000 }, async ($, on) => {
  const seen = world(on)
  const hostile = clone(seen.answers[`${PRA}#4045`])
  hostile.data.repository.pullRequest.title = `fix ${String.fromCodePoint(0x202e)}evil${String.fromCodePoint(0x200b)}`
  seen.answers[`${PRA}#7003`] = hostile
  const problems: string[] = []
  const show = async (items: object[], repo = PRA) => {
    await $.tool.call({ tool: TOOL, tool_use_id: `c-${problems.length}-${items.length}`, repo, items })
    problems.push(...(await lintAll($, items.length)))
  }
  await show(PAIR.items)
  await show(TFL_PAIR.items, TFL_PAIR.repo)
  await show([{ number: 3010, action: 'none, merged' }, { number: 3021, action: 'none, merged' }], TFL_PAIR.repo)
  await show([{ number: 882, kind: 'issue', action: 'close' }, { number: 3887, kind: 'issue', action: 'reply' }, { number: 7003, action: 'COMMENT', draft: `x${String.fromCodePoint(0x2028)}y\n\`\`\`suggestion\n` }])
  // Stale at five minutes, then a failed refresh, then a failed first read.
  await seen.clock.advance(5 * 60_000)
  problems.push(...(await lintAll($, 3)))
  seen.modes['*'] = { kind: 'exit', stderr: REAL.gateway }
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'refresh' })
  await ui.unmount()
  problems.push(...(await lintAll($, 3)))
  await show([{ number: 9999, action: 'approve' }])
  expect(problems).toEqual([])
})

test('the same lint flags a deliberately bad palette', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return Box({
      flexDirection: 'column',
      children: [
        Text({ color: '#ff0000', children: 'raw colour words' }),
        Text({ color: 'subtle', children: 'subtle words' }),
        Text({ dimColor: true, children: 'dim words' }),
        Text({ color: 'warning', children: 'CI held for your approval' }),
        Box({ key: 'row-lonely', flexDirection: 'row', children: Text({ color: 'success', children: '✓' }) }),
        Text({ color: 'error', children: '✗' }),
        Button({ key: 'dim', label: 'dim', plain: true, dimColor: true, onPress: () => undefined }),
        // I1c: blue draft words, a full border, a rule under 3:1, a raw rule colour and a rule glyph off the blue.
        Text({ color: 'suggestion', children: 'Thanks, approving and merging.' }),
        Box({ key: 'boxed', borderStyle: 'round', borderColor: 'suggestion', children: Text({ children: 'boxed draft' }) }),
        Box({ key: 'faint-rule', borderStyle: 'quote', borderColor: 'warning', children: Text({ children: 'amber rule' }) }),
        Box({ key: 'raw-rule', borderStyle: 'quote', borderColor: '#5769f7', children: Text({ children: 'raw rule' }) }),
        Box({ key: 'row-swatch', flexDirection: 'row', children: [Text({ color: 'claude', children: '▎' }), Text({ children: 'draft' })] }),
        // I2c: trend bars under 3:1 (the warning amber reaches 1.89 on Latte), a raw bar colour, and this week's words in
        // the blue that misses 5:1.
        Box({ key: 'row-faint-bars', flexDirection: 'row', children: [Text({ color: 'warning', children: '▅▅▆' }), Text({ children: 'words' })] }),
        Text({ color: '#5769f7', children: '▂▃' }),
        Text({ color: 'suggestion', children: '▂ now 21' }),
        // I1 colour roles: an amber pill, a pill with words in text, an unpadded lowercase pill, a band on a status key,
        // two pills in one row, and (with the rows above) more than three pills drawn. A Button cannot carry colour here:
        // ButtonProps has no color (d.ts), so the lint's rule for it stays a guard against a raw prop, not a kit case.
        Box({ key: 'row-amber', flexDirection: 'row', children: [Text({ color: 'inverseText', backgroundColor: 'warning', bold: true, children: ' CI HELD ' }), Text({ children: 'held' })] }),
        Box({ key: 'row-text-pill', flexDirection: 'row', children: [Text({ color: 'text', backgroundColor: 'error', children: 'ci failed' }), Text({ children: 'words' })] }),
        Box({ key: 'row-band', flexDirection: 'row', backgroundColor: 'error', children: [Text({ color: 'inactive', children: 'a red row' })] }),
        Box({ key: 'row-two', flexDirection: 'row', children: [Text({ color: 'inverseText', backgroundColor: 'success', bold: true, children: ' READY ' }), Text({ color: 'inverseText', backgroundColor: 'merged', bold: true, children: ' MERGED ' }), Text({ children: 'words' })] }),
        Box({ key: 'row-four', flexDirection: 'row', children: [Text({ color: 'inverseText', backgroundColor: 'planMode', bold: true, children: ' YOU OWE 2 ' }), Text({ children: 'words' })] }),
      ],
    })
  })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: 'review-pair',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 104, scroll: { offset: 0, bodyRows: 6 }, view: {} },
      viewport: { columns: 108, rows: 40, isFullscreen: true },
    })
    const problems = lint(await band.drawn())
    expect(problems).toEqual([
      'Text color "#ff0000" is not a ThemeKey',
      'words "raw colour words" in #ff0000',
      'Text color subtle',
      'words "subtle words" in subtle',
      'dimColor on Text "dim words"',
      'words "CI held for your approval" in warning',
      'row row-lonely has a glyph and no words',
      'glyph ✗ outside a row',
      'dimColor on Button "dim"',
      'words "Thanks, approving and merging." in suggestion',
      'Box "boxed" border round: only the left rule, quote, is drawn',
      'Box "faint-rule" rule in warning, under 3:1 or not the draft blue',
      'Box borderColor "#5769f7" is not a ThemeKey',
      'Box "raw-rule" rule in #5769f7, under 3:1 or not the draft blue',
      'rule glyph in claude',
      'bars "▅▅▆" in warning, under 3:1',
      'Text color "#5769f7" is not a ThemeKey',
      'bars "▂▃" in #5769f7, under 3:1',
      'words "▂ now 21" in suggestion',
      'row row-amber has 0 glyphs',
      'backgroundColor warning on " CI HELD ": not a pill or band key',
      'words " CI HELD " in inverseText',
      'pill "ci failed" words in text, not inverseText',
      'pill "ci failed" not bold',
      'pill "ci failed" is not uppercase words with one space each side',
      'Box "row-band" band on error: not a band key',
      'band "row-band" words "a red row" in inactive, not text',
      'row row-band has 0 glyphs',
      'row row-two has 2 glyphs',
      'Box "row-two" has 2 pills, over 1',
      '4 pills drawn, over 3',
    ])
    await band.unmount()
  }
})

// I1c G7 by measurement: the blue keys fall short of 5:1 on white and Latte, so the draft's words stay in text and
// its block is marked by a blue left rule, which needs the non-text 3:1 and gets it in every RGB theme.
test('words reach 5:1 in text and inactive on every background; the blue fails it on light, and clears 3:1 as a rule', () => {
  const table: Record<string, Record<string, number>> = {}
  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const [bg, rgb] of Object.entries(BACKGROUNDS[palette.family])) {
      for (const key of ['text', 'inactive', 'suggestion', 'permission']) {
        const fg = palette.keys[key]
        if (fg !== undefined) (table[key] ??= {})[`${name} on ${bg}`] = Math.round(contrast(fg, rgb) * 100) / 100
      }
    }
  }
  expect(worst('text')).toBeGreaterThanOrEqual(WORD_FLOOR)
  expect(worst('inactive')).toBeGreaterThanOrEqual(WORD_FLOOR)
  expect(table.suggestion?.['light on white']).toBe(4.4)
  expect(table.suggestion?.['light on latte']).toBe(3.89)
  expect(table.suggestion?.['dark on black']).toBe(11.18)
  expect(table.suggestion?.['dark on mocha']).toBe(8.73)
  expect(worst('suggestion')).toBeLessThan(WORD_FLOOR)
  expect(worst('suggestion')).toBeGreaterThanOrEqual(RULE_FLOOR)
  expect(table.permission).toEqual(table.suggestion)
  expect(table.inactive?.['light on latte']).toBe(5.08)
})

// The one exception the lint cannot see: the engine draws each Button's hotkey letter in its accent colour
// (ButtonProps.plain), and ButtonProps has no colour prop. The paints measured those letters at the suggestion
// RGB in both themes, so they fall short of 5:1 on white and Latte; the legend's blue line names them.
test('the hotkey letters are the engine-owned exception to 5:1: the suggestion blue, named by the legend', async ($, on) => {
  const seen = world(on)
  seen.panes = [{ id: 'review-pair', title: 'Review pair', isShown: true, isFocused: false, isPlaced: true }]
  const accent = (family: 'light' | 'dark') => PALETTES[family]?.keys.suggestion as [number, number, number]
  expect(accent('light')).toEqual([87, 105, 247])
  expect(accent('dark')).toEqual([177, 185, 249])
  expect(Math.round(contrast(accent('light'), BACKGROUNDS.light.latte as [number, number, number]) * 100) / 100).toBe(3.89)
  expect(worst('suggestion')).toBeLessThan(WORD_FLOOR)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  const ui = await mountPane($, 'terminal', 39, true)
  await ui.press({ key: 'legend' })
  const line = (await ui.findAll({ type: 'Box' })).find((box: any) => box.key === 'row-legend-draft') as any
  expect(line.children[0].children[0].props.color).toBe('suggestion')
  expect(textOf(line.children[1])).toBe('draft, verbatim; blue letters: keys')
  expect((await ui.findAll({ type: 'Button' })).every((button: any) => button.props.color === undefined)).toBe(true)
})

// I2c G7 by measurement: the trend's bars are graphics in the blue that clears 3:1 in every RGB theme, this week's bar
// and 'now' are words in the one other key that clears 5:1 everywhere, and its direction glyphs keep their status keys.
test('the trend\'s keys by measurement: bars in remember clear 3:1, now in autoAccept clears 5:1, on all four backgrounds', () => {
  const table = (key: string) =>
    Object.fromEntries(
      Object.entries(PALETTES).flatMap(([name, palette]) =>
        Object.entries(BACKGROUNDS[palette.family]).map(([bg, rgb]) => [`${name} on ${bg}`, Math.round(contrast(palette.keys[key] as [number, number, number], rgb) * 100) / 100]),
      ),
    )
  expect(table('remember')).toEqual({
    'light on white': 8.59,
    'light on latte': 7.6,
    'light-daltonized on white': 4.68,
    'light-daltonized on latte': 4.14,
    'dark on black': 11.18,
    'dark on mocha': 8.73,
    'dark-daltonized on black': 12.44,
    'dark-daltonized on mocha': 9.71,
  })
  expect(worst('remember')).toBeGreaterThanOrEqual(RULE_FLOOR)
  expect(worst('remember')).toBeLessThan(WORD_FLOOR)
  expect(table('autoAccept')).toEqual({
    'light on white': 6.04,
    'light on latte': 5.35,
    'light-daltonized on white': 6.04,
    'light-daltonized on latte': 5.35,
    'dark on black': 7.73,
    'dark on mocha': 6.04,
    'dark-daltonized on black': 7.73,
    'dark-daltonized on mocha': 6.04,
  })
  expect(worst('autoAccept')).toBeGreaterThanOrEqual(WORD_FLOOR)
  // The other candidates measured and set aside: the draft blue and ide miss 5:1 for words, planMode misses it on Mocha,
  // and the warning amber misses even 3:1 in light-daltonized, so it can mark a glyph's state but never draw bars.
  expect(worst('suggestion')).toBeLessThan(WORD_FLOOR)
  expect(worst('planMode')).toBeLessThan(WORD_FLOOR)
  expect(worst('warning')).toBeLessThan(RULE_FLOOR)
})
