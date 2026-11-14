import { expect, test } from 'claude-code/testing'

import { LETTERS, PAIR_LETTERS, PAIR_RESERVED } from '../hooks/views'
import { canonicalText, textHashOf } from '../hooks/text'
import { lint } from './lint'
import { PAIR, PRA, SHOWN, SURFACES, TOOL, clone, detailed, ghCalls, mountPane, paneProps, textOf, world } from './world'
import type { World } from './world'

// I5: the decision ledger and the show contract. Each item may carry a verb (one of six fixed words) and sensitive; the
// tool hashes its draft and inline comments once (text.ts canonicalText) and answers with the hash and head in fixed
// words; the pair view draws a facts row under the title and a ledger row of the other items; the ledger, per session,
// marks each item seen, changed since you looked, held or written, and outlives every show.

// The expected hashes were worked out outside the mod, with shasum over the canonical JSON written by hand:
//   printf '%s' '["Thanks @PeterDaveHello, approving and merging.",[]]' | shasum -a 256
//   printf '%s' '["Thanks, one ask below.",[["pr_agent/git_providers/gitlab_provider.py",979,"Could this reuse `_as_line`?"]]]'
//   printf '%s' '["",[["src/a.ts",3,"Use the helper."]]]' (an inline comment and no draft)
//   printf '%s' '["Hä? 🚀 ok",[]]' (UTF-8, a two-byte and a four-byte character)
// The whole digest is kept and compared; the pane and the tool result show its first 6.
const FULL_4045 = '0d50dfea2c2f3b5e1c55d87b8536fca525424ed9907f9c3de0054784c1e965b5'
const FULL_2450 = 'd1d10be2fcdc1e093ee41effa0029f89a57ee37da80380160800e81d8e3db4bc'
const FULL_INLINE = 'f1502e44749d396e30f57b8b2aa6770a49ccd3ae8644e23bfc35c09f64b62a26'
const FULL_UTF8 = 'f48433b817949d54ca44e5cb59e8e8f37cc20a331b491017509d385dc73af642'
const HASH_4045 = FULL_4045.slice(0, 6)
const HASH_2450 = FULL_2450.slice(0, 6)
const HASH_INLINE = FULL_INLINE.slice(0, 6)
const FOCUSED = { ...SHOWN, isFocused: true }
const ITEM_4045 = PAIR.items[0]!
const ITEM_2450 = PAIR.items[1]!
const ISSUE_3887 = { number: 3887, kind: 'issue', action: 'reply' }

type Drawn = { type?: string; props?: Record<string, unknown>; children?: Drawn[] }

// The facts row as its glyph and words, the hold key apart. Review F2: each fact is its own unit, its ' ·' inside it.
async function factsOf(ui: any): Promise<string | undefined> {
  const row = (await ui.find({ type: 'Box', key: 'row-facts' })) as Drawn | undefined
  if (row === undefined) return undefined
  return `${textOf(row.children?.[0])} ${(row.children?.[1]?.children ?? []).map(textOf).join(' ')}`
}

// The ledger row's entries, each its glyph and words.
async function ledgerOf(ui: any): Promise<string[]> {
  const row = (await ui.find({ type: 'Box', key: 'ledger' })) as Drawn | undefined
  return (row?.children ?? []).map(entry => `${textOf(entry.children?.[0])} ${textOf(entry.children?.[1])}`)
}

// The kit holds one Pane per surface: the last glance is unmounted before the next mount.
let held: any
async function release() {
  const ui = held
  held = undefined
  try {
    await ui?.unmount()
  } catch {
    // Unmounted by the test already.
  }
}

// A focused pane's drawing marks the shown tab seen after it returns; the write lands on the next tick.
async function look($: any, seen: World, columns = 39, tab = 0, scroll?: { offset: number; bodyRows: number }) {
  await release()
  const props = scroll === undefined ? paneProps(columns, true) : { ...paneProps(columns, true), scroll }
  const ui = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props })
  await ui.press({ key: `tab-${tab}` })
  await ui.drawn()
  await seen.clock.settle()
  await ui.unmount()
}

// What the pane says of the shown pair without focus, which marks nothing.
async function glance($: any, seen: World, columns = 39, tab = 0): Promise<{ facts: string | undefined; ledger: string[]; ui: any }> {
  await release()
  const ui = await mountPane($, 'terminal', columns, false)
  held = ui
  await ui.press({ key: `tab-${tab}` })
  await seen.clock.settle()
  return { facts: await factsOf(ui), ledger: await ledgerOf(ui), ui }
}

