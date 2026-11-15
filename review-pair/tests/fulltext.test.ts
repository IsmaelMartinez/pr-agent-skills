import { expect, test } from 'claude-code/testing'

import { detailOf } from '../hooks/github'
import { columnsOf, widthOf, wrap } from '../hooks/text'
import { DETAIL_NOW, PR_3995 } from './detail-fixtures'
import { PAIR, PRA, SHOWN, TOOL, TYPED, clone, columnOf, detailed, paneProps, textOf, world, opened as openGroup } from './world'
import type { World } from './world'

// I2: #3995 sits under the queue's author group, which draws collapsed, so every press of its row opens the group first
// (openGroup), as Enter on the group row does.

// I2d: the full text. The detail draws the whole description and the whole of each comment or review, wrapped to the
// pane's columns into rows the person scrolls; the pair draws Claude's ask and reason whole.
const CONTROLS = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u

// The person opens the queue with /review-pair on the day the detail answers were recorded.
async function queued($: any, on: any): Promise<World> {
  const seen = world(on, { now: DETAIL_NOW, store: { repo: PRA } })
  await $.command.run(TYPED)
  await seen.clock.settle()
  seen.panes = [SHOWN]
  return seen
}

const withPr = (seen: World, change: (pr: any) => void) => {
  const answer = clone(PR_3995)
  change(answer.data.repository.pullRequest)
  seen.details[`${PRA}#3995`] = answer
}

// A pane of the dock's or the strip's width, or tall enough to hold a whole detail.
const mount = ($: any, columns: number, bodyRows?: number) => {
  const props = paneProps(columns, true)
  return $.ui.mount({
    plugin: 'review-pair',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'review-pair',
    props: bodyRows === undefined ? props : { ...props, scroll: { offset: 0, bodyRows } },
  })
}
const scroll = ($: any, by: number, bodyRows: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset: 0, by, bodyRows, contentRows: bodyRows, origin: { kind: 'person' } } as any)
const heads = (rows: string[]) => rows.filter(text => /^[✓✗○●] (you|author|@)/.test(text))
// The entry's words: the rows under its head to the next head, heading or note, their two-column lead dropped.
function wordsUnder(rows: string[], head: number): string[] {
  const under: string[] = []
  for (const text of rows.slice(head + 1)) {
    if (!text.startsWith('  ')) break
    under.push(text.slice(2))
  }
  return under
}
// Deterministic words of 1 to 11 letters, joined by one space, at least `size` characters long.
function prose(size: number): string {
  const words: string[] = []
  let length = -1
  for (let i = 0; length < size; i += 1) {
    const word = `${'abcdefghijk'.slice(0, 1 + ((i * 7) % 11))}${i}`
    words.push(word)
    length += word.length + 1
  }
  return words.join(' ')
}

test('wrap: rows split at spaces, inner spaces and indentation kept, the spaces at a break dropped, the empty line one row', () => {
  expect(wrap('', 10)).toEqual([''])
  expect(wrap('hello world', 11)).toEqual(['hello world'])
  expect(wrap('hello world', 10)).toEqual(['hello', 'world'])
  expect(wrap('hello world', 5)).toEqual(['hello', 'world'])
  expect(wrap('a  b', 10)).toEqual(['a  b'])
  expect(wrap('  indented code', 20)).toEqual(['  indented code'])
  expect(wrap('  indented code', 12)).toEqual(['  indented', 'code'])
  expect(wrap('ab cd ef', 5)).toEqual(['ab cd', 'ef'])
  expect(wrap('abc   def', 4)).toEqual(['abc', 'def'])
  expect(wrap('abc def', 3)).toEqual(['abc', 'def'])
  expect(wrap('a b c d', 1)).toEqual(['a', 'b', 'c', 'd'])
  expect(wrap('abc', 0)).toEqual(['a', 'b', 'c'])
})

test('wrap: a word wider than the row is cut hard into whole rows, after the words before it', () => {
  expect(wrap('x'.repeat(10), 4)).toEqual(['xxxx', 'xxxx', 'xx'])
  expect(wrap(`ab ${'x'.repeat(10)} cd`, 4)).toEqual(['ab', 'xxxx', 'xxxx', 'xx', 'cd'])
  expect(wrap(`ab ${'x'.repeat(6)}`, 8)).toEqual(['ab', 'xxxxxx'])
  expect(wrap(`ab ${'x'.repeat(5)}`, 8)).toEqual(['ab xxxxx'])
})

