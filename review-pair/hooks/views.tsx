import type { Elements, RenderElement, RenderSurface, TextProps, ThemeKey } from 'claude-code'

import type { Body, Card, Detail, DetailCard, DetailEntry, DetailRead, GroupView, LedgerEntry, Pair, PairItem, Queue, QueueRead, Trend, Verb, View } from '../types'
import {
  BOARD_URL,
  ageOf,
  asOfOf,
  attentionOf,
  cardPillOf,
  clockOf,
  cutEnd,
  detailPillOf,
  factsOf,
  itemUrl,
  pairAttentionOf,
  queueModelOf,
  sparkOf,
  statusLineOf,
  told,
  trendWordOf,
  type Counts,
  type Facts,
  type Heading,
  type Phrased,
  type Pill,
  type PillRole,
  type QueueModel,
  type QueueRow,
  type Row,
  type StatusLine,
  type Tier,
} from './github'
import { marks, openFence, widthOf as drawnWidthOf, wrap } from './text'

// The constructors every surface carries, which is all the view draws with.
export type Ui = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>

// Everything the view can ask for; the hooks module turns each into a state write, a read or an open.
export type Actions = {
  onTab: (index: number) => void
  onOpen: (url: string, surface: RenderSurface) => void
  // r in every view: everything the view shows, read again.
  onRefresh: () => void
  onView: (view: View) => void
  onLegend: () => void
  // y: a failed read's facts, opened under its row and closed again.
  onWhy: () => void
  onDetail: (target: { repo: string; kind: 'pr' | 'issue'; number: number }) => void
  onBack: () => void
  // I2: j and k. In a list, the cursor one row on or back, stopping at the ends; in the detail, the next or previous
  // item of the list it was opened from.
  onMove: (delta: 1 | -1) => void
  // I2: a collapsible group's own row: Enter or a click opens it in place, and again closes it.
  onToggle: (view: GroupView, group: string) => void
  // I5: h on the pair view: the shown tab's item held in the ledger, or no longer.
  onHold: () => void
  // e on the pair view, drawn only for an item with evidence: its bullets opened, or closed again.
  onEvidence: () => void
  // s on the pair view: the shown item's status rows opened under its status line, or closed again.
  onDetails: () => void
}

// I2: row hotkeys, skipping the letters that switch views or act (p q i r o l) and y, j, k and a, which are never row
// letters: j and k move the cursor, a opens the board. Sixteen; rows past them are reached with j/k, Tab or a click.
export const LETTERS = 'bcdefghmnstuvwxz'
// I5: the pair view's row letters: LETTERS less h (hold), m and d (I7's merge and draft-end keys), y (I7's accept) and
// s (the status rows), so a pair row never takes a key the pair view binds or will bind. Twelve.
export const PAIR_RESERVED = 'hmdys'
export const PAIR_LETTERS = Array.from(LETTERS)
  .filter(letter => !PAIR_RESERVED.includes(letter))
  .join('')
// An item with evidence binds e to it, so its rows skip e as well; an item without keeps its letters as they were.
export const EVIDENCE_LETTERS = PAIR_LETTERS.replace('e', '')

// I2: the cursor's state for one list view: its row key, and the groups opened in place.
export type Nav = { cursor?: string; expanded: string[] }
// I2: from this many body columns a list view draws the master-detail column beside its rows. A real-session note
// (R2, 2.1.296): the right-hand dock never gets there. Its body is min(floor(0.45 × columns), columns − 70) − 1, so 57
// at 130 columns, and it caps at 89 from 200 columns on; a kept dockColumns in the profile (one measured at 53) wins
// over any width asked and did not widen it past that cap when seeded at 124. The two-column layout shows in the
// inline pane (tui default, about 126 body columns at 130), not docked. Kept at the plan's 120 rather than lowered
// to a width the dock gives, which is the viewer's call.
export const SIDE_FROM = 120
// I2: an issues section this long or longer collapses; the queue's author and parked groups always do.
const LONG_ROWS = 4
export const GROUP_KEY = /^group-([a-z]+)$/
export const ROW_KEY = /^(pull|issues)-([1-9][0-9]{0,9})$/
// I2: a key the cursor can rest on: a row's Button or a group's.
export const isCursorKey = (key: string) => ROW_KEY.test(key) || GROUP_KEY.test(key)
export const groupKeyOf = (heading: Heading) => `group-${heading.key}`

export function isCollapsible(which: GroupView, heading: Heading): boolean {
  if (which === 'queue') return heading.key === 'author' || heading.key === 'parked'
  return (heading.key === 'community' || heading.key === 'reporter') && heading.rows.length >= LONG_ROWS
}

// I2: the keys a list's cursor walks, top to bottom: each row's Button, and for a collapsible group its own row first,
// then its rows only while it is open. The view and the hooks module read this one list, so j/k and ▸ never disagree.
export function focusablesOf(model: QueueModel | undefined, which: GroupView, expanded: string[]): string[] {
  if (model === undefined) return []
  const headings = which === 'queue' ? model.prs : model.issues
  return headings
    .filter(heading => heading.rows.length > 0)
    .flatMap(heading => {
      const rows = heading.rows.map(row => row.key)
      if (!isCollapsible(which, heading)) return rows
      const key = groupKeyOf(heading)
      return expanded.includes(key) ? [key, ...rows] : [key]
    })
}

// I2: where the cursor rests: its key while the list still draws it, else the first row.
export const cursorOf = (keys: string[], cursor: string | undefined) => (cursor !== undefined && keys.includes(cursor) ? cursor : keys[0])

// I2: the detail's place in the list it was opened from: its index among the group's rows (the pair's items from the
// pair), and the neighbour each of j and k would swap to. Undefined when the list no longer holds it.
export type Neighbour = { key: string; kind: 'pr' | 'issue'; number: number; index: number }
export type Walk = { index: number; count: number; group: string; previous?: Neighbour; next?: Neighbour }

export function walkOf(detail: Pick<Detail, 'from' | 'back' | 'number'>, model: QueueModel | undefined, pair: Pair | null): Walk | undefined {
  const toNeighbour = (list: Neighbour[], index: number): Walk | undefined => {
    const [previous, next] = [list[index - 1], list[index + 1]]
    return { index, count: list.length, group: '', ...(previous === undefined ? {} : { previous }), ...(next === undefined ? {} : { next }) }
  }
  if (detail.from === 'pair') {
    if (pair === null) return undefined
    const items = pair.items.map((item, index): Neighbour => ({ key: 'detail', kind: item.kind ?? 'pr', number: item.number, index }))
    const index = items.findIndex(item => item.number === detail.number)
    return index < 0 ? undefined : { ...toNeighbour(items, index)!, group: 'the pair' }
  }
  for (const heading of (detail.from === 'queue' ? model?.prs : model?.issues) ?? []) {
    const index = heading.rows.findIndex(row => row.key === detail.back)
    if (index < 0) continue
    const rows = heading.rows.map((row, i): Neighbour => ({ key: row.key, kind: row.kind === 'pull' ? 'pr' : 'issue', number: row.number, index: i }))
    return { ...toNeighbour(rows, index)!, group: heading.title }
  }
  return undefined
}

// Colour sits on the glyph alone; the words beside it stay in the text colour.
const GLYPHS: Record<Tier, { glyph: string; color: ThemeKey }> = {
  ok: { glyph: '✓', color: 'success' },
  warn: { glyph: '▲', color: 'warning' },
  bad: { glyph: '✗', color: 'error' },
  merged: { glyph: '●', color: 'merged' },
  note: { glyph: '○', color: 'inactive' },
  idle: { glyph: '○', color: 'inactive' },
}

export const keyOf = (repo: string, number: number) => `${repo}#${number}`

// I1 colour roles (plan section 2, Q1 and Q3): a pill's key by role, each measured at 5:1 or better under inverseText
// words in every RGB theme (tests/palette.ts PILL_BG). Its words are uppercase, bold, one space of padding each side.
const PILL_BG: Record<PillRole, ThemeKey> = { act: 'error', move: 'planMode', ready: 'success', done: 'merged', parked: 'inactive' }
// Pills drawn in one view at most, the attention line and the body together (tests/lint.ts counts them).
const PILL_LIMIT = 3

function pill(ui: Ui, one: Pill, key: string): RenderElement {
  const { Text } = ui
  return (
    <Text key={key} color="inverseText" backgroundColor={PILL_BG[one.role]} bold>
      {` ${one.words} `}
    </Text>
  )
}

// The attention line under a view's top row: at most `room` pills, worst first, and 'next: #N', the first item owed;
// no row at all when there is nothing to say.
function attentionLine(ui: Ui, attention: { pills: Pill[]; next?: number }, room = PILL_LIMIT): RenderElement[] {
  const { Box, Text } = ui
  const shown = attention.pills.slice(0, Math.max(0, room))
  if (shown.length === 0 && attention.next === undefined) return []
  return [
    <Box key="attention" flexDirection="row" flexWrap="wrap" columnGap={1}>
      {shown.map((one, i) => (
        <Box key={`pill-${i}`} flexShrink={0}>
          {pill(ui, one, `pill-${i}`)}
        </Box>
      ))}
      {attention.next !== undefined && <Text>{`next: #${attention.next}`}</Text>}
    </Box>,
  ]
}

// Any text from GitHub or the model: each invisible run drawn as an inverse token, never as itself.
function marked(ui: Ui, text: string, props: TextProps = {}, key?: string): RenderElement {
  const { Text } = ui
  return (
    <Text key={key} {...props}>
      {marks(text).map((piece, i) =>
        piece.isHidden ? (
          <Text key={`mark-${i}`} inverse>
            {piece.text}
          </Text>
        ) : (
          piece.text
        ),
      )}
    </Text>
  )
}