const show = ($: any, id: string, input: object) => $.tool.call({ tool: TOOL, tool_use_id: id, ...input })
const longDraft = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long review.`).join('\n')

test('I5: verb and sensitive are accepted, drawn on the facts row, and refused whole when off', async ($, on) => {
  const seen = world(on)
  const ok = await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, verb: 'approve-merge', sensitive: true }, { ...ITEM_2450, verb: 'request-changes', sensitive: false }] })
  expect(String(ok.result)).toContain('Shown in the review-pair pane.')
  const { ui } = await glance($, seen, 104)
  expect(await factsOf(ui)).toBe(`○ not seen · approve and merge · text ${HASH_4045} · head 35a07eb · sensitive`)
  await ui.press({ key: 'tab-1' })
  expect(await factsOf(ui)).toBe(`○ not seen · request changes · text ${HASH_2450} · head 1234567`)
  await ui.unmount()
  const before = seen.calls.length
  const refusals: [object, string][] = [
    [{ verb: 'merge' }, '#4045 verb must be pending, comment, approve, approve-merge, request-changes or close.'],
    [{ verb: 'APPROVE' }, '#4045 verb must be pending, comment, approve, approve-merge, request-changes or close.'],
    [{ verb: 3 }, '#4045 verb must be pending, comment, approve, approve-merge, request-changes or close.'],
    [{ sensitive: 'yes' }, '#4045 sensitive must be true or false.'],
    [{ sensitive: 1 }, '#4045 sensitive must be true or false.'],
  ]
  for (const [extra, reason] of refusals) {
    const answer = await show($, 'bad', { repo: PRA, items: [{ ...ITEM_4045, ...extra }, ITEM_2450] })
    expect(answer.deny).toBe(`Not shown: ${reason}`)
  }
  expect(seen.calls.length).toBe(before)
  // Every verb draws as its fixed words; an item with neither field draws as before, with its hash facts.
  for (const [verb, words] of [['pending', 'pending'], ['comment', 'comment'], ['approve', 'approve'], ['close', 'close']]) {
    await show($, `v-${verb}`, { repo: PRA, items: [{ ...ITEM_4045, verb }] })
    const { ui: one } = await glance($, seen, 130)
    expect(await factsOf(one)).toBe(`○ not seen · ${words} · text ${HASH_4045} · head 35a07eb`)
    await one.unmount()
  }
  await show($, 'plain', { repo: PRA, items: [ITEM_4045] })
  const { facts, ui: plain } = await glance($, seen)
  expect(facts).toBe(`○ not seen · text ${HASH_4045} · head 35a07eb`)
  await plain.unmount()
})

test('I5: the text hash is the whole SHA-256 of the canonical JSON, as shasum works it out', async () => {
  expect(canonicalText(ITEM_2450.draft, ITEM_2450.inline)).toBe('["Thanks, one ask below.",[["pr_agent/git_providers/gitlab_provider.py",979,"Could this reuse `_as_line`?"]]]')
  expect(await textHashOf(canonicalText(ITEM_2450.draft, ITEM_2450.inline) ?? '')).toBe(FULL_2450)
  expect(await textHashOf(canonicalText(ITEM_4045.draft) ?? '')).toBe(FULL_4045)
  expect(canonicalText(undefined, [{ path: 'src/a.ts', line: 3, body: 'Use the helper.' }])).toBe('["",[["src/a.ts",3,"Use the helper."]]]')
  expect(await textHashOf('["",[["src/a.ts",3,"Use the helper."]]]')).toBe(FULL_INLINE)
  expect(await textHashOf('["Hä? 🚀 ok",[]]')).toBe(FULL_UTF8)
  expect(canonicalText(undefined, [])).toBeUndefined()
  expect(canonicalText(undefined)).toBeUndefined()
})

test('I5: the tool result ends with one clause per item, hash and head in fixed words, for one item and for four', async ($, on) => {
  world(on)
  const one = String((await show($, 'c1', { repo: PRA, items: [ITEM_4045] })).result)
  expect(one.endsWith(`#4045 text ${HASH_4045} head 35a07eb.`)).toBe(true)
  const items = [
    { ...ITEM_4045, verb: 'approve-merge' },
    { ...ITEM_2450, verb: 'comment' },
    ISSUE_3887,
    { number: 4042, action: 'COMMENT', inline: [{ path: 'src/a.ts', line: 3, body: 'Use the helper.' }] },
  ]
  const four = String((await show($, 'c2', { repo: PRA, items })).result)
  expect(four.startsWith('Shown in the review-pair pane.')).toBe(true)
  expect(four.endsWith(`#4045 text ${HASH_4045} head 35a07eb. #2450 text ${HASH_2450} head 1234567. #3887 no text head unknown. #4042 text ${HASH_INLINE} head unknown.`)).toBe(true)
  // The clauses follow the alerts and carry neither the action nor the verb nor any GitHub text.
  expect(four.indexOf('#2450 head moved')).toBeLessThan(four.indexOf(`#4045 text ${HASH_4045}`))
  expect(four).not.toMatch(/approve|comment|COMMENT|reply|helper|src\/a\.ts|Thanks/)
  // A whole 40-hex head is cut to 7.
  const full = String((await show($, 'c3', { repo: PRA, items: [{ ...ITEM_4045, head: '35a07ebb5e36e780792b0f6bdc04810882ae7d9d' }] })).result)
  expect(full.endsWith(`#4045 text ${HASH_4045} head 35a07eb.`)).toBe(true)
})