test('wrap: wide characters take two columns, marks and emoji selectors none, so a row never overflows', () => {
  for (const [char, want] of [['a', 1], ['日', 2], ['！', 2], ['〈', 2], ['🙂', 2], ['⌚', 2], ['ｱ', 1], ['\u{301}', 0], ['\u{200D}', 0], ['\u{FE0F}', 0], ['\u{20E3}', 0]] as const) {
    expect(columnsOf(char), `U+${(char.codePointAt(0) ?? 0).toString(16)}`).toBe(want)
  }
  expect(wrap('日本語テキスト', 6)).toEqual(['日本語', 'テキス', 'ト'])
  expect(wrap('🙂🙂🙂', 4)).toEqual(['🙂🙂', '🙂'])
  expect(wrap('a🙂b', 3)).toEqual(['a🙂', 'b'])
  expect(wrap('e\u{301}e\u{301}', 1)).toEqual(['e\u{301}', 'e\u{301}'])
  expect(widthOf('e\u{301}')).toBe(1)
  expect(widthOf('❤\u{FE0F}')).toBe(2)
  // A selector or joiner stays on the row of the emoji before it, so the marks pass still reads it as the emoji's.
  expect(wrap('❤\u{FE0F}❤\u{FE0F}', 2)).toEqual(['❤\u{FE0F}', '❤\u{FE0F}'])
  expect(wrap('👨\u{200D}👩', 2)).toEqual(['👨\u{200D}', '👩'])
})

test('wrap: a hidden run is as wide as the token the marks pass draws, and stays whole', () => {
  expect(widthOf('ab\u{202E}cd')).toBe(2 + '{U+202E}'.length + 2)
  expect(wrap('ab\u{202E}cd', 20)).toEqual(['ab\u{202E}cd'])
  expect(wrap('ab\u{202E}cd', 10)).toEqual(['ab\u{202E}', 'cd'])
  // One word: the token starts a row when it does not fit, and the letters after it fill that row.
  expect(wrap('ab\u{202E}cd', 9)).toEqual(['ab', '\u{202E}c', 'd'])
  const run = '\u{200B}'.repeat(5)
  expect(widthOf(`a${run}b`)).toBe(1 + '{U+200B +4}'.length + 1)
  expect(wrap(`a${run}b`, 12)).toEqual([`a${run}`, 'b'])
  // Every row of a mixed text measures within the width (from the 11 columns the widest token here takes: a token is
  // never split, the documented limitation), and joined they are the text less the spaces at breaks.
  const text = `one 日本 🙂 ${'x'.repeat(30)} two\u{202E}three ${run} four e\u{301} five`
  for (const width of [11, 12, 17, 39]) {
    const rows = wrap(text, width)
    for (const row of rows) expect(widthOf(row), `${width}: ${row}`).toBeLessThanOrEqual(width)
    expect(rows.join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''))
  }
})

test('a 60-line body draws 60 rows in a tall pane and the strip scrolls down to its last line', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
  })
  const tall = await mount($, 104, 2_000)
  await openGroup(tall, 'group-author')
  await tall.press({ key: 'pull-3995' })
  let column = await columnOf(tall)
  const [start, latest] = [column.indexOf('Description'), column.indexOf('Latest')]
  expect(column.slice(start + 1, latest)).toEqual(Array.from({ length: 60 }, (_, i) => `line ${i + 1}`))
  expect(column.slice(start, latest).join('\n')).not.toMatch(/more lines?\)/)
  await tall.press({ key: 'detail-back' })
  await tall.unmount()
  const strip = await mount($, 104)
  await openGroup(strip, 'group-author')
  await strip.press({ key: 'pull-3995' })
  // I1: the attention line is one more of the head's rows, so the body starts a row lower than I2d drew it.
  expect((await columnOf(strip))[4]).toBe('Description')
  await scroll($, 60, 11)
  column = await columnOf(strip)
  expect(column[4]).toBe('line 60')
  expect(column[5]).toBe('Latest')
  await scroll($, 1_000, 11)
  column = await columnOf(strip)
  expect(column).toHaveLength(11)
  expect(column.at(-1)).toMatch(/test_gitlab_webhook_new_mr_retry\.py \+155 −0$/)
})