// One line per colour the pane draws, each its glyph or swatch in that colour and its role in words.
const LEGEND: { key: string; glyph: string; color: ThemeKey; words: string }[] = [
  { key: 'ok', glyph: '✓', color: 'success', words: 'passed, holds, as reviewed' },
  { key: 'warn', glyph: '▲', color: 'warning', words: 'unknown, partial or worth a look' },
  { key: 'bad', glyph: '✗', color: 'error', words: 'blocks: moved, failing, conflicts' },
  { key: 'merged', glyph: '●', color: 'merged', words: 'merged' },
  // I5 (review F3): the ledger draws an item not yet seen with this glyph too.
  { key: 'note', glyph: '○', color: 'inactive', words: 'a note or not seen; grey: reasons' },
  { key: 'claude', glyph: '✻', color: 'claude', words: "Claude's ask, what you say yes to" },
  // The engine draws every hotkey letter in its accent colour, this same blue, and the mod cannot change it.
  { key: 'draft', glyph: '▎', color: 'suggestion', words: 'draft, verbatim; blue letters: keys' },
  { key: 'trend', glyph: '▅', color: 'remember', words: 'open PRs a week; purple: this week' },
  { key: 'falling', glyph: '▼', color: 'success', words: 'queue falling; ▲ rising, ● flat' },
]

// One line per pill role, its swatch an example pill; then the line that says a bare row needs nothing.
const PILL_LEGEND: { role: PillRole; example: string; words: string }[] = [
  { role: 'act', example: 'CI FAILED', words: 'act now: broken or late' },
  { role: 'move', example: 'YOU OWE 2', words: 'your move, next: first' },
  { role: 'ready', example: 'READY', words: 'all green; CLEAR: none owed' },
  { role: 'done', example: 'MERGED', words: 'done; POSTED for one refresh' },
  { role: 'parked', example: 'NOT READ', words: 'failed or over 5 min old' },
]
const NO_PILL = 'no pill: nothing to act on'
// I4 (review F8): a key the pane does not bind falls through to the prompt and takes the focus with it (seen live on
// 2.1.296), so the legend says where an unbound letter goes.
const KEYS_LINE = 'other keys: typed into the prompt'
const STATUS_KEY_LINE = 's: the rows behind the status line'
const BOARD_KEY_LINE = 'a: the maintainer board, in a browser'

// I5: the decision ledger's marks, each a glyph and its words (the current tab's unseen item reads 'not seen'). Only
// changed takes a colour, the amber of worth a look; the rest are grey notes, so the pill and colour budgets stand.
type Mark = 'seen' | 'unseen' | 'changed' | 'held' | 'written' | 'merged'
const MARKS: Record<Mark, { glyph: string; color: ThemeKey; words: string }> = {
  seen: { glyph: '◆', color: 'inactive', words: 'seen' },
  unseen: { glyph: '○', color: 'inactive', words: 'not opened' },
  changed: { glyph: '◇', color: 'warning', words: 'changed since you looked' },
  held: { glyph: '‖', color: 'inactive', words: 'held' },
  written: { glyph: '✓', color: 'inactive', words: 'written' },
  merged: { glyph: '✓', color: 'inactive', words: 'merged' },
}
// I5: the legend's ledger lines: the three new glyphs, the written mark, and what the text hash is.
const LEDGER_LEGEND: { key: string; glyph?: string; color?: ThemeKey; words: string }[] = [
  { key: 'seen', glyph: '◆', color: 'inactive', words: 'seen: draft read to its end' },
  { key: 'changed', glyph: '◇', color: 'warning', words: 'changed since you looked' },
  { key: 'held', glyph: '‖', color: 'inactive', words: 'held by h: a mark, nothing more' },
  { key: 'written', glyph: '✓', color: 'inactive', words: 'grey: written by Claude, or merged' },
  { key: 'hash', words: 'text 3f9a1c: sha256, draft + inline' },
]
const VERB_WORDS: Record<Verb, string> = {
  'approve-merge': 'approve and merge',
  approve: 'approve',
  comment: 'comment',
  'request-changes': 'request changes',
  close: 'close',
  pending: 'pending',
}

// I5: an item's mark, worst news first: written (merged once a card read after the write says so), changed, seen, else
// not opened. Review F1: held is a mark of its own and never hides one of these. It takes the glyph only from seen or
// not opened, seen then following in words; written, merged and changed keep their glyph and gain the word held.
type State = { mark: Mark; also?: 'held' | 'seen' }
function stateOf(entry: LedgerEntry | undefined, card: Card | undefined): State {
  const read = card?.read
  const mark: Mark =
    entry?.writtenAt !== undefined
      ? read?.kind === 'pr' && read.state === 'MERGED' && read.at >= entry.writtenAt
        ? 'merged'
        : 'written'
      : entry?.changedAt !== undefined
        ? 'changed'
        : entry?.seenAt !== undefined
          ? 'seen'
          : 'unseen'
  if (entry?.held !== true) return { mark }
  if (mark === 'seen') return { mark: 'held', also: 'seen' }
  return mark === 'unseen' ? { mark: 'held' } : { mark, also: 'held' }
}

// Lines 37 columns wide in one wrapping row: one a row in the 39-column dock, two on the 104-column strip, which
// keeps the head and CI rows in the strip's window with the legend open. The pill lines come first: in one column
// (under 78 columns) an 11-row strip shows eight of the sixteen, and the glyph lines are the older, known ones.
const LEGEND_LINE = 37