test('I5: no draft and no inline comment, no hash: the facts row and the result say so in their own words', async ($, on) => {
  const seen = world(on)
  const answer = String((await show($, 'c1', { repo: PRA, items: [{ number: 4045, action: 'look', head: '35a07eb' }, ISSUE_3887] })).result)
  expect(answer).toContain('#4045 no text head 35a07eb.')
  expect(answer).toContain('#3887 no text head unknown.')
  const { facts, ui } = await glance($, seen)
  expect(facts).toBe('○ not seen · head 35a07eb')
  expect(await ui.find({ type: 'Box', key: 'draft-end' })).toBeUndefined()
  await ui.press({ key: 'tab-1' })
  expect(await factsOf(ui)).toBe('○ not seen')
  await ui.unmount()
})

test('I5: the facts row draws under the title in the dock, the strip and wide, wrapping in the dock, on both surfaces', async ($, on) => {
  world(on)
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, verb: 'approve-merge', sensitive: true }, ITEM_2450, ISSUE_3887] })
  for (const surface of SURFACES) {
    for (const columns of [39, 57, 104, 119, 130, 160]) {
      const ui = await mountPane($, surface, columns, false)
      const root = (await ui.drawn()) as Drawn
      const keys = (root.children ?? []).map(child => child.props?.key)
      // Below 80 columns the pane is tall (34 rows): the batch row follows the tabs, with spacers before Claude's row and
      // the title. From 80 columns it is the 11-row strip: no batch row, no spacers.
      const isTall = columns < 80
      expect(keys.slice(0, isTall ? 7 : 4), `${surface} ${columns}`).toEqual(
        isTall ? ['tabs', 'batch', 'gap-claude', 'row-claude', 'gap-item', 'title', 'row-facts'] : ['tabs', 'row-claude', 'title', 'row-facts'],
      )
      const row = root.children?.[isTall ? 6 : 3] as Drawn
      expect(row.props).toMatchObject({ flexDirection: 'row', columnGap: 1 })
      expect(row.children?.[0]?.props?.flexShrink).toBe(0)
      expect(row.children?.[0]?.children?.[0]?.props?.color).toBe('inactive')
      // The words wrap within the room the glyph and h leave, so no layout cuts or overflows them. Review F2: one unit a
      // fact, so a line breaks between facts, never inside one.
      expect(row.children?.[1]?.props).toMatchObject({ flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
      expect(row.children?.[1]?.children?.[0]?.children?.[0]?.props).toMatchObject({ color: 'inactive', wrap: 'wrap' })
      expect(row.children?.[2]?.props?.flexShrink).toBe(0)
      expect((await ui.find({ type: 'Button', key: 'hold' }))?.props).toMatchObject({ label: 'hold', hotkey: 'h', plain: true })
      expect((await ui.find({ type: 'Button', key: 'hold' }))?.props.autoFocus).toBeUndefined()
      expect(lint(await ui.drawn()), `${surface} ${columns}`).toEqual([])
      // Claude's line, the title's pill row, the draft and its inline comments stay as they were.
      expect(await ui.find({ type: 'Text', text: 'Claude 9/10: approve and merge' })).toBeDefined()
      expect(textOf(await ui.find({ type: 'Box', key: 'draft' }))).toBe(ITEM_4045.draft)
      await ui.unmount()
    }
  }
})