test('a 3,000-character comment is drawn whole across rows under its head, two columns in', async ($, on) => {
  const seen = await queued($, on)
  const text = prose(3_000)
  expect(text.length).toBeGreaterThanOrEqual(3_000)
  withPr(seen, pr => {
    pr.comments.nodes.push({ author: { login: 'longwinded', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: text })
  })
  for (const columns of [39, 104]) {
    const ui = await mount($, columns, 2_000)
    await openGroup(ui, 'group-author')
    await ui.press({ key: 'pull-3995' })
    const column = await columnOf(ui)
    const head = column.indexOf('○ @longwinded comment 5m')
    expect(head).toBeGreaterThan(column.indexOf('Latest'))
    const rows = wordsUnder(column, head)
    expect(rows.length).toBeGreaterThan(3_000 / columns)
    expect(rows.join(' ')).toBe(text)
    for (const row of rows) expect(widthOf(row) + 2, row).toBeLessThanOrEqual(columns)
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
})

test('the storage caps: 400 lines or 40,000 code points of a description, 200 lines of an entry, the rest counted in a grey row', async ($, on) => {
  const manyLines = clone(PR_3995)
  manyLines.data.repository.pullRequest.body = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n\n')
  const lines = (detailOf(manyLines, 'pr', 3995, DETAIL_NOW) as any).description.value
  expect(lines.lines.filter((text: string) => text !== '')).toHaveLength(400)
  expect(lines.lines.at(-1)).toBe('line 400')
  expect(lines.more).toBe(50)
  const manyPoints = clone(PR_3995)
  manyPoints.data.repository.pullRequest.body = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(3, '0')}${'p'.repeat(997)}`).join('\n')
  const points = (detailOf(manyPoints, 'pr', 3995, DETAIL_NOW) as any).description.value
  expect(points.lines).toHaveLength(40)
  expect(points.lines.join('')).toHaveLength(40_000)
  expect(points.more).toBe(10)
  // A line that runs past what is left is cut there, the cut shown, and the lines after it counted.
  const longLine = clone(PR_3995)
  longLine.data.repository.pullRequest.body = `${'a'.repeat(39_990)}\n${'b'.repeat(100)}\nlast`
  const cut = (detailOf(longLine, 'pr', 3995, DETAIL_NOW) as any).description.value
  expect(cut.lines).toEqual(['a'.repeat(39_990), `${'b'.repeat(9)}…`])
  expect(cut.more).toBe(1)
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.body = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n')
    pr.comments.nodes.push({ author: { login: 'longwinded', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: Array.from({ length: 250 }, (_, i) => `said ${i + 1}`).join('\n') })
  })
  const ui = await mount($, 104, 2_000)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  expect(column[latest - 1]).toBe('(50 more lines)')
  expect(column[latest - 2]).toBe('line 400')
  expect((await ui.find({ type: 'Text', text: '(50 more lines)' }))?.props.color).toBe('inactive')
  const head = column.indexOf('○ @longwinded comment 5m')
  const rows = wordsUnder(column, head)
  expect(rows).toHaveLength(201)
  expect(rows[199]).toBe('said 200')
  expect(rows[200]).toBe('(50 more lines)')
  expect((await ui.find({ type: 'Text', text: '  (50 more lines)' }))?.props.color).toBe('inactive')
  // An entry with no words draws its head row alone.
  const empty = column.indexOf('✓ you APPROVED 2h')
  expect(empty).toBeGreaterThan(latest)
})

test('an entry with an empty body draws its head row only; a blank run inside a body is one blank row', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.comments.nodes = [
      { author: { login: 'terse', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: '   \n\n' },
      { author: { login: 'spaced', __typename: 'User' }, createdAt: '2026-10-11T17:49:00Z', body: 'first\n\n\n\nsecond\n```\n  code\n```\n' },
    ]
    pr.reviews.nodes = []
  })
  const ui = await mount($, 104, 2_000)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const column = await columnOf(ui)
  const latest = column.indexOf('Latest')
  expect(column.slice(latest + 1, latest + 9)).toEqual([
    '○ @terse comment 5m',
    '○ @spaced comment 6m',
    '  first',
    ' ',
    '  second',
    '  ```',
    '    code',
    '  ```',
  ])
  expect(column[latest + 9]).toBe('Files (2)')
})