function legend(ui: Ui): RenderElement {
  const { Box, Text } = ui
  return (
    <Box key="legend-lines" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {PILL_LEGEND.map(one => (
        <Box key={`row-legend-pill-${one.role}`} width={LEGEND_LINE} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>{pill(ui, { role: one.role, words: one.example }, 'swatch')}</Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{one.words}</Text>
          </Box>
        </Box>
      ))}
      <Box key="legend-no-pill" width={LEGEND_LINE}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{NO_PILL}</Text>
        </Box>
      </Box>
      {LEGEND.map(one => (
        <Box key={`row-legend-${one.key}`} width={LEGEND_LINE} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Text color={one.color}>{one.glyph}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{one.words}</Text>
          </Box>
        </Box>
      ))}
      <Box key="legend-data" width={LEGEND_LINE}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">Aa plain words: GitHub's data</Text>
        </Box>
      </Box>
      <Box key="legend-keys" width={LEGEND_LINE}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{KEYS_LINE}</Text>
        </Box>
      </Box>
      <Box key="legend-status" width={LEGEND_LINE}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{STATUS_KEY_LINE}</Text>
        </Box>
      </Box>
      <Box key="legend-board" width={LEGEND_LINE}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{BOARD_KEY_LINE}</Text>
        </Box>
      </Box>
      {LEDGER_LEGEND.map(one => (
        <Box key={one.glyph === undefined ? `legend-ledger-${one.key}` : `row-legend-ledger-${one.key}`} width={LEGEND_LINE} flexDirection="row" columnGap={1}>
          {one.glyph !== undefined && (
            <Box flexShrink={0}>
              <Text color={one.color}>{one.glyph}</Text>
            </Box>
          )}
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{one.words}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// Focused, the legend's key sits where the ctrl+x tab hint sits otherwise, so the header never grows a row.
function legendKey(ui: Ui, isFocused: boolean, actions: Actions): RenderElement {
  const { Text, Button } = ui
  if (isFocused) return <Button key="legend" label="legend" hotkey="l" plain onPress={() => actions.onLegend()} />
  return (
    <Text key="hint" color="inactive">
      ctrl+x tab: keys
    </Text>
  )
}

// a opens the maintainer board from every view: a plain Button, so a click does the same.
function boardKey(ui: Ui, actions: Actions): RenderElement {
  const { Button } = ui
  return <Button key="board" label="board" hotkey="a" plain onPress={press => actions.onOpen(BOARD_URL, press.surface)} />
}

function factRow(ui: Ui, row: Row, isGrey: boolean, letter: string | undefined, actions: Actions): RenderElement {
  const { Box, Text, Button } = ui
  const { glyph, color } = GLYPHS[row.tier]
  const open = row.open
  const button =
    open === undefined ? undefined : (
      <Button
        key={open.isTrailing ? 'log' : row.key}
        label={open.label}
        plain
        {...(letter === undefined ? {} : { hotkey: letter })}
        onPress={press => actions.onOpen(open.url, press.surface)}
      />
    )
  return (
    <Box key={`row-${row.key}`} flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text color={isGrey ? 'inactive' : color}>{glyph}</Text>
      </Box>
      {button !== undefined && open?.isTrailing !== true && <Box flexShrink={0}>{button}</Box>}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {marked(ui, row.text, { wrap: row.isWrapped ? 'wrap' : 'truncate-end', ...(isGrey || row.key === 'clear' ? { color: 'inactive' as const } : {}) })}
      </Box>
      {button !== undefined && open?.isTrailing === true && <Box flexShrink={0}>{button}</Box>}
    </Box>
  )
}

// The status line's parts in draw order: the worst tier's glyph on the first, the other lead phrases, +N, then the merge
// and draft slots. A part after the first draws its glyph only when it is not green; each but the last ends in ' ·'.
function statusPartsOf(line: StatusLine): (Phrased & { hasGlyph: boolean })[] {
  const [first, ...rest] = line.lead
  const parts: (Phrased & { hasGlyph: boolean })[] = [
    { tier: line.tier, text: first?.text ?? '', hasGlyph: true },
    ...rest.map(one => ({ ...one, hasGlyph: one.tier !== 'ok' })),
    ...(line.more > 0 ? [{ tier: 'ok' as const, text: `+${line.more}`, hasGlyph: false }] : []),
    ...[line.merge, line.draft].flatMap(one => (one === undefined ? [] : [{ ...one, hasGlyph: one.tier !== 'ok' }])),
  ]
  return parts.map((one, i) => (i < parts.length - 1 ? { ...one, text: `${one.text} ·` } : one))
}

const detailsLabel = (isOpen: boolean) => (isOpen ? 'collapse' : 'details')

// One status line per item, wrapping between its parts and never cutting one; colour sits on its glyphs alone.
function statusRow(ui: Ui, line: StatusLine, isOpen: boolean, actions: Actions): RenderElement {
  const { Box, Text, Button } = ui
  return (
    <Box key="status" flexDirection="row" flexWrap="wrap" columnGap={1}>
      {statusPartsOf(line).map((part, i) =>
        part.hasGlyph ? (
          <Box key={`row-status-${i}`} flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>
              <Text color={GLYPHS[part.tier].color}>{GLYPHS[part.tier].glyph}</Text>
            </Box>
            <Text>{part.text}</Text>
          </Box>
        ) : (
          <Box key={`status-${i}`}>
            <Text>{part.text}</Text>
          </Box>
        ),
      )}
      <Button key="details" label={detailsLabel(isOpen)} hotkey="s" plain onPress={() => actions.onDetails()} />
    </Box>
  )
}

// When the view's read was made, or 'refreshing' while an r press reads: an info caption beside the keys, never a label.
const asOfText = (at: number | undefined, isReading: boolean) => (isReading ? 'refreshing' : at === undefined ? undefined : `as of ${clockOf(at)}`)

// The navigation row: the pair's tabs, the view keys and the read's time. `tail`: on the strip, the batch's count and the
// queue's attention line at the row's end (the plan's 4.1 mockup), so they cost it no row; a tall pane puts them on a
// batch row of their own.
function tabRow(ui: Ui, pair: Pair, index: number, all: Facts[], asOf: string | undefined, isFocused: boolean, actions: Actions, count: RenderElement[] = [], tail: RenderElement[] = []) {
  const { Box, Text, Button } = ui
  const item = pair.items[index]
  const url = item === undefined ? undefined : itemUrl(pair.repo, item.kind === 'issue' ? 'issues' : 'pull', item.number)
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {pair.items.map((one, i) => {
        const { glyph, color } = GLYPHS[all[i]?.worst ?? 'idle']
        return (
          <Box key={`tabs-${i}`} flexDirection="row">
            <Text>{i === index ? '▸' : ' '}</Text>
            <Text color={color}>{glyph}</Text>
            <Text> </Text>
            <Button key={`tab-${i}`} label={`#${one.number}`} hotkey={String(i + 1)} plain onPress={() => actions.onTab(i)} />
          </Box>
        )
      })}
      {url !== undefined && <Button key="open" label="open" hotkey="o" plain onPress={press => actions.onOpen(url, press.surface)} />}
      <Button key="refresh" label="refresh" hotkey="r" plain onPress={() => actions.onRefresh()} />
      {boardKey(ui, actions)}
      <Button key="queue" label="queue" hotkey="q" plain onPress={() => actions.onView('queue')} />
      <Button key="issues" label="issues" hotkey="i" plain onPress={() => actions.onView('issues')} />
      {asOf !== undefined && <Text color="inactive">{asOf}</Text>}
      {count}
      {legendKey(ui, isFocused, actions)}
      {tail}
    </Box>
  )
}

// The batch row: how many are under review, the other items' marks and the queue's attention pills, one wrapping row;
// none when it would be empty.
const underReviewOf = (pair: Pair) => ((pair.left ?? 0) > 0 ? `${pair.items.length + (pair.left ?? 0)} under review` : undefined)

function batchRow(ui: Ui, count: RenderElement[], ledger: RenderElement[], attention: RenderElement[]): RenderElement[] {
  const { Box } = ui
  if (count.length === 0 && ledger.length === 0 && attention.length === 0) return []
  return [
    <Box key="batch" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {count}
      {ledger}
      {attention}
    </Box>,
  ]
}

// I2d: Claude's ask in full, wrapped by the engine beside the fixed glyph column (the pair view keeps no window of
// its own, so its rows need no count); the reason below it wraps the same way.
const claudeText = (item: PairItem) => `Claude${item.confidence === undefined ? '' : ` ${item.confidence}/10`}${item.contributorActs === true ? ', author acts' : ''}: ${item.action}`

function claudeRow(ui: Ui, item: PairItem): RenderElement {
  const { Box, Text } = ui
  return (
    <Box key="row-claude" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text color="claude">✻</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {marked(ui, claudeText(item), { bold: true, wrap: 'wrap' })}
      </Box>
    </Box>
  )
}

// The evidence under the reason: e and its count on one row, closed at the start; open, one bullet a row in the one
// colour besides text and grey that reaches 5:1 on all four themes (a Button's label takes none, so the key row stays
// plain).
const EVIDENCE_KEY: ThemeKey = 'autoAccept'
const evidenceLabel = (count: number, isOpen: boolean) => `${isOpen ? '▾' : '▸'} evidence (${count})`

function evidenceRows(ui: Ui, bullets: string[], isOpen: boolean, actions: Actions): RenderElement[] {
  const { Box, Text, Button } = ui
  return [
    <Box key="evidence" flexDirection="row">
      <Button key="evidence-key" label={evidenceLabel(bullets.length, isOpen)} hotkey="e" plain onPress={() => actions.onEvidence()} />
    </Box>,
    ...(isOpen
      ? bullets.map((bullet, i) => (
          <Box key={`evidence-${i}`} flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>
              <Text color={EVIDENCE_KEY}>•</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {marked(ui, bullet, { color: EVIDENCE_KEY, wrap: 'wrap' })}
            </Box>
          </Box>
        ))
      : []),
  ]
}

// The draft and inline bodies in one block marked by a blue left rule, below the item's facts. The
// blue keys reach only 4.4:1 on white (3.9 on Latte), short of the 5:1 words need, so the words stay in the text colour
// and the blue is the rule's alone, which clears the 3:1 a mark needs in every theme. The rule and the legend name the
// block: a heading inside it would cost the draft its row on the 104-column strip, below the quote's blank top.
// Claude's reason and its evidence, drawn under Claude's ask.
const reasonRows = (ui: Ui, item: PairItem, isEvidence: boolean, actions: Actions): RenderElement[] => [
  ...(item.why === undefined ? [] : [marked(ui, item.why, { color: 'inactive', wrap: 'wrap' }, 'why')]),
  ...(item.evidence === undefined ? [] : evidenceRows(ui, item.evidence, isEvidence, actions)),
]

function draftRows(ui: Ui, item: PairItem): RenderElement[] {
  const { Box, Text } = ui
  const fence = (text: string, key: string) => {
    const at = openFence(text)
    return at === undefined ? [] : [<Text key={key} bold>{`! fence on line ${at} never closes`}</Text>]
  }
  const drafted = [
    ...(item.draft === undefined
      ? []
      : [...fence(item.draft, 'draft-fence'), marked(ui, item.draft, {}, 'draft')]),
    ...(item.inline ?? []).map((comment, i) => (
      <Box key={`inline-${i}`} flexDirection="column">
        {marked(ui, `${comment.path}:${comment.line}`, { color: 'inactive', wrap: 'truncate-start' })}
        {fence(comment.body, `inline-fence-${i}`)}
        {marked(ui, comment.body)}
      </Box>
    )),
  ]
  // I5: draft-end, a keyed Box (spike S: $.ui.scroll refuses a Text key) after the draft and its inline comments, the
  // last element of the pair view, so the window reaching the tree's end has it in view.
  return [
    ...(drafted.length === 0
      ? []
      : [
          <Box key="draft" flexDirection="column" borderStyle="quote" borderColor="suggestion" paddingLeft={1}>
            {drafted}
          </Box>,
          <Box key="draft-end" />,
        ]),
  ]
}

// I5: the rows a wrapping row of parts takes, `gap` apart, each on the line it fits; one wider than the row takes lines
// of its own.
function packedRows(widths: number[], columns: number, gap: number): number {
  const room = Math.max(1, columns)
  let rows = 0
  let used = 0
  for (const width of widths) {
    if (rows > 0 && used + gap + width <= room) {
      used += gap + width
      continue
    }
    rows += Math.max(1, Math.ceil(width / room))
    used = Math.min(width, room)
  }
  return rows
}

// I5: the rows a text takes wrapped to `width`, line by line, as text.ts wraps it. Review S1: the engine draws a tab to
// the next 8-column stop, and text.ts counts it one column, so each tab is counted here as 8 spaces, the most a tab
// can take: over, never under.
const TAB = ' '.repeat(8)
const wrappedRows = (text: string, width: number) => text.split('\n').reduce((sum, one) => sum + wrap(one.replaceAll('\t', TAB), width).length, 0)
// A plain Button with a hotkey draws 'h: hold'.
const keyWidth = (hotkey: string, label: string) => drawnWidthOf(`${hotkey}: ${label}`)

// I5: the facts row's words: the item's own mark, its verb, text hash, head as given and sensitive, each a unit ending
// in ' ·' but the last (review F2), so a line breaks between two facts and never starts with a dot.
function factsUnitsOf(item: PairItem, state: State): string[] {
  const words = [
    state.mark === 'unseen' ? 'not seen' : MARKS[state.mark].words,
    ...(state.also === undefined ? [] : [state.also]),
    ...(item.verb === undefined ? [] : [VERB_WORDS[item.verb]]),
    ...(item.textHash === undefined ? [] : [`text ${item.textHash.slice(0, 6)}`]),
    ...(item.head === undefined ? [] : [`head ${item.head.slice(0, 7)}`]),
    ...(item.sensitive === true ? ['sensitive'] : []),
  ]
  return words.map((one, i) => (i < words.length - 1 ? `${one} ·` : one))
}

// I5: one row under the title: the item's mark as a glyph and words, then its decision facts in grey, wrapping to a
// second row where the dock is narrow, and h, which holds the item or lets it go. Review F2: the facts wrap one unit
// at a time, so "approve and merge" and "head 35a07eb" stay whole; a unit wider than the room wraps within itself.
function decisionRow(ui: Ui, units: string[], mark: Mark, isHeld: boolean, actions: Actions): RenderElement {
  const { Box, Text, Button } = ui
  return (
    <Box key="row-facts" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text color={MARKS[mark].color}>{MARKS[mark].glyph}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" flexWrap="wrap" columnGap={1}>
        {units.map((unit, i) => (
          <Box key={`fact-${i}`} flexShrink={1} minWidth={0}>
            <Text color="inactive" wrap="wrap">
              {unit}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexShrink={0}>
        <Button key="hold" label={isHeld ? 'unhold' : 'hold'} hotkey="h" plain onPress={() => actions.onHold()} />
      </Box>
    </Box>
  )
}

// A blank row between the pair view's groups (Claude's ask, the item, the draft) where the pane is tall enough to
// spare it; the 11-row inline strip keeps every row.
const ROOMY_FROM = 20
const gapOf = (rows: number) => (rows >= ROOMY_FROM ? 1 : 0)
const spacer = (ui: Ui, key: string, gap: number): RenderElement[] => (gap === 0 ? [] : [<ui.Box key={key} height={gap} />])

type LedgerMark = { number: number } & State
const ledgerWordsOf = (one: LedgerMark) => `#${one.number} ${MARKS[one.mark].words}${one.also === undefined ? '' : `, ${one.also}`}`

// I5: the ledger's other items, each a glyph and words in one wrapping row; no row when there are none.
function ledgerRow(ui: Ui, marks: LedgerMark[]): RenderElement[] {
  const { Box, Text } = ui
  if (marks.length === 0) return []
  return [
    <Box key="ledger" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {marks.map(one => (
        <Box key={`row-ledger-${one.number}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Text color={MARKS[one.mark].color}>{MARKS[one.mark].glyph}</Text>
          </Box>
          <Box flexShrink={1} minWidth={0}>
            <Text color="inactive" wrap="truncate-end">
              {ledgerWordsOf(one)}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>,
  ]
}

// I5: the ledger row's items by layout: in the dock the next tab's item only, on the strip every other item of the
// pair, and wide those and up to three of the repo's other ledger entries, the most recently touched first.
function ledgerMarksOf(pair: Pair, index: number, cards: Record<string, Card>, book: Record<string, LedgerEntry>, fit: Fit): LedgerMark[] {
  const markFor = (number: number) => ({ number, ...stateOf(book[keyOf(pair.repo, number)], cards[keyOf(pair.repo, number)]) })
  if (fit === 'dock') {
    const next = pair.items[(index + 1) % pair.items.length]
    return next === undefined || pair.items.length < 2 ? [] : [markFor(next.number)]
  }
  const others = pair.items.filter((_, i) => i !== index).map(one => markFor(one.number))
  if (fit === 'strip') return others
  const inPair = new Set(pair.items.map(one => one.number))
  const recent = Object.values(book)
    .reverse()
    .filter(entry => entry.repo === pair.repo && !inPair.has(entry.number))
    .slice(0, 3)
    .map(entry => ({ number: entry.number, ...stateOf(entry, undefined) }))
  return [...others, ...recent]
}

// One column, no border: tabs, Claude's row, the detail key and title, byline, head and CI on fixed rows, then red,
// amber and neutral rows, one clear line, and Claude's reason and drafts verbatim. Every row from the title to the
// clear line is one row (Claude's ask wraps above them, I2d), and the column takes the whole room, so an inline pane
// never resizes between tabs and its rows hold still.
// I5: the decision facts row sits under the title and the ledger row over the reason; draft-end ends the view.
// end: an estimate of the rows from the view's top through the draft's last row, over, never under (the quote's blank
// rows counted, widths as text.ts measures them), so a window that reaches it has the draft's end in view; absent with
// no draft or inline comment.
export function pairView(
  ui: Ui,
  pair: Pair | null,
  cards: Record<string, Card>,
  index: number,
  now: number,
  isFocused: boolean,
  columns: number,
  rows: number,
  actions: Actions,
  hasRepo = false,
  isLegend = false,
  isReading = false,
  queue: Queue | null = null,
  book: Record<string, LedgerEntry> = {},
  isEvidence = false,
  isDetails = false,
): { tree: RenderElement; end?: number } {
  const { Box, Text, Button } = ui
  const item = pair?.items[index]
  if (pair === null || item === undefined) {
    const tree = (
      <Box flexDirection="column">
        <Box key="views" flexDirection="row" columnGap={2}>
          {boardKey(ui, actions)}
          {hasRepo && <Button key="queue" label="queue" hotkey="q" plain onPress={() => actions.onView('queue')} />}
          {hasRepo && <Button key="issues" label="issues" hotkey="i" plain onPress={() => actions.onView('issues')} />}
          {isFocused && legendKey(ui, isFocused, actions)}
        </Box>
        {isLegend && legend(ui)}
        <Text color="inactive">Nothing under review. The maintainer skill fills this pane when it shows you a pair.</Text>
      </Box>
    )
    return { tree }
  }
  const shown = pair.items.map(one => cards[keyOf(pair.repo, one.number)])
  const all = pair.items.map((one, i) => factsOf(shown[i], one, pair.repo, now))
  const facts = all[index] ?? factsOf(undefined, item, pair.repo, now)
  const isUnread = shown[index]?.read === undefined
  let next = 0
  const letters = item.evidence === undefined ? PAIR_LETTERS : EVIDENCE_LETTERS
  const letterOf = (row: Row) => (row.open === undefined ? undefined : letters[next++])
  const fixed = isDetails ? [facts.head, facts.ci, ...facts.rows, ...(facts.clear === undefined ? [] : [facts.clear])] : []
  const line = statusLineOf(facts, shown[index]?.read, item)
  // I1: the shown item's own pill (READY, CI FAILED, HEAD MOVED, NOT READ, and MERGED, POSTED or CONFLICT) leads its
  // title row, the decision row; the NOT READ pill stands where a grey title stood. The attention line carries the
  // queue's pills alone (pairAttentionOf: never the queue's NOT READ, at most two, the owe pill kept), whether or not
  // this tab has a decision pill, so it is the same on every tab; it sits at the tab row's tail, so the strip keeps
  // its rows and the draft its place. The other tabs' states are their glyphs. CLEAR is withheld while any card of
  // the pair is broken or unread.
  const pills = pair.items.map((one, i) => cardPillOf(shown[i], all[i] ?? facts))
  const decision = pills[index]
  const isBlocked = pills.some(one => one !== undefined && (one.role === 'act' || one.role === 'parked'))
  const attention = pairAttentionOf(queue?.repo === pair.repo ? queue : null, now, isBlocked, PILL_LIMIT - 1)
  const hasTitle = !isUnread || decision === undefined
  const entry = book[keyOf(pair.repo, item.number)]
  const state = stateOf(entry, shown[index])
  const factsUnits = factsUnitsOf(item, state)
  const isHeld = entry?.held === true
  const others = ledgerMarksOf(pair, index, cards, book, fitOf(columns))
  const asOf = asOfText(asOfOf(shown), isReading)
  const end = item.draft === undefined && (item.inline ?? []).length === 0 ? undefined : pairRowsOf(pair, index, item, facts, line, attention, asOf, isFocused, isLegend, factsUnits, isHeld, others, columns, isEvidence, isDetails, rows)
  const gap = gapOf(rows)
  const countText = underReviewOf(pair)
  const count = countText === undefined ? [] : [<Text key="under-review" color="inactive">{countText}</Text>]
  const alerts = attentionLine(ui, attention, PILL_LIMIT - 1)
  const tree = (
    <Box flexDirection="column" minHeight={rows}>
      {gap === 0 ? tabRow(ui, pair, index, all, asOf, isFocused, actions, count, alerts) : tabRow(ui, pair, index, all, asOf, isFocused, actions)}
      {gap > 0 && batchRow(ui, count, ledgerRow(ui, others), alerts)}
      {isLegend && legend(ui)}
      {spacer(ui, 'gap-claude', gap)}
      {claudeRow(ui, item)}
      {spacer(ui, 'gap-item', gap)}
      <Box key="title" flexDirection="row" columnGap={1}>
        {decision !== undefined && <Box flexShrink={0}>{pill(ui, decision, 'decision')}</Box>}
        <Box flexShrink={0}>
          <Button key="detail" label="detail" hotkey="0" plain onPress={() => actions.onDetail({ repo: pair.repo, kind: item.kind ?? 'pr', number: item.number })} />
        </Box>
        {hasTitle && (
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {marked(ui, facts.title, { wrap: 'truncate-end', ...(isUnread ? { color: 'inactive' as const } : {}) })}
          </Box>
        )}
      </Box>
      {decisionRow(ui, factsUnits, state.mark, isHeld, actions)}
      {marked(ui, facts.byline, { wrap: 'truncate-end', ...(isUnread ? { color: 'inactive' as const } : {}) })}
      {statusRow(ui, line, isDetails, actions)}
      {fixed.length > 0 && (
        <Box key="status-rows" flexDirection="column" paddingLeft={2}>
          {fixed.map(row => factRow(ui, row, facts.isStale && row !== facts.head && row !== facts.ci, letterOf(row), actions))}
        </Box>
      )}
      {gap === 0 && ledgerRow(ui, others)}
      {item.why !== undefined || item.evidence !== undefined ? spacer(ui, 'gap-reason', gap) : []}
      {reasonRows(ui, item, isEvidence, actions)}
      {draftRows(ui, item)}
    </Box>
  )
  return end === undefined ? { tree } : { tree, end }
}

// I5: pairView's rows through the draft's last row, part by part as it draws them: the tab row (its parts packed two
// apart, the attention line one item or, wider than the row, lines of its own), the legend, Claude's ask, the title,
// the facts row beside h, the byline, the status line, the rows s opens under it (a wrapped one beside its glyph and
// Button, two in), the ledger row, the reason, the evidence key and its open bullets, and the quote block with a blank
// row above and below it. Each wrap is text.ts's, which counts a doubtful glyph wide, so the count errs high: a draft
// it calls out of view may be in view, never the other way round.
function pairRowsOf(
  pair: Pair,
  index: number,
  item: PairItem,
  facts: Facts,
  line: StatusLine,
  attention: { pills: Pill[]; next?: number },
  asOf: string | undefined,
  isFocused: boolean,
  isLegend: boolean,
  factsUnits: string[],
  isHeld: boolean,
  others: LedgerMark[],
  columns: number,
  isEvidence: boolean,
  isDetails: boolean,
  rows: number,
): number {
  const room = Math.max(1, columns)
  const count = underReviewOf(pair)
  const tabs = [
    ...pair.items.map((one, i) => 3 + keyWidth(String(i + 1), `#${one.number}`)),
    ...(pair.items[index] === undefined ? [] : [keyWidth('o', 'open')]),
    keyWidth('r', 'refresh'),
    keyWidth('a', 'board'),
    keyWidth('q', 'queue'),
    keyWidth('i', 'issues'),
    ...(asOf === undefined ? [] : [drawnWidthOf(asOf)]),
    isFocused ? keyWidth('l', 'legend') : drawnWidthOf('ctrl+x tab: keys'),
  ]
  const alerts = [
    ...attention.pills.slice(0, PILL_LIMIT - 1).map(one => drawnWidthOf(one.words) + 2),
    ...(attention.next === undefined ? [] : [drawnWidthOf(`next: #${attention.next}`)]),
  ]
  const alertsWidth = alerts.reduce((sum, width) => sum + width, 0) + Math.max(0, alerts.length - 1)
  const gap = gapOf(rows)
  const othersWidths = others.map(one => 2 + drawnWidthOf(ledgerWordsOf(one)))
  const ledgerRows = others.length === 0 ? 0 : packedRows(othersWidths, room, 2)
  const alertRows = (parts: number[]) =>
    alerts.length === 0 ? packedRows(parts, room, 2) : alertsWidth <= room ? packedRows([...parts, alertsWidth], room, 2) : packedRows(parts, room, 2) + packedRows(alerts, room, 1)
  const countWidths = count === undefined ? [] : [drawnWidthOf(count)]
  // The strip: the count and the alerts at the tab row's end, the ledger row under the fixed rows. A tall pane: the
  // tabs alone, then the batch row (count, ledger, alerts), counted over when the ledger wraps, and the group gaps.
  const header =
    gap === 0
      ? alertRows([...tabs, ...countWidths]) + ledgerRows
      : packedRows(tabs, room, 2) +
        (ledgerRows > 1
          ? (count === undefined ? 0 : 1) + ledgerRows + (alerts.length === 0 ? 0 : packedRows([alertsWidth > room ? room + 1 : alertsWidth], room, 1) + (alertsWidth > room ? packedRows(alerts, room, 1) : 0))
          : countWidths.length + ledgerRows + alerts.length === 0
            ? 0
            : alertRows([...countWidths, ...(ledgerRows === 0 ? [] : [othersWidths.reduce((sum, width) => sum + width, 0) + 2 * (others.length - 1)])])) +
        gap * (2 + (item.why !== undefined || item.evidence !== undefined ? 1 : 0))
  const holdWidth = keyWidth('h', isHeld ? 'unhold' : 'hold') + 1
  const statusRows = packedRows([...statusPartsOf(line).map(part => (part.hasGlyph ? 2 : 0) + drawnWidthOf(part.text)), keyWidth('s', detailsLabel(isDetails))], room, 1)
  const fixed = isDetails ? [facts.head, facts.ci, ...facts.rows, ...(facts.clear === undefined ? [] : [facts.clear])] : []
  const fixedRows = fixed.reduce((sum, row) => sum + (row.isWrapped === true ? wrappedRows(row.text, room - 4 - (row.open === undefined ? 0 : drawnWidthOf(row.open.label) + 4)) : 1), 0)
  const inner = room - 2
  const bullets = item.evidence ?? []
  const evidence =
    bullets.length === 0
      ? 0
      : packedRows([keyWidth('e', evidenceLabel(bullets.length, isEvidence))], room, 0) +
        (isEvidence ? bullets.reduce((sum, bullet) => sum + wrappedRows(bullet, inner), 0) : 0)
  const fence = (text: string) => (openFence(text) === undefined ? 0 : 1)
  const drafted =
    (item.draft === undefined ? 0 : fence(item.draft) + wrappedRows(item.draft, inner)) +
    (item.inline ?? []).reduce((sum, comment) => sum + 1 + fence(comment.body) + wrappedRows(comment.body, inner), 0)
  return (
    header +
    (isLegend ? legendRows(room) : 0) +
    wrappedRows(claudeText(item), room - 2) +
    1 +
    packedRows(factsUnits.map(drawnWidthOf), room - 2 - holdWidth, 1) +
    1 +
    statusRows +
    fixedRows +
    (item.why === undefined ? 0 : wrappedRows(item.why, room)) +
    evidence +
    2 +
    drafted
  )
}

// From this many body columns the header takes one row and the counts two; below it, the header two and the
// counts four, laid out so the longest words they can hold (every count unknown) still fit 39 columns.
const WIDE = 80
const CAPTION = 'open PRs, weekly mean, last 16 weeks'
// The trend's colours: its bars as data in the blue that clears 3:1 everywhere, this week's bar and 'now' in the one
// other key that clears 5:1 everywhere, and its direction as a status glyph beside the word (a growing queue is bad).
const BARS_KEY: ThemeKey = 'remember'
const NOW_KEY: ThemeKey = 'autoAccept'
const DIRECTIONS: Record<ReturnType<typeof trendWordOf>, { glyph: string; color: ThemeKey }> = {
  rising: { glyph: '▲', color: 'warning' },
  falling: { glyph: '▼', color: 'success' },
  flat: { glyph: '●', color: 'inactive' },
}

type Chip = { key: string; text: string; isAmber: boolean }

// An amber count carries the warning glyph beside its words; a plain one is words alone.
function chip(ui: Ui, one: Chip): RenderElement {
  const { Box, Text } = ui
  if (!one.isAmber) return <Text key={one.key}>{one.text}</Text>
  return (
    <Box key={`row-${one.key}`} flexDirection="row" columnGap={1}>
      <Text color="warning">▲</Text>
      <Text>{one.text}</Text>
    </Box>
  )
}

// A full-width amber row: cut at its end, or wrapped when it is the view's last word on a failure.
function warnRow(ui: Ui, key: string, text: string, isWrapped = false): RenderElement {
  const { Box, Text } = ui
  return (
    <Box key={`row-${key}`} flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text color="warning">▲</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap={isWrapped ? 'wrap' : 'truncate-end'}>{text}</Text>
      </Box>
    </Box>
  )
}

// A failed queue read: one amber row, its phrase and, when an earlier read is still drawn, that read's time, with y
// beside it; open, the fault's facts under it in grey. Numbers and GitHub's error codes only: never stderr.
function faultRows(ui: Ui, which: 'queue' | 'issues', queue: Queue, isOpen: boolean, actions: Actions): RenderElement[] {
  const { Box, Button, Text } = ui
  const phrase = queue.failed ?? 'GitHub error'
  const fault = queue.fault
  const text = queue.read === undefined ? `${which} unknown: ${phrase}` : `refresh failed${fault === undefined ? '' : ` at ${clockOf(fault.at)}`}: ${phrase} · showing ${clockOf(queue.at)}`
  const row = (
    <Box key="row-failed" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text color="warning">▲</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">{text}</Text>
      </Box>
      {fault !== undefined && (
        <Box flexShrink={0}>
          <Button key="why" label={isOpen ? 'hide' : 'why'} hotkey="y" plain onPress={() => actions.onWhy()} />
        </Box>
      )}
    </Box>
  )
  if (fault === undefined || !isOpen) return [row]
  const run = [fault.exit === undefined ? '' : `gh exit ${fault.exit}`, fault.status === undefined ? '' : `HTTP ${fault.status}`].filter(part => part !== '')
  const lines = [
    `${fault.read} read failed at ${clockOf(fault.at)}`,
    ...(run.length > 0 ? [run.join(' · ')] : []),
    ...(fault.codes === undefined ? [] : [`GitHub: ${fault.codes.join(', ')}`]),
    queue.read === undefined ? 'no good read yet' : `last good read ${clockOf(queue.at)}`,
  ]
  return [
    row,
    ...lines.map((words, i) => (
      <Text key={`why-${i}`} color="inactive" wrap="truncate-end">
        {`  ${words}`}
      </Text>
    )),
  ]
}

// I2: the cursor keys, j and k, plain Buttons whose press asks the hooks module to move the engine's focus ring onto
// the next or previous row; the ring is the cursor, ▸ its drawing.
function moveKeys(ui: Ui, actions: Actions): RenderElement[] {
  const { Button } = ui
  return [
    <Button key="next" label="next" hotkey="j" plain onPress={() => actions.onMove(1)} />,
    <Button key="previous" label="previous" hotkey="k" plain onPress={() => actions.onMove(-1)} />,
  ]
}

// Wide, one row of keys; narrow, the view keys on one row and the legend's key with j/k on the next.
function header(ui: Ui, which: 'queue' | 'issues', hasPair: boolean, isFocused: boolean, isWide: boolean, actions: Actions): RenderElement[] {
  const { Box, Button } = ui
  const other = which === 'queue' ? 'issues' : 'queue'
  const buttons = [
    ...(hasPair ? [<Button key="pair" label="pair" hotkey="p" plain onPress={() => actions.onView('pair')} />] : []),
    <Button key={other} label={other} hotkey={other[0]} plain onPress={() => actions.onView(other)} />,
    <Button key="refresh" label="refresh" hotkey="r" plain onPress={() => actions.onRefresh()} />,
    boardKey(ui, actions),
  ]
  const hint = legendKey(ui, isFocused, actions)
  const moves = moveKeys(ui, actions)
  if (isWide) {
    return [
      <Box key="header" flexDirection="row" columnGap={2}>
        {buttons}
        {moves}
        {hint}
      </Box>,
    ]
  }
  return [
    <Box key="header" flexDirection="row" columnGap={2}>
      {buttons}
    </Box>,
    <Box key="keys" flexDirection="row" columnGap={2}>
      {hint}
      {moves}
    </Box>,
  ]
}

function countRows(ui: Ui, queue: Queue, counts: Counts, isWide: boolean, isReading: boolean): RenderElement[] {
  const { Box, Text } = ui
  const value = (count: number | undefined, word: string, isAsk = false): Chip => ({
    key: word,
    text: told(count, word),
    isAmber: count === undefined || (isAsk && count > 0),
  })
  const line = (key: string, parts: RenderElement[]) => (
    <Box key={key} flexDirection="row" columnGap={2}>
      {parts}
    </Box>
  )
  // Items the read could not place, filed by the board or as new: how many, never which.
  const undecided = counts.undecided
    ? [chip(ui, { key: 'undecided', text: `${counts.undecided} undecided`, isAmber: true })]
    : []
  const [owe, fresh, author, prs, issues] = [
    chip(ui, value(counts.owe, 'owe', true)),
    chip(ui, value(counts.new, 'new', true)),
    chip(ui, value(counts.author, 'author')),
    chip(ui, value(counts.prs, 'PRs')),
    chip(ui, value(counts.issues, 'issues')),
  ]
  const asks = isWide ? [line('counts', [owe, fresh, author, ...undecided])] : [line('counts', [owe, fresh]), line('counts-author', [author, ...undecided])]
  // When the read was made and how many of the board's calls still stand, in grey: GitHub is the source, the board a
  // status page that may lag. A failed read says when it failed, so the row holds in every state.
  const calls = counts.calls ? `${counts.calls} board call${counts.calls === 1 ? '' : 's'}` : undefined
  const when = queue.read === undefined && !isReading ? `refresh failed at ${clockOf(queue.at)}` : asOfText(queue.at, isReading)
  const said = [when, calls].filter(part => part !== undefined)
  const caption = [<Text key="as-of" color="inactive" wrap="truncate-end">{said.join(' · ')}</Text>]
  const unreadable = queue.board === 'unreadable' ? [warnRow(ui, 'no-board', 'board files unreadable')] : []
  if (isWide) return [...asks, line('counts-live', [prs, issues, ...caption]), ...unreadable]
  return [...asks, line('counts-live', [prs, issues]), ...caption, ...unreadable]
}

// The open PRs' weekly means from GitHub: blue bars, this week's bar and 'now' in the second key, the direction's
// glyph and word, then the caption; narrow, the caption takes the next row (with the peak once known), so the trend
// holds its rows whether it is known, unknown or still reading.
function trendRows(ui: Ui, repo: string, trend: Trend | null, queue: Queue, isWide: boolean): RenderElement[] {
  const { Box, Text } = ui
  const below = (words: string) => (
    <Text key="caption" color="inactive" wrap="truncate-end">
      {words}
    </Text>
  )
  const weeks = trend?.repo === repo ? trend.weeks : undefined
  if (weeks === undefined) {
    // The trend needs a good queue read: before one it is unknown for the same reason.
    const failed = trend?.repo === repo ? (trend.failed ?? 'GitHub error') : queue.failed
    const first =
      failed !== undefined ? warnRow(ui, 'trend', `trend unknown: ${failed}`) : <Text key="trend" color="inactive">trend: reading GitHub…</Text>
    return isWide ? [first] : [first, below(CAPTION)]
  }
  const spark = sparkOf(weeks)
  const bars = Array.from(spark.glyphs)
  const word = trendWordOf(weeks)
  const { glyph, color } = DIRECTIONS[word]
  const row = (
    <Box key="row-trend" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text key="spark">
          <Text color={BARS_KEY}>{bars.slice(0, -1).join('')}</Text>
          <Text color={NOW_KEY}>{`${bars.slice(-1).join('')} now ${spark.now}`}</Text>
          {isWide ? ` · peak ${spark.peak}` : ''}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={color}>{glyph}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text>{word}</Text>
      </Box>
      {isWide && (
        <Box flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={1}>
          <Text color="inactive" wrap="truncate-end">
            {CAPTION}
          </Text>
        </Box>
      )}
    </Box>
  )
  return isWide ? [row] : [row, below(`peak ${spark.peak} · ${CAPTION}`)]
}

// I2: column 1 of every focusable row is the cursor's: ▸ on the row the cursor rests on, a space on the rest.
function cursorCell(ui: Ui, isCursor: boolean): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexShrink={0}>
      <Text>{isCursor ? '▸' : ' '}</Text>
    </Box>
  )
}

function queueRow(ui: Ui, repo: string, row: QueueRow, letter: string | undefined, now: number, actions: Actions, isCursor: boolean): RenderElement {
  const { Box, Text, Button } = ui
  const { glyph, color } = GLYPHS[row.tier]
  const url = itemUrl(repo, row.kind, row.number)
  const age = Number.isFinite(row.createdAt) ? ageOf(now - row.createdAt) : ''
  const trailer = [row.note ?? '', age].filter(part => part !== '').join(' · ')
  return (
    <Box key={`row-${row.key}`} flexDirection="row" columnGap={1}>
      {cursorCell(ui, isCursor)}
      <Box flexShrink={0}>
        <Text color={color}>{glyph}</Text>
      </Box>
      <Box flexShrink={0}>
        {url === undefined ? (
          <Text>{`#${row.number}`}</Text>
        ) : (
          <Button
            key={row.key}
            label={`#${row.number}`}
            plain
            {...(letter === undefined ? {} : { hotkey: letter })}
            onPress={() => actions.onDetail({ repo, kind: row.kind === 'pull' ? 'pr' : 'issue', number: row.number })}
          />
        )}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {marked(ui, row.title, { wrap: 'truncate-end' })}
      </Box>
      {trailer !== '' && (
        <Box flexShrink={0}>
          <Text>{trailer}</Text>
        </Box>
      )}
    </Box>
  )
}

// 'Waiting on the author (6)', or '(unknown)'.
const headingOf = (heading: Heading) => `${heading.title} (${heading.count ?? 'unknown'})`

// I2: a collapsible group's heading is a focusable row of its own: the cursor cell, a note glyph, the heading as a
// Button with no letter (j/k, Tab or a click reach it) that Enter or a click toggles, and whether Enter opens or
// closes it. Its rows are drawn under it only while it is open.
function groupRow(ui: Ui, which: GroupView, heading: Heading, isOpen: boolean, isCursor: boolean, actions: Actions): RenderElement {
  const { Box, Text, Button } = ui
  const key = groupKeyOf(heading)
  return (
    <Box key={`row-${key}`} flexDirection="row" columnGap={1}>
      {cursorCell(ui, isCursor)}
      <Box flexShrink={0}>
        <Text color="inactive">○</Text>
      </Box>
      <Box flexShrink={0}>
        <Button key={key} label={headingOf(heading)} plain onPress={() => actions.onToggle(which, key)} />
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color="inactive" wrap="truncate-end">
          {isOpen ? 'enter closes' : 'enter opens'}
        </Text>
      </Box>
    </Box>
  )
}

// I2: the master-detail column beside a list from SIDE_FROM columns: the cursor's item from the queue read at once
// (title, author, age, head, its note), then what the detail read made after the cursor rested (state, CI, size,
// byline, the description's first rows and the latest words' heads). A group row names itself and nothing more.
const SIDE_LINES = 4
const SIDE_ENTRIES = 2

function sideRows(ui: Ui, repo: string, read: QueueRead | undefined, cursor: string | undefined, card: DetailCard | null, now: number, columns: number): RenderElement[] {
  const { Text } = ui
  const note = (key: string, text: string) => (
    <Text key={key} color="inactive" wrap="truncate-end">
      {text}
    </Text>
  )
  if (cursor === undefined) return []
  const row = ROW_KEY.exec(cursor)
  if (row === null) return [note('side-group', 'a group: enter opens or closes it')]
  const [kind, number] = [row[1] === 'pull' ? 'pr' : 'issue', Number(row[2])]
  const item = kind === 'pr' ? read?.prs.find(pr => pr.number === number) : read?.issues.find(issue => issue.number === number)
  const rows: RenderElement[] = []
  if (item !== undefined) {
    rows.push(marked(ui, `#${number} ${item.title}`, { bold: true, wrap: 'truncate-end' }, 'side-title'))
    const pr = kind === 'pr' ? (item as QueueRead['prs'][number]) : undefined
    const facts = [
      pr?.author === undefined ? '' : `@${pr.author}`,
      Number.isFinite(item.createdAt) ? `opened ${ageOf(now - item.createdAt)}` : '',
      pr?.head === undefined ? '' : `head ${pr.head.slice(0, 7)}`,
      pr?.isApproved === true ? 'you approved' : '',
    ].filter(part => part !== '')
    if (facts.length > 0) rows.push(marked(ui, facts.join(' · '), { wrap: 'truncate-end' }, 'side-facts'))
  }
  const own = card?.key === `${keyOf(repo, number)} ${kind}` ? card : null
  if (own === null) return rows
  const detail = own.read
  if (own.failed !== undefined) rows.push(warnRow(ui, 'side-failed', `detail unknown: ${own.failed}`))
  if (detail === undefined) return own.failed === undefined ? [...rows, note('side-reading', 'reading GitHub…')] : rows
  // One glyph a row, as the lint holds every row to: the state, then for a PR its CI with its size.
  rows.push(sideRow(ui, 'state', STATES[detail.state], detail.state))
  const ci = detail.kind === 'pr' ? CI_WORDS[detail.ci ?? 'unknown'] : undefined
  if (ci !== undefined) rows.push(sideRow(ui, 'ci', ci[0], `${ci[1]} · +${detail.additions ?? '?'} −${detail.deletions ?? '?'}`))
  rows.push(marked(ui, bylineOf(detail, now), { wrap: 'truncate-end' }, 'side-byline'))
  const description = detail.description?.value
  if (description !== undefined) {
    const lines = textRows(ui, description, columns, 0, 'side-description')
    rows.push(...lines.slice(0, SIDE_LINES))
    if (lines.length > SIDE_LINES) rows.push(note('side-more', `(${lines.length - SIDE_LINES} more rows: enter opens the detail)`))
  }
  for (const [i, entry] of (detail.latest?.value ?? []).slice(0, SIDE_ENTRIES).entries()) {
    rows.push(sideRow(ui, `entry-${i}`, VERDICTS[entry.kind], `${cutEnd(entry.who, WHO_MAX)}${entry.isBot ? ' bot' : ''} ${entry.kind} ${ageOf(now - entry.at)}`))
  }
  return rows
}

// A side column row: one glyph in its tier's colour, then words cut at the row's end (GitHub's among them, marked).
function sideRow(ui: Ui, key: string, tier: Tier, text: string): RenderElement {
  const { Box } = ui
  return (
    <Box key={`row-side-${key}`} flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{glyph(ui, tier, 'glyph')}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {marked(ui, text, { wrap: 'truncate-end' })}
      </Box>
    </Box>
  )
}

// The queue or the issues of the last repo shown: header, then for the queue its counts and trend, then each
// non-empty heading with its rows. The first 16 rows take a letter; the rest are reached with j/k, Tab and Enter.
// I2: nav is the view's cursor and opened groups; side the master-detail column's read, drawn from SIDE_FROM columns.
// The column is pinned to the window rather than the tree (R3): offset is the window's first row as the hook was
// asked, the column starts that many rows down and holds at most the window's rows, so a list the engine scrolled to
// keep the cursor in view (every row past the eleventh in an inline pane) still shows the card beside it.
export function queueView(
  ui: Ui,
  which: 'queue' | 'issues',
  repo: string | null,
  stored: Queue | null,
  hasPair: boolean,
  now: number,
  isFocused: boolean,
  columns: number,
  rows: number,
  actions: Actions,
  isLegend = false,
  trend: Trend | null = null,
  isReading = false,
  nav: Nav = { expanded: [] },
  side: DetailCard | null = null,
  offset = 0,
  isWhy = false,
): RenderElement {
  const { Box, Text } = ui
  if (repo === null) {
    return (
      <Box flexDirection="column" minHeight={rows}>
        <Text color="inactive">No repository yet: the queue shows the last one a pair named.</Text>
      </Box>
    )
  }
  // I2: the master-detail column takes two fifths of a wide pane, the list the rest, laid out to its own width.
  const sideColumns = columns >= SIDE_FROM ? Math.floor(columns * 0.4) : 0
  const listColumns = sideColumns > 0 ? columns - sideColumns - 2 : columns
  const isWide = listColumns >= WIDE
  const queue: Queue = stored?.repo === repo ? stored : { repo, at: 0, board: 'none' }
  const isWaiting = queue.read === undefined && queue.failed === undefined
  const model = queueModelOf(queue)
  const cursor = cursorOf(focusablesOf(model, which, nav.expanded), nav.cursor)
  const body: RenderElement[] = []
  if (which === 'queue') {
    const counts = model?.counts ?? {}
    // Before the first read nothing is known of the counts or the trend.
    if (!isWaiting) body.push(...countRows(ui, queue, counts, isWide, isReading), ...trendRows(ui, repo, trend, queue, isWide))
  }
  let next = 0
  const rowsOf = (heading: Heading) => heading.rows.map(row => queueRow(ui, repo, row, LETTERS[next++], now, actions, row.key === cursor))
  const sections = (headings: Heading[]) =>
    headings
      .filter(heading => heading.rows.length > 0)
      .flatMap(heading => {
        if (!isCollapsible(which, heading)) {
          return [
            <Text key={`heading-${heading.key}`} bold wrap="truncate-end">
              {headingOf(heading)}
            </Text>,
            ...rowsOf(heading),
          ]
        }
        const key = groupKeyOf(heading)
        const isOpen = nav.expanded.includes(key)
        return [groupRow(ui, which, heading, isOpen, key === cursor, actions), ...(isOpen ? rowsOf(heading) : [])]
      })
  // A failure says so first; a read it kept is drawn under it, as of its own time.
  if (queue.failed !== undefined) body.push(...faultRows(ui, which, queue, isWhy, actions))
  if (model === undefined) {
    if (queue.failed === undefined) body.push(<Text key="reading" color="inactive">reading GitHub…</Text>)
  } else if (which === 'queue') {
    const read = queue.read
    const { counts } = model
    if (read?.prsShort) body.push(warnRow(ui, 'short', `${read.prs.length} of ${read.prTotal} open PRs read`))
    body.push(...sections(model.prs))
    // I2: the parked PRs have a heading now, so the chip keeps the viewer's own and the drafts.
    const rest = [...(counts.yours ? [told(counts.yours, 'yours')] : []), told(counts.draft, 'draft')]
    body.push(chip(ui, { key: 'rest', text: rest.join(' · '), isAmber: rest.some(part => part.endsWith('unknown')) }))
  } else {
    const read = queue.read
    const asOf = asOfText(queue.at, isReading)
    body.push(
      <Box key="total" flexDirection="row" columnGap={2}>
        <Box flexShrink={0}>
          <Text bold>{`Open issues (${read?.issueTotal ?? 'unknown'})`}</Text>
        </Box>
        {asOf !== undefined && (
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color="inactive" wrap="truncate-end">
              {asOf}
            </Text>
          </Box>
        )}
      </Box>,
    )
    if (read?.issuesFailed !== undefined) body.push(warnRow(ui, 'issues-failed', `issues unknown: ${read.issuesFailed}`, true))
    else if (read?.issueTotal !== undefined && read.issues.length < read.issueTotal) {
      body.push(warnRow(ui, 'short', `${read.issues.length} of ${read.issueTotal} issues read`))
    }
    if (read?.refsFailed !== undefined) body.push(warnRow(ui, 'refs-failed', `PR links unknown: ${read.refsFailed}`))
    body.push(...sections(model.issues))
  }
  const list = [...header(ui, which, hasPair, isFocused, isWide, actions), ...attentionLine(ui, attentionOf(queue, now, [])), ...(isLegend ? [legend(ui)] : []), ...body]
  if (sideColumns === 0) {
    return (
      <Box flexDirection="column" minHeight={rows}>
        {list}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" columnGap={2} minHeight={rows}>
      <Box key="list" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {list}
      </Box>
      <Box key="side" flexDirection="column" width={sideColumns} flexShrink={0} marginTop={offset}>
        {sideRows(ui, repo, queue.read, cursor, side, now, sideColumns).slice(0, rows)}
      </Box>
    </Box>
  )
}

// The three layouts, by body columns: the stacked dock under DOCK_TO, the strip to SIDE_FROM, then wide.
export const DOCK_TO = 60
type Fit = 'dock' | 'strip' | 'wide'
const fitOf = (columns: number): Fit => (columns < DOCK_TO ? 'dock' : columns < SIDE_FROM ? 'strip' : 'wide')
// The detail view's glyphs: the item's state, its CI rollup and each review's verdict, each beside its words.
const STATES: Record<DetailRead['state'], Tier> = { open: 'note', draft: 'warn', merged: 'merged', closed: 'bad' }
const CI_WORDS: Record<NonNullable<DetailRead['ci']>, [Tier, string]> = {
  passed: ['ok', 'CI passed'],
  failing: ['bad', 'CI failing'],
  running: ['warn', 'CI running'],
  'not-run': ['warn', 'CI has not run'],
  unknown: ['warn', 'CI unknown'],
}
const VERDICTS: Record<DetailEntry['kind'], Tier> = { APPROVED: 'ok', CHANGES_REQUESTED: 'bad', DISMISSED: 'note', COMMENT: 'note', comment: 'note' }
const WHO_MAX = 16
// I2d: an entry's words sit this many columns in under its head row.
const ENTRY_INDENT = 2
const BACK_KEYS: Record<Detail['from'], string> = { pair: 'p', queue: 'q', issues: 'i' }

// How many rows the legend wraps to: its lines (the glyphs', the pills', the no-pill and the plain-words lines) are
// LEGEND_LINE wide with a gap of 2.
const legendRows = (columns: number) =>
  Math.ceil((LEGEND.length + PILL_LEGEND.length + LEDGER_LEGEND.length + 5) / Math.max(1, Math.floor((columns + 2) / (LEGEND_LINE + 2))))

// At most `max` code points of a path, cut from its start so the file name stays.
function cutStart(text: string, max: number): string {
  const points = Array.from(text)
  return points.length > max ? `…${points.slice(points.length - Math.max(0, max - 1)).join('')}` : text
}

function glyph(ui: Ui, tier: Tier, key: string): RenderElement {
  const { Text } = ui
  const { glyph: mark, color } = GLYPHS[tier]
  return (
    <Text key={key} color={color}>
      {mark}
    </Text>
  )
}

// State, CI and size in one row cut at its end: '○ open  ✓ CI passed  +181 −1'.
function factsLine(ui: Ui, read: DetailRead | undefined, isFailed: boolean): RenderElement {
  const { Text } = ui
  if (read === undefined) {
    return (
      <Text key="facts" color="inactive" wrap="truncate-end">
        {isFailed ? 'state unknown' : 'state not read yet'}
      </Text>
    )
  }
  const ci = read.kind === 'pr' ? CI_WORDS[read.ci ?? 'unknown'] : undefined
  const parts: (string | RenderElement)[] = [glyph(ui, STATES[read.state], 'state'), ` ${read.state}`]
  if (ci !== undefined) parts.push('  ', glyph(ui, ci[0], 'ci'), ` ${ci[1]}`, `  +${read.additions ?? '?'} −${read.deletions ?? '?'}`)
  return (
    <Text key="facts" wrap="truncate-end">
      {parts}
    </Text>
  )
}

function bylineOf(read: DetailRead, now: number): string {
  const labels = read.labels === undefined ? 'labels unknown' : read.labels.names.join(', ') + (read.labels.total > read.labels.names.length ? ` +${read.labels.total - read.labels.names.length}` : '')
  return [
    `@${read.author}${read.isBot ? ' bot' : ''}`,
    Number.isFinite(read.createdAt) ? `opened ${ageOf(now - read.createdAt)}` : '',
    read.kind === 'pr' ? `head ${read.head === undefined ? 'unknown' : read.head.slice(0, 7)}` : '',
    labels,
  ]
    .filter(part => part !== '')
    .join(' · ')
}

// One comment or review's head: '✓ you APPROVED 3h', its who GitHub's, cut at the row's end; its words follow (I2d:
// whole, wrapped two columns in, by textRows).
function entryRow(ui: Ui, entry: DetailEntry, now: number, i: number): RenderElement {
  const { Text } = ui
  return (
    <Text key={`entry-${i}`} wrap="truncate-end">
      {glyph(ui, VERDICTS[entry.kind], 'verdict')}
      {' '}
      {marked(ui, cutEnd(entry.who, WHO_MAX), {}, 'who')}
      {`${entry.isBot ? ' bot' : ''} ${entry.kind} `}
      <Text key="age" color="inactive">
        {ageOf(now - entry.at)}
      </Text>
    </Text>
  )
}

// I2d: a body's lines whole, each wrapped (text.ts wrap) to the columns left after `indent`, one element a terminal
// row so the detail's window counts stay exact; a blank line one blank row; the lines the storage cap left out one
// grey note. Each row keeps truncate-end as a guard: should the engine measure a row wider than wrap did (a spacing
// mark it counts that wrap does not), the row is cut at its edge rather than wrapped again, which would put the
// window out by a row. Markdown is drawn as written.
function textRows(ui: Ui, body: Body, columns: number, indent: number, key: string): RenderElement[] {
  const { Text } = ui
  const lead = ' '.repeat(indent)
  const rows: RenderElement[] = []
  body.lines.forEach((text, i) => {
    if (text === '') {
      rows.push(<Text key={`${key}-line-${i}`}> </Text>)
      return
    }
    wrap(text, columns - indent).forEach((row, j) => rows.push(marked(ui, `${lead}${row}`, { wrap: 'truncate-end' }, `${key}-line-${i}-${j}`)))
  })
  if (body.more > 0) {
    rows.push(
      <Text key={`${key}-more`} color="inactive" wrap="truncate-end">
        {`${lead}(${body.more} more line${body.more === 1 ? '' : 's'})`}
      </Text>,
    )
  }
  return rows
}

// A part's heading: its title, or amber words when this read could not read it (with the time of the one kept).
function partHeading(ui: Ui, key: string, title: string, part: { at: number } | undefined, readAt: number): RenderElement {
  const { Text } = ui
  if (part === undefined) return warnRow(ui, key, `${key} unknown`)
  if (part.at < readAt) return warnRow(ui, key, `${key} unknown, as of ${clockOf(part.at)}`)
  return (
    <Text key={`heading-${key}`} bold wrap="truncate-end">
      {title}
    </Text>
  )
}

function bodyRows(ui: Ui, read: DetailRead, now: number, columns: number): RenderElement[] {
  const { Box, Text } = ui
  const note = (key: string, text: string) => (
    <Text key={key} color="inactive" wrap="truncate-end">
      {text}
    </Text>
  )
  const rows: RenderElement[] = [partHeading(ui, 'description', 'Description', read.description, read.at)]
  const description = read.description?.value
  if (description !== undefined) {
    if (description.lines.length === 0) rows.push(note('no-description', '(no description)'))
    rows.push(...textRows(ui, description, columns, 0, 'description'))
  }
  rows.push(partHeading(ui, 'latest', 'Latest', read.latest, read.at))
  const latest = read.latest?.value
  if (latest !== undefined) {
    if (latest.length === 0) rows.push(note('no-latest', read.kind === 'pr' ? '(no comments or reviews)' : '(no comments)'))
    latest.forEach((entry, i) => rows.push(entryRow(ui, entry, now, i), ...textRows(ui, entry.body, columns, ENTRY_INDENT, `entry-${i}`)))
  }
  if (read.kind === 'issue') return rows
  const files = read.files?.value
  rows.push(partHeading(ui, 'files', `Files (${files?.total ?? 'unknown'})`, read.files, read.at))
  for (const [i, file] of (files?.list ?? []).entries()) {
    const size = `+${file.additions} −${file.deletions}`
    rows.push(
      <Box key={`row-file-${i}`} flexDirection="row" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {marked(ui, cutStart(file.path, Math.max(1, columns - size.length - 1)), { wrap: 'truncate-start' })}
        </Box>
        <Box flexShrink={0}>
          <Text>{size}</Text>
        </Box>
      </Box>,
    )
  }
  if (files !== undefined && files.total > files.list.length) rows.push(note('more-files', `(+${files.total - files.list.length} more)`))
  return rows
}

// One pull request or issue read from GitHub: the keys, the head rows (number and title, state, CI and size, byline)
// fixed at the top, then the description, the latest words and the files, each element one terminal row (I2d: the
// words wrapped whole to the columns), in a window of the rows left that the person scrolls. max: the furthest the
// window goes; a narrower pane makes more rows and the offset is clamped to the new max.
// I2: the detail's neighbours in the list it came from: k with the previous item's number, j with the next's, each a
// Button only while there is one (a grey dash at the list's end), and 'N of M in <group>'.
function walkKeys(ui: Ui, walk: Walk | undefined, actions: Actions): { keys: RenderElement[]; position: RenderElement[] } {
  const { Text, Button } = ui
  if (walk === undefined) return { keys: [], position: [] }
  // I2 (prove fix): the two keys stay bound at the list's ends, as inert Buttons with a dash: a key the pane does not
  // bind falls through to the prompt and takes the focus with it (seen live on 2.1.296: j on the last item typed j
  // into the composer), and j/k are the grammar in every view.
  const keys = [
    walk.previous === undefined ? (
      <Button key="detail-previous" label="‹ —" hotkey="k" plain onPress={() => undefined} />
    ) : (
      <Button key="detail-previous" label={`‹ #${walk.previous.number}`} hotkey="k" plain onPress={() => actions.onMove(-1)} />
    ),
    walk.next === undefined ? (
      <Button key="detail-next" label="— ›" hotkey="j" plain onPress={() => undefined} />
    ) : (
      <Button key="detail-next" label={`#${walk.next.number} ›`} hotkey="j" plain onPress={() => actions.onMove(1)} />
    ),
  ]
  const position = [
    <Text key="position" color="inactive" wrap="truncate-end">
      {`${walk.index + 1} of ${walk.count} in ${walk.group}`}
    </Text>,
  ]
  return { keys, position }
}

export function detailView(
  ui: Ui,
  detail: Detail,
  card: DetailCard | null,
  now: number,
  isFocused: boolean,
  columns: number,
  rows: number,
  actions: Actions,
  isLegend = false,
  isReading = false,
  queue: Queue | null = null,
  walk: Walk | undefined = undefined,
): { tree: RenderElement; max: number; room: number } {
  const { Box, Text, Button } = ui
  const isWide = columns >= WIDE
  const read = card?.read
  const failed = card?.failed
  // I1: the queue's pills and this item's own (NOT READ, MERGED, CI FAILED), one row among the header's.
  const own = detailPillOf(card, now)
  const attention = attentionLine(ui, attentionOf(queue?.repo === detail.repo ? queue : null, now, own === undefined ? [] : [own]))
  const url = itemUrl(detail.repo, detail.kind === 'issue' ? 'issues' : 'pull', detail.number)
  const buttons = [
    ...(url === undefined ? [] : [<Button key="detail-open" label="open" hotkey="o" plain onPress={press => actions.onOpen(url, press.surface)} />]),
    <Button key="detail-back" label="back" hotkey={BACK_KEYS[detail.from]} plain onPress={() => actions.onBack()} />,
    boardKey(ui, actions),
    <Button key="detail-refresh" label="refresh" hotkey="r" plain onPress={() => actions.onRefresh()} />,
  ]
  const hint = legendKey(ui, isFocused, actions)
  // I2: wide, the neighbours and the position join the one key row; narrow, they take the hint's row.
  const { keys, position } = walkKeys(ui, walk, actions)
  const header = isWide
    ? [
        <Box key="header" flexDirection="row" columnGap={2}>
          {buttons}
          {keys}
          {position}
          {hint}
        </Box>,
        ...attention,
      ]
    : [
        <Box key="header" flexDirection="row" columnGap={2}>
          {buttons}
          {keys}
        </Box>,
        <Box key="keys" flexDirection="row" columnGap={2}>
          {hint}
          {position}
        </Box>,
        ...attention,
      ]
  const titleText = read !== undefined ? `#${detail.number} ${read.title}` : `#${detail.number} ${failed === undefined ? 'reading GitHub…' : 'title unknown'}`
  const title = marked(ui, titleText, { wrap: 'truncate-end', bold: true, ...(read === undefined ? { color: 'inactive' as const } : {}) }, 'title')
  const titled = isWide
    ? [
        <Box key="row-title" flexDirection="row" columnGap={2}>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {title}
          </Box>
          <Box flexShrink={0}>{factsLine(ui, read, failed !== undefined)}</Box>
        </Box>,
      ]
    : [title, factsLine(ui, read, failed !== undefined)]
  const asOf = asOfText(read?.at, isReading)
  const byline =
    read === undefined ? (
      <Text key="byline" color="inactive" wrap="truncate-end">
        {isReading ? 'refreshing' : failed === undefined ? '…' : 'author unknown'}
      </Text>
    ) : (
      <Box key="byline" flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {marked(ui, bylineOf(read, now), { wrap: 'truncate-end' })}
        </Box>
        {asOf !== undefined && (
          <Box flexShrink={0}>
            <Text color="inactive">{asOf}</Text>
          </Box>
        )}
      </Box>
    )
  const fixed = [
    ...header,
    ...(isLegend ? [legend(ui)] : []),
    ...titled,
    byline,
    ...(failed === undefined ? [] : [warnRow(ui, 'failed', `detail unknown: ${failed}${read === undefined ? '' : `, as of ${clockOf(read.at)}`}`)]),
  ]
  const fixedRows = header.length + (isLegend ? legendRows(columns) : 0) + titled.length + 1 + (failed === undefined ? 0 : 1)
  const body = read === undefined ? [] : bodyRows(ui, read, now, columns)
  const room = Math.max(1, rows - fixedRows)
  const max = Math.max(0, body.length - room)
  const offset = Math.min(Math.max(0, detail.scroll), max)
  // One row taller than the pane: the engine raises an arrow's ui.scroll only while it has a row to scroll, and a tree
  // exactly the pane's height gave it none (page keys are raised regardless). The hook answers every event itself, so
  // the engine's own window never moves and the spare row is never seen.
  return {
    tree: (
      <Box flexDirection="column" minHeight={rows + 1}>
        {fixed}
        {body.slice(offset, offset + room)}
      </Box>
    ),
    max,
    room,
  }
}