test('I5: the ledger row names the next item in the dock, every other item on the strip, and wide the repo\'s recent others too', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  // Two earlier shows of the same repo, one of them looked at, and one of another repo's, which is never named.
  await show($, 'e1', { repo: PRA, items: [{ number: 3909, action: 'review' }, { number: 3995, action: 'review' }] })
  await look($, seen, 39, 1)
  await show($, 'e2', { repo: PRA, items: [{ number: 4002, action: 'review' }, { number: 4026, action: 'review' }] })
  await show($, 'e3', { repo: 'IsmaelMartinez/teams-for-linux', items: [{ number: 2998, action: 'review' }] })
  await show($, 'c1', { repo: PRA, items: [ITEM_4045, ITEM_2450, ISSUE_3887] })
  const dock = await glance($, seen, 39)
  expect(dock.ledger).toEqual(['○ #2450 not opened'])
  await dock.ui.press({ key: 'tab-2' })
  expect(await ledgerOf(dock.ui)).toEqual(['○ #4045 not opened'])
  expect(lint(await dock.ui.drawn())).toEqual([])
  await dock.ui.unmount()
  const strip = await glance($, seen, 104)
  expect(strip.ledger).toEqual(['○ #2450 not opened', '○ #3887 not opened'])
  await strip.ui.unmount()
  const wide = await glance($, seen, 130)
  expect(wide.ledger).toEqual(['○ #2450 not opened', '○ #3887 not opened', '○ #4026 not opened', '○ #4002 not opened', '◆ #3995 seen'])
  expect(lint(await wide.ui.drawn())).toEqual([])
  await wide.ui.unmount()
  // One item alone: no ledger row in the dock or on the strip.
  await show($, 'c2', { repo: PRA, items: [ITEM_4045] })
  for (const columns of [39, 104]) {
    const one = await glance($, seen, columns)
    expect(one.ledger).toEqual([])
    expect(await one.ui.find({ type: 'Box', key: 'ledger' })).toBeUndefined()
    await one.ui.unmount()
  }
})

test('I5: the ledger outlives a show that replaces the pair and the empty show that clears it; only the cards go', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await look($, seen)
  expect((await glance($, seen)).facts).toBe(`◆ seen · text ${HASH_4045} · head 35a07eb`)
  await show($, 'c2', { repo: PRA, items: [ISSUE_3887] })
  const wide = await glance($, seen, 130)
  // Most recently touched first: #4045 moved last when it was seen.
  expect(wide.ledger).toEqual(['◆ #4045 seen', '○ #2450 not opened'])
  await wide.ui.unmount()
  expect((await show($, 'c3', { repo: PRA, items: [] })).result).toBe('Pair cleared; the pane shows the queue.')
  const reads = ghCalls(seen).length
  await show($, 'c4', PAIR)
  // The cards were read again (dropped with the pair), the ledger was not.
  expect(ghCalls(seen).length).toBe(reads + 2)
  const back = await glance($, seen)
  expect(back.facts).toBe(`◆ seen · text ${HASH_4045} · head 35a07eb`)
  expect(back.ledger).toEqual(['○ #2450 not opened'])
  await back.ui.unmount()
})

test('I5: the ledger keeps the 40 most recently touched entries', async ($, on) => {
  const seen = world(on)
  await show($, 'c1', { repo: PRA, items: [ITEM_4045] })
  await look($, seen)
  const others = (count: number, from: number) => Array.from({ length: count }, (_, i) => ({ number: from + i, action: 'review' }))
  // 39 others: 40 entries, the first still held.
  for (let start = 0; start < 39; start += 4) await show($, `o-${start}`, { repo: PRA, items: others(Math.min(4, 39 - start), 5000 + start) })
  await show($, 'c2', { repo: PRA, items: [ITEM_4045] })
  const kept = await glance($, seen)
  expect(kept.facts).toBe(`◆ seen · text ${HASH_4045} · head 35a07eb`)
  await kept.ui.unmount()
  // The re-show touched it last; 40 more push it out, and its next show starts a new entry.
  for (let start = 0; start < 40; start += 4) await show($, `p-${start}`, { repo: PRA, items: others(4, 6000 + start) })
  await show($, 'c3', { repo: PRA, items: [ITEM_4045] })
  const gone = await glance($, seen)
  expect(gone.facts).toBe(`○ not seen · text ${HASH_4045} · head 35a07eb`)
  await gone.ui.unmount()
  // Wide, the repo's three most recent others are the last three shown.
  const wide = await glance($, seen, 130)
  expect(wide.ledger).toEqual(['○ #6039 not opened', '○ #6038 not opened', '○ #6037 not opened'])
  await wide.ui.unmount()
})

test('I5: seen needs the focused pane and the draft\'s end in its window: a long draft not scrolled is not seen, scrolled to draft-end it is', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, draft: longDraft }, ITEM_2450] })
  // An unfocused pane marks nothing, whatever it shows.
  const idle = await glance($, seen, 39)
  expect(idle.facts).toMatch(/^○ not seen · text [0-9a-f]{6} · head 35a07eb$/)
  await idle.ui.unmount()
  // Focused, at the top of the window: the draft's end is 60 lines down, out of the dock's 34 rows.
  await look($, seen, 39)
  expect((await glance($, seen)).facts).toMatch(/^○ not seen /)
  // Focused and scrolled so the window reaches draft-end: seen. draft-end is a keyed Box, the view's last element.
  await release()
  const plain = await mountPane($, 'terminal', 39)
  const root = (await plain.drawn()) as Drawn
  expect(root.children?.at(-1)?.type).toBe('Box')
  expect(root.children?.at(-1)?.props?.key).toBe('draft-end')
  await plain.unmount()
  await look($, seen, 39, 0, { offset: 60, bodyRows: 34 })
  expect((await glance($, seen)).facts).toMatch(/^◆ seen /)
  // The second item's short draft fits the dock's window: shown focused, it is seen at once.
  expect((await glance($, seen, 39, 1)).facts).toMatch(/^○ not seen /)
  await look($, seen, 39, 1)
  expect((await glance($, seen, 39, 1)).facts).toMatch(/^◆ seen /)
})