test("the pair's Claude row and reason wrap in full beside the fixed glyph; the rows from the title down and the draft block stay as they were", async ($, on) => {
  const seen = world(on, { now: DETAIL_NOW })
  seen.panes = [SHOWN]
  const action = `approve and merge, then ${prose(300)}`
  const why = `Because ${prose(300)}`
  const item = { ...PAIR.items[0], action, why }
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: PRA, items: [item] })
  const ui = await mount($, 39)
  const claude = await ui.find({ type: 'Box', key: 'row-claude' })
  expect(claude.children[0].children[0].props).toMatchObject({ color: 'claude' })
  expect(claude.children[0].props.flexShrink).toBe(0)
  const ask = claude.children[1].children[0]
  expect(ask.props).toMatchObject({ bold: true, wrap: 'wrap' })
  expect(textOf(ask)).toBe(`Claude 9/10: ${action}`)
  const reason = await ui.find({ type: 'Text', text: /^Because / })
  expect(reason.props).toMatchObject({ color: 'inactive', wrap: 'wrap' })
  expect(textOf(reason)).toBe(why)
  const root = (await ui.drawn()) as any
  const keys = root.children.map((child: any) => child.props?.key)
  // I5: the decision facts row sits under the title. The dock is tall: a gap row sits before Claude's row and the item
  // (a lone item has no batch row, the ledger and the counts being empty).
  expect(keys.slice(0, 7)).toEqual(['tabs', 'gap-claude', 'row-claude', 'gap-item', 'title', 'row-facts', undefined])
  const draft = await ui.find({ type: 'Box', key: 'draft' })
  expect(draft.props).toMatchObject({ borderStyle: 'quote', borderColor: 'suggestion' })
  expect(textOf(draft)).toBe(PAIR.items[0]?.draft)
  await detailed(ui)
  for (const key of ['title', 'row-head', 'row-ci']) {
    const row = await ui.find({ type: 'Box', key })
    expect(row.children[1].children[0].props.wrap, key).toBe('truncate-end')
  }
})

test('hostile bodies draw wrapped and marked, no control character reaches a row, and the pass is linear in the text', async ($, on) => {
  const seen = await queued($, on)
  const megabyte = `${'word '.repeat(140_000)}\n${'\u{202E}'.repeat(50_000)}\n${'x\u{0}'.repeat(100_000)}\n${'日'.repeat(100_000)}`
  expect(megabyte.length).toBeGreaterThan(1_000_000)
  withPr(seen, pr => {
    pr.body = `bidi \u{202E}evil\u{202C} and \u{1B}[31mred\u{1B}[0m\n${megabyte}`
    pr.comments.nodes.push({ author: { login: 'flood', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: megabyte })
  })
  const ui = await mount($, 39, 2_000)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const column = await columnOf(ui)
  const drawn = JSON.stringify(await ui.drawn())
  expect(CONTROLS.test(column.join('\n'))).toBe(false)
  // The two tokens make the line 40 columns wide, one over the dock, so its last word wraps.
  expect(column.slice(7, 9)).toEqual(['bidi {U+202E}evil{U+202C} and', '[31mred[0m'])
  expect(drawn).toContain('{U+202E}')
  const latest = column.indexOf('Latest')
  for (const text of column.slice(7, latest)) expect(widthOf(text), text).toBeLessThanOrEqual(39)
  // The description's cap holds: its rows are those of 40,000 code points at most, and one note.
  expect(latest - 7).toBeLessThan(40_000 / 39 + 1_000)
  expect(column[latest - 1]).toMatch(/^\([0-9]+ more lines?\)$/)
  const head = column.indexOf('○ @flood comment 5m')
  expect(head).toBeGreaterThan(latest)
  expect(column[head + 1]).toMatch(/^  word word/)
  // Time per character holds as the text doubles, for prose, one word, hidden runs, wide characters and marks.
  const time = (text: string) => {
    const start = performance.now()
    wrap(text, 37)
    return performance.now() - start
  }
  const shapes: [string, (n: number) => string][] = [
    ['prose', n => 'word '.repeat(n / 5)],
    ['one word', n => 'x'.repeat(n)],
    ['hidden runs', n => 'a\u{202E}'.repeat(n / 2)],
    ['one hidden run', n => `a${'\u{200B}'.repeat(n)}b`],
    ['wide', n => '日'.repeat(n)],
    ['marks', n => 'e\u{301}'.repeat(n / 2)],
    ['spaces', n => ' '.repeat(n)],
  ]
  for (const [name, shape] of shapes) {
    const small = Math.max(2, time(shape(4_096)))
    const large = time(shape(262_144))
    expect(large, name).toBeLessThan(small * 64 * 4)
  }
})

test('the window maths holds at 39, 104 and 130 columns: one element a row, a page the rows under the head, the offset clamped', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.body = `${prose(1_000)}\n\n${'日本語の長い行 '.repeat(20)}\n\n${pr.body}`
  })
  const totals: Record<number, number> = {}
  for (const columns of [39, 104, 130]) {
    const bodyRows = columns < 80 ? 34 : 11
    // The head's rows, I1's attention line among them (keys, legend key, attention, title, facts, byline in the dock).
    const fixed = columns < 80 ? 6 : 4
    const room = bodyRows - fixed
    // The whole body at this width, from a pane tall enough to hold it: every row within the columns.
    const tall = await mount($, columns, 5_000)
    await openGroup(tall, 'group-author')
    await tall.press({ key: 'pull-3995' })
    const whole = (await columnOf(tall)).slice(fixed)
    expect(whole.length).toBeGreaterThan(room + 2)
    for (const text of whole) expect(widthOf(text), `${columns}: ${text}`).toBeLessThanOrEqual(columns)
    totals[columns] = whole.length
    await tall.press({ key: 'detail-back' })
    await tall.unmount()
    // The window: room rows of the body under the head, one step one row, a page the room, the end clamped.
    const ui = await mount($, columns)
    await openGroup(ui, 'group-author')
    await ui.press({ key: 'pull-3995' })
    let column = await columnOf(ui)
    expect(column, `${columns}`).toHaveLength(bodyRows)
    const head = column.slice(0, fixed)
    expect(column.slice(fixed)).toEqual(whole.slice(0, room))
    await scroll($, 1, bodyRows)
    column = await columnOf(ui)
    expect(column.slice(0, fixed)).toEqual(head)
    expect(column.slice(fixed)).toEqual(whole.slice(1, room + 1))
    await scroll($, bodyRows, bodyRows)
    expect((await columnOf(ui)).slice(fixed)).toEqual(whole.slice(1 + room, 1 + 2 * room))
    await scroll($, 1_000_000, bodyRows)
    column = await columnOf(ui)
    expect(column).toHaveLength(bodyRows)
    expect(column.slice(fixed)).toEqual(whole.slice(-room))
    expect(column.at(-1)).toMatch(/webhook_new_mr_retry\.py \+155 −0$/)
    await scroll($, -1_000_000, bodyRows)
    expect((await columnOf(ui)).slice(fixed)).toEqual(whole.slice(0, room))
    await ui.press({ key: 'detail-back' })
    await ui.unmount()
  }
  expect(totals[39]).toBeGreaterThan(totals[104] ?? 0)
  expect(totals[104]).toBeGreaterThanOrEqual(totals[130] ?? 0)
  // Scrolled to the end at 104 columns, the same detail drawn at 130 (fewer rows) clamps the offset to its new max.
  const strip = await mount($, 104)
  await openGroup(strip, 'group-author')
  await strip.press({ key: 'pull-3995' })
  await scroll($, 1_000_000, 11)
  expect((await columnOf(strip)).at(-1)).toMatch(/\+155 −0$/)
  await strip.unmount()
  const wide = await mount($, 130)
  const column = await columnOf(wide)
  expect(column).toHaveLength(11)
  expect(column.at(-1)).toMatch(/\+155 −0$/)
  expect(column[4]).not.toBe('Description')
})