test('I5: the person scrolling the focused pair to the tree\'s end marks it seen; unfocused, or short of the end, it does not', async ($, on) => {
  // The engine beneath moves the window; the kit has none.
  on('ui.scroll', async () => ({}))
  const seen = world(on)
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, draft: longDraft }] })
  const scroll = (offset: number, contentRows: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset, by: 11, bodyRows: 11, contentRows, origin: { kind: 'person' } } as any)
  seen.panes = [SHOWN]
  await scroll(80, 91)
  await seen.clock.settle()
  expect((await glance($, seen, 104)).facts).toMatch(/^○ not seen /)
  seen.panes = [FOCUSED]
  await scroll(40, 91)
  await seen.clock.settle()
  expect((await glance($, seen, 104)).facts).toMatch(/^○ not seen /)
  await scroll(80, 91)
  await seen.clock.settle()
  expect((await glance($, seen, 104)).facts).toMatch(/^◆ seen /)
})

test('I5: an item with no draft is seen once its tab is shown in the focused pane', async ($, on) => {
  const seen = world(on)
  await show($, 'c1', { repo: PRA, items: [ISSUE_3887, { number: 4045, action: 'look' }] })
  await look($, seen, 104)
  expect((await glance($, seen, 104)).facts).toBe('◆ seen')
  expect((await glance($, seen, 104, 1)).facts).toBe('○ not seen')
})

test('I5: a re-show with another hash or head marks a seen item changed and clears seen; the same text and head keep it', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await look($, seen)
  await show($, 'c2', PAIR)
  expect((await glance($, seen)).facts).toBe(`◆ seen · text ${HASH_4045} · head 35a07eb`)
  // Another draft: changed since you looked, with the new hash.
  await show($, 'c3', { ...PAIR, items: [{ ...ITEM_4045, draft: 'Thanks, approving.' }, ITEM_2450] })
  const edited = await glance($, seen)
  expect(edited.facts).toMatch(/^◇ changed since you looked · text [0-9a-f]{6} · head 35a07eb$/)
  expect(edited.facts).not.toContain(HASH_4045)
  // The amber glyph is the ledger's one colour; the row lints.
  const glyph = (await edited.ui.find({ type: 'Box', key: 'row-facts' })) as Drawn
  expect(glyph.children?.[0]?.children?.[0]?.props?.color).toBe('warning')
  expect(lint(await edited.ui.drawn())).toEqual([])
  await edited.ui.unmount()
  // Seen again, the mark clears; then another head marks it changed again.
  await look($, seen)
  expect((await glance($, seen)).facts).toMatch(/^◆ seen /)
  await show($, 'c4', { ...PAIR, items: [{ ...ITEM_4045, draft: 'Thanks, approving.', head: 'abcdef1' }, ITEM_2450] })
  expect((await glance($, seen)).facts).toBe(`◇ changed since you looked · text ${(await textHashOf(canonicalText('Thanks, approving.') ?? '')).slice(0, 6)} · head abcdef1`)
  // An item never seen is never changed: #2450 stays not opened through both re-shows.
  expect((await glance($, seen)).ledger).toEqual(['○ #2450 not opened'])
})

test('I5: a card read whose live head differs from the one the viewer looked at marks the item changed', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await look($, seen)
  // #2450's given head is already behind GitHub's (HEAD MOVED): seen against the live head, a refresh leaves it seen.
  await look($, seen, 39, 1)
  const { ui } = await glance($, seen)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await factsOf(ui)).toMatch(/^◆ seen /)
  expect(await ledgerOf(ui)).toEqual(['◆ #2450 seen'])
  const answer = clone(seen.answers[`${PRA}#4045`])
  answer.data.repository.pullRequest.headRefOid = 'ffffffffffffffffffffffffffffffffffffffff'
  seen.answers[`${PRA}#4045`] = answer
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await factsOf(ui)).toMatch(/^◇ changed since you looked /)
  expect(await ledgerOf(ui)).toEqual(['◆ #2450 seen'])
  await ui.unmount()
  // Looked at again, it is seen under the new head, and the next read of the same head keeps it.
  await look($, seen)
  const again = await glance($, seen)
  await again.ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await factsOf(again.ui)).toMatch(/^◆ seen /)
  await again.ui.unmount()
})

test('I5: h toggles held on the shown tab\'s item, its label and the rows say so, and it does nothing else', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await release()
  const ui = await mountPane($, 'terminal', 104, false)
  const calls = seen.calls.length
  await ui.press({ key: 'hold' })
  await seen.clock.settle()
  expect(await factsOf(ui)).toBe(`‖ held · text ${HASH_4045} · head 35a07eb`)
  expect((await ui.find({ type: 'Button', key: 'hold' }))?.props).toMatchObject({ label: 'unhold', hotkey: 'h', plain: true })
  expect(lint(await ui.drawn())).toEqual([])
  await ui.press({ key: 'tab-1' })
  expect(await ledgerOf(ui)).toEqual(['‖ #4045 held'])
  expect((await ui.find({ type: 'Button', key: 'hold' }))?.props.label).toBe('hold')
  await ui.press({ key: 'tab-0' })
  await ui.press({ key: 'hold' })
  await seen.clock.settle()
  expect(await factsOf(ui)).toBe(`○ not seen · text ${HASH_4045} · head 35a07eb`)
  expect(seen.calls.length).toBe(calls)
  expect(seen.toolRuns).toEqual([])
  expect(seen.outward).toEqual([])
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('I5: a write of Claude\'s naming a shown item marks it written, and merged once a card read after it says merged', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: `gh pr review 2450 --comment --body-file /tmp/d.md --repo ${PRA}` })
  await seen.clock.settle()
  const { ui } = await glance($, seen)
  expect(await ledgerOf(ui)).toEqual(['✓ #2450 written'])
  await ui.press({ key: 'tab-1' })
  expect(await factsOf(ui)).toBe(`✓ written · text ${HASH_2450} · head 1234567`)
  const answer = clone(seen.answers[`${PRA}#4045`])
  answer.data.repository.pullRequest.state = 'MERGED'
  seen.answers[`${PRA}#4045`] = answer
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: `gh pr merge 4045 --squash --repo ${PRA}` })
  await seen.clock.settle()
  expect(await ledgerOf(ui)).toEqual(['✓ #4045 merged'])
  expect(lint(await ui.drawn())).toEqual([])
  await ui.unmount()
  // Hidden, the pane reads nothing, and the write is still marked.
  seen.panes = []
  await show($, 'c2', { repo: PRA, items: [ISSUE_3887, { number: 4042, action: 'review' }] })
  const reads = ghCalls(seen).length
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b3', command: `gh pr comment 4042 --body hi --repo ${PRA}` })
  await seen.clock.settle()
  expect(ghCalls(seen).length).toBe(reads)
  expect((await glance($, seen, 104)).ledger).toEqual(['✓ #4042 written'])
})

test('I5: the pair view\'s row letters skip h, m, d, y and s; h holds, s opens the status rows, nothing new takes the focus', async ($, on) => {
  expect(PAIR_RESERVED).toBe('hmdys')
  expect(PAIR_LETTERS).toBe('bcefgntuvwxz')
  expect(Array.from(PAIR_LETTERS).every(letter => LETTERS.includes(letter))).toBe(true)
  // The queue and issues views keep their sixteen.
  expect(LETTERS).toBe('bcdefghmnstuvwxz')
  const seen = world(on)
  const card = clone(seen.answers[`${PRA}#2450`])
  const pr = card.data.repository.pullRequest
  const issue = pr.closingIssuesReferences.nodes[0]
  for (const number of [2460, 2461, 2462, 2463]) issue.timelineItems.nodes.push({ source: { number, state: 'OPEN', repository: { nameWithOwner: PRA } } })
  issue.timelineItems.totalCount += 4
  pr.commits.nodes[0].commit.statusCheckRollup.state = 'FAILURE'
  pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].conclusion = 'FAILURE'
  seen.answers[`${PRA}#2450`] = card
  await show($, 'c1', { repo: PRA, items: [ITEM_2450] })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 104, true)
    await detailed(ui)
    const buttons = (await ui.findAll({ type: 'Button' })) as Drawn[]
    const lettered = buttons.filter(button => /^(log|issue-|pr-)/.test(String((button as any).key)))
    expect(lettered.length).toBeGreaterThanOrEqual(5)
    expect(lettered.map(button => button.props?.hotkey)).toEqual(Array.from(PAIR_LETTERS.slice(0, lettered.length)))
    for (const button of buttons) {
      const hotkey = String(button.props?.hotkey ?? '')
      if (PAIR_RESERVED.includes(hotkey) && hotkey !== '') expect((button as any).key).toBe(hotkey === 's' ? 'details' : 'hold')
      expect(button.props?.autoFocus).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('I5: nothing in the ledger posts, prompts or reaches out: show, look, scroll, h, refresh and writes raise no prompt, append or post', async ($, on) => {
  const raised: string[] = []
  // prompt.submit is recorded by the world, as outward.
  for (const name of ['prompt.fill', 'prompt.suggest', 'prompt.read', 'session.append']) {
    ;(on as any)(name, async () => {
      raised.push(name)
      return {}
    })
  }
  on('ui.scroll', async () => ({}))
  const seen = world(on)
  seen.panes = [FOCUSED]
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, verb: 'approve-merge', sensitive: true }, { ...ITEM_2450, verb: 'comment' }] })
  await look($, seen)
  await $.ui.scroll({ component: 'Pane', requestId: 'review-pair', offset: 50, by: 11, bodyRows: 11, contentRows: 61, origin: { kind: 'person' } } as any)
  await release()
  const ui = await mountPane($, 'terminal', 130, true)
  for (const key of ['hold', 'tab-1', 'hold', 'refresh', 'tab-0']) await ui.press({ key })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: `gh pr review 4045 --approve --repo ${PRA}` })
  await seen.clock.settle()
  await ui.unmount()
  expect(raised).toEqual([])
  expect(seen.outward).toEqual([])
  // The only tool run is Claude's own Bash call; the pane's own calls are gh reads and nothing else.
  expect(seen.toolRuns).toEqual([`Bash gh pr review 4045 --approve --repo ${PRA}`])
  expect(seen.calls.every(call => call.argv[0] === 'gh' && call.argv[1] === 'api' && call.argv[2] === 'graphql' && !call.argv.join(' ').includes('mutation'))).toBe(true)
})