// The review's findings on the full text, each pinned by a case that failed before its fix.
test('wrap: a row holding only its indentation is dropped when the word after it does not fit beside it (F2)', () => {
  expect(wrap('      abc', 8)).toEqual(['abc'])
  expect(wrap('      abc', 9)).toEqual(['      abc'])
  expect(wrap('      https://github.com/The-PR-Agent/pr-agent/pull/3995', 39)).toEqual(['https://github.com/The-PR-Agent/pr-agen', 't/pull/3995'])
  expect(wrap(`${' '.repeat(10)}${'x'.repeat(30)}`, 37)).toEqual(['x'.repeat(30)])
  // A nested list item: the marker fits beside the indentation, the long word after it starts its own row.
  expect(wrap('    - https://github.com/The-PR-Agent/pr-agent/pull/3995', 39)).toEqual(['    -', 'https://github.com/The-PR-Agent/pr-agen', 't/pull/3995'])
  // Unchanged: indentation that fits is kept, a line of spaces is one row, the empty line one empty row.
  expect(wrap('  ab cd', 4)).toEqual(['  ab', 'cd'])
  expect(wrap('   ', 10)).toEqual(['   '])
  expect(wrap(' '.repeat(5), 3)).toEqual([''])
  expect(wrap('', 10)).toEqual([''])
})

test('columnsOf: every point Unicode 16 or the engine draws wide counts 2, so a row of them never overflows (F4)', () => {
  // The trigrams, the hexagrams, the enclosed ideographic supplement, the emoji skin-tone modifiers and the Khitan,
  // Tangut and Kana supplements the first list left out.
  for (const char of ['☰', '\u{2637}', '\u{268A}', '\u{268F}', '\u{4DC0}', '\u{4DFF}', '\u{16FF0}', '\u{16FF6}', '\u{18B00}', '\u{18DF2}', '\u{1AFF0}', '\u{1AFFE}', '\u{1D300}', '\u{1D356}', '\u{1D360}', '\u{1D376}', '\u{1F260}', '\u{1F265}', '🏽', '\u{1F3FB}', '\u{1F3FF}']) {
    expect(columnsOf(char), `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`).toBe(2)
  }
  expect(widthOf('☰'.repeat(20))).toBe(40)
  expect(wrap('☰'.repeat(20), 39)).toEqual(['☰'.repeat(19), '☰'])
  expect(wrap('👍🏽👍🏽', 2)).toEqual(['👍', '🏽', '👍', '🏽'].map(text => text))
  expect(columnsOf('a')).toBe(1)
})

test('a tab is stored as four spaces, so a tab-indented fence draws whole with no ellipsis at 39 columns (REV-2, F1)', async ($, on) => {
  const fence = '```go\n\tif err != nil {\n\t\treturn err\n\t}\n```\ncol1\tcol2\tcol3 end'
  const stored = ['```go', '    if err != nil {', '        return err', '    }', '```', 'col1    col2    col3 end']
  const pure = clone(PR_3995)
  pure.data.repository.pullRequest.body = fence
  pure.data.repository.pullRequest.comments.nodes.push({ author: { login: 'gopher', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: fence })
  const read = detailOf(pure, 'pr', 3995, DETAIL_NOW) as any
  expect(read.description.value.lines).toEqual(stored)
  const said = read.latest.value.find((entry: any) => entry.who === '@gopher')
  expect(said.body.lines).toEqual(stored)
  for (const text of [...read.description.value.lines, ...read.latest.value.flatMap((entry: any) => entry.body.lines)]) expect(text).not.toContain('\t')
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.body = fence
    pr.comments.nodes.push({ author: { login: 'gopher', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: fence })
  })
  const ui = await mount($, 39, 2_000)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const column = await columnOf(ui)
  const start = column.indexOf('Description')
  expect(column.slice(start + 1, start + 1 + stored.length)).toEqual(stored)
  const head = column.indexOf('○ @gopher comment 5m')
  expect(wordsUnder(column, head)).toEqual(stored)
  for (const text of [...column.slice(start + 1, start + 1 + stored.length), ...wordsUnder(column, head)]) {
    expect(text).not.toContain('\t')
    expect(text).not.toContain('…')
    expect(widthOf(text)).toBeLessThanOrEqual(39)
  }
})

test('the detail tree is one row taller than the pane, so the engine raises an arrow key; the queue stays the pane\'s height (REV-1)', async ($, on) => {
  await queued($, on)
  for (const [columns, rows] of [[39, 34], [104, 11]] as const) {
    const ui = await mount($, columns)
    expect(((await ui.drawn()) as any).props.minHeight, `queue at ${columns}`).toBe(rows)
    await openGroup(ui, 'group-author')
    await ui.press({ key: 'pull-3995' })
    expect(((await ui.drawn()) as any).props.minHeight, `detail at ${columns}`).toBe(rows + 1)
    // The drawing still holds the pane's rows: the spare row is the engine's reason to raise, never a drawn row.
    expect(await columnOf(ui)).toHaveLength(rows)
    await ui.press({ key: 'detail-back' })
    expect(((await ui.drawn()) as any).props.minHeight, `back at ${columns}`).toBe(rows)
    await ui.unmount()
  }
})