test('I5 review F1: a held item re-shown with new text draws changed since you looked on both rows, held as words', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await look($, seen)
  const { ui } = await glance($, seen, 104)
  await ui.press({ key: 'hold' })
  await seen.clock.settle()
  // Held and seen: the held glyph leads, the seen state stays in words.
  expect(await factsOf(ui)).toBe(`‖ held · seen · text ${HASH_4045} · head 35a07eb`)
  await ui.unmount()
  await show($, 'c2', { ...PAIR, items: [{ ...ITEM_4045, draft: 'Thanks, approving.' }, ITEM_2450] })
  const edited = await glance($, seen, 104)
  expect(edited.facts).toBe(`◇ changed since you looked · held · text ${(await textHashOf(canonicalText('Thanks, approving.') ?? '')).slice(0, 6)} · head 35a07eb`)
  const row = (await edited.ui.find({ type: 'Box', key: 'row-facts' })) as Drawn
  expect(row.children?.[0]?.children?.[0]?.props?.color).toBe('warning')
  await edited.ui.press({ key: 'tab-1' })
  expect(await ledgerOf(edited.ui)).toEqual(['◇ #4045 changed since you looked, held'])
  expect(lint(await edited.ui.drawn())).toEqual([])
  await edited.ui.unmount()
})

test('I5 review F2: in the dock each fact is a unit of its own, its separator at its end, so no line splits a phrase or starts with a dot', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, verb: 'approve-merge', sensitive: true }, ITEM_2450] })
  await look($, seen, 53)
  await show($, 'c2', { repo: PRA, items: [{ ...ITEM_4045, draft: 'Thanks, approving.', verb: 'approve-merge', sensitive: true }, ITEM_2450] })
  const { ui } = await glance($, seen, 53)
  const row = (await ui.find({ type: 'Box', key: 'row-facts' })) as Drawn
  const units = (row.children?.[1]?.children ?? []).map(textOf)
  expect(units).toEqual(['changed since you looked ·', 'approve and merge ·', `text ${(await textHashOf(canonicalText('Thanks, approving.') ?? '')).slice(0, 6)} ·`, 'head 35a07eb ·', 'sensitive'])
  for (const unit of row.children?.[1]?.children ?? []) expect(unit.props).toMatchObject({ flexShrink: 1, minWidth: 0 })
  expect(units.some(unit => unit.startsWith('·'))).toBe(false)
  expect(lint(await ui.drawn())).toEqual([])
  await ui.unmount()
})

test('I5 review S1: a tab-indented draft counts each tab as the engine draws it, so its end below the window is not seen', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  // Each line is 53 code points, one row at 71 columns by code points, but its four tabs draw 32 columns, which wraps it
  // to two rows: eighteen lines are 18 rows by code points and 36 as drawn, past the dock's 34.
  const tabbed = Array.from({ length: 18 }, (_, i) => `\t\t\t\tvalue_${i} = compute_other_value(alpha, beta, gamma)`).join('\n')
  await show($, 'c1', { repo: PRA, items: [{ ...ITEM_4045, draft: tabbed }] })
  await look($, seen, 71)
  expect((await glance($, seen, 71)).facts).toMatch(/^○ not seen /)
  await look($, seen, 71, 0, { offset: 40, bodyRows: 34 })
  expect((await glance($, seen, 71)).facts).toMatch(/^◆ seen /)
})

test('I5 review S2: re-shown at the head the viewer already looked at, with the same text, an item stays seen', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await look($, seen)
  // The head moves on GitHub: changed; looked at again under the new head, seen.
  const answer = clone(seen.answers[`${PRA}#4045`])
  answer.data.repository.pullRequest.headRefOid = 'ffffffffffffffffffffffffffffffffffffffff'
  seen.answers[`${PRA}#4045`] = answer
  const { ui } = await glance($, seen)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await factsOf(ui)).toMatch(/^◇ changed since you looked /)
  await ui.unmount()
  await look($, seen)
  expect((await glance($, seen)).facts).toMatch(/^◆ seen /)
  // Claude catches up and re-shows it at that head with the same text: nothing changed since the viewer looked.
  await show($, 'c2', { ...PAIR, items: [{ ...ITEM_4045, head: 'ffffffffffffffffffffffffffffffffffffffff' }, ITEM_2450] })
  expect((await glance($, seen)).facts).toBe(`◆ seen · text ${HASH_4045} · head fffffff`)
  // I5 security review: a 7-hex prefix of that head proves nothing (a pushed commit can match it), so it reads as changed.
  await show($, 'c2b', { ...PAIR, items: [{ ...ITEM_4045, head: 'fffffff' }, ITEM_2450] })
  expect((await glance($, seen)).facts).toMatch(/^◇ changed since you looked /)
  // A head neither given before nor looked at still marks it changed.
  await show($, 'c3', { ...PAIR, items: [{ ...ITEM_4045, head: 'abcdef1' }, ITEM_2450] })
  expect((await glance($, seen)).facts).toMatch(/^◇ changed since you looked /)
})

test('I5 review S4: a write of Claude\'s that failed marks nothing written', async ($, on) => {
  // The engine beneath runs the command and it exits 1: the result is an error.
  on('tool.call', { tool: 'Bash' }, async () => ({ isError: true, result: { stdout: '', stderr: 'boom', interrupted: false }, text: 'Exit code 1' }) as any)
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  const done = await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: `gh pr comment 4045 --body x --repo ${PRA}` })
  expect((done as any).isError).toBe(true)
  await seen.clock.settle()
  expect((await glance($, seen, 104, 1)).ledger).toEqual(['○ #4045 not opened'])
})

test('I5 review S5: a show landing between a drawing and its seen write is not marked seen, since it was never drawn', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  await show($, 'c1', PAIR)
  await release()
  const ui = await $.ui.mount({ plugin: 'review-pair', surface: 'terminal', component: 'Pane', requestId: 'review-pair', props: paneProps(39, true) })
  await ui.press({ key: 'tab-0' })
  await ui.drawn()
  // Before the tick that writes the seen mark, Claude shows a long draft the window cannot hold.
  await show($, 'c2', { repo: PRA, items: [{ ...ITEM_4045, draft: longDraft }, ITEM_2450] })
  await seen.clock.settle()
  await ui.unmount()
  expect((await glance($, seen)).facts).toMatch(/^○ not seen /)
})

test('I5 security review: a draft carrying an inline comment\'s shape hashes apart from that inline comment', async () => {
  const asDraft = canonicalText('X\n\na:1\nb')
  const asInline = canonicalText('X', [{ path: 'a', line: 1, body: 'b' }])
  expect(asDraft).not.toBe(asInline)
  expect(await textHashOf(asDraft ?? '')).not.toBe(await textHashOf(asInline ?? ''))
  expect(await textHashOf(asInline ?? '')).toMatch(/^[0-9a-f]{64}$/)
})

test('I5 security review: an item looked at under a short given head is changed when the card reads a full head it only prefixes', async ($, on) => {
  const seen = world(on)
  seen.panes = [SHOWN]
  const answer = seen.answers[`${PRA}#4045`]
  delete seen.answers[`${PRA}#4045`]
  await show($, 'c1', PAIR)
  await look($, seen)
  expect((await glance($, seen)).facts).toMatch(/^◆ seen /)
  // The card now reads a 40-hex head that the 7 hex the viewer looked at only starts: a prefix proves nothing, so changed.
  seen.answers[`${PRA}#4045`] = answer
  const { ui } = await glance($, seen)
  await ui.press({ key: 'refresh' })
  await seen.clock.settle()
  expect(await factsOf(ui)).toMatch(/^◇ changed since you looked /)
})