test('page keys summed in flight move that many pages of the rows under the head; End and Home move their rows (REV-3)', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.body = `${prose(1_000)}\n\n${pr.body}`
  })
  const [bodyRows, fixed] = [11, 4]
  const room = bodyRows - fixed
  const tall = await mount($, 104, 5_000)
  await openGroup(tall, 'group-author')
  await tall.press({ key: 'pull-3995' })
  const whole = (await columnOf(tall)).slice(fixed)
  expect(whole.length).toBeGreaterThan(6 * room)
  await tall.press({ key: 'detail-back' })
  await tall.unmount()
  const ui = await mount($, 104)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const under = async () => (await columnOf(ui)).slice(fixed)
  await scroll($, 2 * bodyRows, bodyRows)
  expect(await under()).toEqual(whole.slice(2 * room, 3 * room))
  await scroll($, 3 * bodyRows, bodyRows)
  expect(await under()).toEqual(whole.slice(5 * room, 6 * room))
  await scroll($, -2 * bodyRows, bodyRows)
  expect(await under()).toEqual(whole.slice(3 * room, 4 * room))
  // One page as before, and a step of one row.
  await scroll($, bodyRows, bodyRows)
  expect(await under()).toEqual(whole.slice(4 * room, 5 * room))
  await scroll($, -1, bodyRows)
  expect(await under()).toEqual(whole.slice(4 * room - 1, 5 * room - 1))
  // End and Home send the tree's rows, one more than the pane's (REV-1) and no multiple of bodyRows: a plain move.
  await scroll($, bodyRows + 1, bodyRows)
  expect(await under()).toEqual(whole.slice(4 * room + bodyRows, 5 * room + bodyRows))
  await scroll($, -10 * bodyRows, bodyRows)
  expect(await under()).toEqual(whole.slice(0, room))
})

test('the offset stored at a narrower pane is clamped before a step, so the first up press after a wider redraw moves a row (F3)', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.body = `${prose(1_000)}\n\n${pr.body}`
  })
  const dock = await mount($, 39)
  await openGroup(dock, 'group-author')
  await dock.press({ key: 'pull-3995' })
  await scroll($, 1_000_000, 34)
  expect((await columnOf(dock)).at(-1)).toMatch(/\+155 −0$/)
  await dock.unmount()
  const wide = await mount($, 130)
  const before = await columnOf(wide)
  expect(before).toHaveLength(11)
  expect(before.at(-1)).toMatch(/\+155 −0$/)
  await scroll($, -1, 11)
  const after = await columnOf(wide)
  expect(after.slice(0, 4)).toEqual(before.slice(0, 4))
  expect(after.slice(4)).not.toEqual(before.slice(4))
  expect(after.slice(5)).toEqual(before.slice(4, -1))
  // And back down one row to the end.
  await scroll($, 1, 11)
  expect(await columnOf(wide)).toEqual(before)
})

test('each wrapped body row keeps truncate-end as its guard, so a row the engine measures wider is cut rather than wrapped again (V5)', async ($, on) => {
  const seen = await queued($, on)
  withPr(seen, pr => {
    pr.comments.nodes.push({ author: { login: 'longwinded', __typename: 'User' }, createdAt: '2026-10-11T17:50:00Z', body: prose(300) })
  })
  const ui = await mount($, 104, 2_000)
  await openGroup(ui, 'group-author')
  await ui.press({ key: 'pull-3995' })
  const column = await columnOf(ui)
  const first = column[column.indexOf('Description') + 1] ?? ''
  const under = column[column.indexOf('○ @longwinded comment 5m') + 1] ?? ''
  expect(first).not.toBe('')
  expect(under.startsWith('  ')).toBe(true)
  for (const text of [first, under]) expect((await ui.find({ type: 'Text', text }))?.props.wrap, text).toBe('truncate-end')
  await ui.unmount()
})
