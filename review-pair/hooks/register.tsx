import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { Card, Cursor, Detail, DetailCard, Expanded, Fault, GroupView, InlineComment, IssueRead, LedgerEntry, ListView, Pair, PairItem, Phrase, PrRead, Queue, QueueRead, RunFacts, Trend, Verb, View } from '../types'
import {
  BOARD_REPO,
  BOARD_URL,
  CARD,
  DETAIL_ISSUE,
  DETAIL_PR,
  GH_TIMEOUT_MS,
  HEAD,
  ISSUE,
  ISSUES,
  OPEN_TIMEOUT_MS,
  REFS,
  REPO,
  SKILLS,
  STALE_MS,
  TREND_PAGES,
  VIEWER_ARGS,
  alertsOf,
  answerOf,
  basisOf,
  boardOf,
  cardOf,
  changesOf,
  dayOf,
  detailOf,
  runFactsOf,
  ghArgs,
  isCount,
  isItemUrl,
  isLogUrl,
  issueOf,
  loginOf,
  mcpWriteOf,
  mergeDetail,
  partialOf,
  queueArgs,
  queueModelOf,
  queueReadOf,
  repoArgs,
  statusOf,
  trendArgs,
  trendPageOf,
  weeksOf,
  writesOf,
  type Span,
  type Write,
} from './github'
import { canonicalText, clean, textHashOf } from './text'
import { GROUP_KEY, ROW_KEY, SIDE_FROM, cursorOf, detailView, focusablesOf, isCursorKey, keyOf, pairView, queueView, walkOf, type Actions, type Neighbour, type Ui, type Walk } from './views'

const PANE = 'review-pair'
const TOOL = 'mcp__review-pair__show'
// A turn's end refreshes the cards at most this often; r forces.
const CARD_EVERY = 20_000
// While the pane is placed and shown, its cards or its queue are read this often.
const POLL_EVERY = 60_000
// The queue is read at most this often for a view or the status line; r forces.
const QUEUE_EVERY = 60_000
// The trend is worked out at most this often per repo, and again on a new UTC day; r forces.
const TREND_EVERY = 3_600_000
// The $.store keys: the last repo a show call named, for /review-pair with no pair, each repo's last trend, and when the
// board's standing calls were first seen.
const REPO_KEY = 'repo'
const CALLS_KEY = 'board calls'
// I2: the list views' cursors, mirrored so classic.SessionStart can put them back after /clear empties $.state.
const CURSOR_KEY = 'cursor'
const trendKey = (repo: string) => `trend ${repo}`
// I2: the master-detail column reads the cursor's item only once the cursor has rested this long.
const SIDE_REST_MS = 600

const DESCRIPTION =
  'Shows the pull requests or issues you are asking the user to approve in a pane on the right of their ' +
  'terminal, beside their live GitHub state. Call it just before you print drafts for the user, a new pair ' +
  'or a revised one, with the exact texts you print. When the batch is done, call it with items: [] to clear ' +
  'the pair: the pane stays open and shows that repository\'s queue.'

const SCHEMA = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name, such as The-PR-Agent/pr-agent' },
    left: { type: 'integer', minimum: 0, description: 'How many items of the batch remain after these' },
    items: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer', minimum: 1 },
          kind: { type: 'string', enum: ['pr', 'issue'], description: 'issue for an issue; left out means a pull request' },
          action: { type: 'string', description: 'What the user says yes to, such as "approve and merge"' },
          confidence: { type: 'integer', minimum: 0, maximum: 10 },
          contributorActs: { type: 'boolean', description: 'Whether the contributor has to change anything' },
          why: { type: 'string', description: 'One or two plain sentences of reasoning' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'The evidence bullets you print under the item, verbatim, one per string' },
          draft: { type: 'string', description: 'The exact review or reply body, verbatim' },
          inline: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, line: { type: 'integer' }, body: { type: 'string' } },
              required: ['path', 'line', 'body'],
            },
          },
          head: { type: 'string', description: 'The head SHA the review was made against' },
          verb: { type: 'string', enum: ['pending', 'comment', 'approve', 'approve-merge', 'request-changes', 'close'], description: 'What posting this draft would do; the pane never parses action' },
          sensitive: { type: 'boolean', description: 'true when the maintainer must type the approval himself' },
        },
        required: ['number', 'action'],
      },
    },
  },
  required: ['repo', 'items'],
}

const pair = atom({ plugin: 'review-pair', key: 'pair' } as const, null)
const cards = atom({ plugin: 'review-pair', key: 'cards' } as const, {})
const tab = atom({ plugin: 'review-pair', key: 'tab' } as const, 0)
const dismissed = atom({ plugin: 'review-pair', key: 'dismissed' } as const, false)
const toasted = atom({ plugin: 'review-pair', key: 'toasted' } as const, false)
const view = atom({ plugin: 'review-pair', key: 'view' } as const, 'pair' as View)
const shownRepo = atom({ plugin: 'review-pair', key: 'repo' } as const, null as string | null)
const queue = atom({ plugin: 'review-pair', key: 'queue' } as const, null as Queue | null)
// I2e: whether this session runs maintainer duty. The mod loads in every session on the machine and the store's repo
// is machine-wide, so until a show call, the Skill tool naming pr-maintainer, the skill's own prompt or /review-pair
// arms it, the mod is dormant here: no read, no status line, no poll. False at the start, as /clear leaves it.
const armed = atom({ plugin: 'review-pair', key: 'armed' } as const, false)
// Bash and github.ts's WRITE_TOOLS, written out so validate lists them; an anchored alternation of fixed names (no
// quantifier over a group), and a regex so the hook does not depend on the MCP servers the editor's types knew.
const WRITTEN_BY =
  /^(Bash|mcp__plugin_github_github__(merge_pull_request|pull_request_review_write|update_pull_request|update_pull_request_branch|add_reply_to_pull_request_comment|add_issue_comment|issue_write))$/

const legendOpen = atom({ plugin: 'review-pair', key: 'legend' } as const, false)
const whyOpen = atom({ plugin: 'review-pair', key: 'why' } as const, false)
const evidenceOpen = atom({ plugin: 'review-pair', key: 'evidence' } as const, [] as string[])
const detailsOpen = atom({ plugin: 'review-pair', key: 'details' } as const, [] as string[])
// The item the detail view shows and its read, kept only while it shows.
const detail = atom({ plugin: 'review-pair', key: 'detail' } as const, null as Detail | null)
const detailCard = atom({ plugin: 'review-pair', key: 'detailCard' } as const, null)
const trend = atom({ plugin: 'review-pair', key: 'trend' } as const, null as Trend | null)
const refreshing = atom({ plugin: 'review-pair', key: 'refreshing' } as const, false)
// I2: each list view's cursor row and opened groups, and the master-detail column's read of the cursor's item.
const cursor = atom({ plugin: 'review-pair', key: 'cursor' } as const, {} as Cursor)
const expanded = atom({ plugin: 'review-pair', key: 'expanded' } as const, { queue: [], issues: [] } as Expanded)
const side = atom({ plugin: 'review-pair', key: 'side' } as const, null as DetailCard | null)
// I5: the decision ledger (types LedgerEntry): written by each show, a seen draft, h, a card read and a write of Claude's.
const ledger = atom({ plugin: 'review-pair', key: 'ledger' } as const, {} as Record<string, LedgerEntry>)
const LEDGER_MAX = 40
const VERBS: readonly Verb[] = ['pending', 'comment', 'approve', 'approve-merge', 'request-changes', 'close']

// Module variables start over on a reload, which costs one more measurement, refresh or gh --version at most.
let isFullscreen: boolean | undefined
let refreshedAt = 0
// One read per item in flight: presses, turn ends, polls and show calls while it runs share it. A write of
// Claude's that lands while one runs asks for one more read after it, once however many land.
const itemFlights = new Map<string, Promise<void>>()
const rereads = new Set<string>()
// I1: the flights a write of Claude's asked for, by flight key: the read that starts for one is marked posted (the
// POSTED pill for that one read). A read already running when the write landed never is: its follow-up takes the mark.
const posted = new Set<string>()
// The poll: one timer per module, running while the pane is open; it reads only while the pane is placed and shown.
let pollTimer: Timer | undefined
// I2e review R1: bumped by /review-pair off. A read awaited inside a command's own invocation reads that invocation's
// view of $.state when it lands (every get of one dispatch reads one moment), so its shownRepo check cannot see the
// off that ran meanwhile; module variables are shared across invocations, so a read begun under an older epoch
// lands nowhere.
let epoch = 0
// One timer per refresh: it redraws the pane when the read turns five minutes old.
let staleTimer: Timer | undefined
let staleFor = 0
let ghCheck: Promise<boolean> | undefined
// The viewer's login, read once per session; a failed read is tried again with the next queue read.
let viewer: Promise<{ login: string } | { failed: Phrase }> | undefined
// One queue read per repo in flight, and when the last one started: the status line's throttle.
const queueFlights = new Map<string, Promise<void>>()
let queueReadAt = 0
// One detail read per item in flight; the key of the row to bring back into view on the first drawing after back; how
// far the detail's own window goes, from its last drawing.
const detailFlights = new Map<string, Promise<void>>()
// One trend read per repo in flight, and the one r press in flight, which a press while it runs joins.
const trendFlights = new Map<string, Promise<void>>()
let refreshFlight: Promise<void> | undefined
let revealKey: string | undefined
let detailMax = 0
let detailRoom = 1
// A reveal refused because its row is not drawn yet is tried once more after this long.
const REVEAL_RETRY_MS = 100
// I2: the pane's body columns as last drawn, which say whether the master-detail column shows (never an assumed
// share: a profile keeps a dragged dock width); the rest timer before its read; the one read in flight.
let lastColumns = 0
let sideTimer: Timer | undefined
let sideFlight: Promise<void> | undefined

const textOf = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? clean(value) : undefined)

// The boundary: the show tool's input is checked once, here, and refused whole when any part is off.
function itemOf(raw: unknown, seen: Set<number>): PairItem | string {
  if (raw === null || typeof raw !== 'object') return 'each item must be an object.'
  const { number, action, kind, confidence, contributorActs, why, evidence, draft, inline, head, verb, sensitive } = raw as Record<string, unknown>
  if (!isCount(number)) return 'each item needs a number.'
  if (seen.has(number)) return `#${number} is listed twice.`
  seen.add(number)
  const label = textOf(action)
  if (label === undefined) return `#${number} needs an action.`
  const item: PairItem = { number, action: label }
  if (kind !== undefined && kind !== 'pr' && kind !== 'issue') return `#${number} kind must be pr or issue.`
  if (kind === 'pr' || kind === 'issue') item.kind = kind
  if (confidence !== undefined) {
    if (typeof confidence !== 'number' || !Number.isInteger(confidence) || confidence < 0 || confidence > 10) return `#${number} confidence must be 0 to 10.`
    item.confidence = confidence
  }
  if (contributorActs !== undefined) {
    if (typeof contributorActs !== 'boolean') return `#${number} contributorActs must be true or false.`
    item.contributorActs = contributorActs
  }
  if (head !== undefined) {
    const sha = typeof head === 'string' ? head.trim().toLowerCase() : ''
    if (!HEAD.test(sha)) return `#${number} head must be 7 to 40 hex characters.`
    item.head = sha
  }
  // I5: the verb is one of six fixed words, compared whole; sensitive a boolean.
  if (verb !== undefined) {
    const known = VERBS.find(one => one === verb)
    if (known === undefined) return `#${number} verb must be pending, comment, approve, approve-merge, request-changes or close.`
    item.verb = known
  }
  if (sensitive !== undefined) {
    if (typeof sensitive !== 'boolean') return `#${number} sensitive must be true or false.`
    item.sensitive = sensitive
  }
  const [reason, body] = [textOf(why), textOf(draft)]
  if (reason !== undefined) item.why = reason
  if (body !== undefined) item.draft = body
  if (evidence !== undefined) {
    if (!Array.isArray(evidence)) return `#${number} evidence must be a list.`
    const bullets: string[] = []
    for (const one of evidence) {
      const text = textOf(one)
      if (text === undefined) return `#${number} evidence must be a list of visible strings.`
      bullets.push(text)
    }
    if (bullets.length > 0) item.evidence = bullets
  }
  if (inline !== undefined) {
    if (!Array.isArray(inline)) return `#${number} inline must be a list.`
    const comments: InlineComment[] = []
    for (const one of inline as Partial<InlineComment>[]) {
      const [path, text] = [textOf(one?.path), textOf(one?.body)]
      if (path === undefined || text === undefined || !isCount(one?.line)) return `#${number} inline comments need a path, a line and a body.`
      comments.push({ path, line: one.line, body: text })
    }
    if (comments.length > 0) item.inline = comments
  }
  return item
}

function pairOf(input: Record<string, unknown>): Pair | string {
  const { repo, items, left } = input
  if (typeof repo !== 'string' || !REPO.test(repo)) return 'repo must be owner/name.'
  if (!Array.isArray(items) || items.length < 1 || items.length > 4) return 'items must be a list of one to four.'
  if (left !== undefined && !(typeof left === 'number' && Number.isSafeInteger(left) && left >= 0)) return 'left must be a whole number.'
  const seen = new Set<number>()
  const parsed: PairItem[] = []
  for (const raw of items) {
    const item = itemOf(raw, seen)
    if (typeof item === 'string') return item
    parsed.push(item)
  }
  return typeof left === 'number' ? { repo, items: parsed, left } : { repo, items: parsed }
}

// I5: the ledger with one entry written and put last, as the most recently touched; the oldest past LEDGER_MAX go.
function touch(book: Record<string, LedgerEntry>, key: string, entry: LedgerEntry): Record<string, LedgerEntry> {
  const rest = Object.entries(book).filter(([one]) => one !== key)
  return Object.fromEntries([...rest.slice(Math.max(0, rest.length - LEDGER_MAX + 1)), [key, entry]])
}

// I5: a seen entry loses its seen mark and is changed, from now.
function changedEntry(entry: LedgerEntry, now: number): LedgerEntry {
  const next: LedgerEntry = { ...entry, changedAt: now }
  delete next.seenAt
  delete next.seenHash
  delete next.seenHead
  return next
}

// I5: what a show writes for one item: the facts it gives in place of the last show's, the marks kept. An item seen
// under another hash, or under another head than the last show gave, is changed since the viewer looked. Review S2: a head the viewer
// looked at is no change, whichever show gave it: the push came before the look. Heads match only as the same hex
// (security review: a pushed commit can match a 7-hex prefix, so a short head never proves a full one unmoved, and the
// doubt reads as changed).
function shownEntry(old: LedgerEntry | undefined, repo: string, item: PairItem, now: number): LedgerEntry {
  const next: LedgerEntry = { ...old, repo, number: item.number, shownAt: now }
  delete next.verb
  delete next.textHash
  delete next.head
  if (item.verb !== undefined) next.verb = item.verb
  if (item.textHash !== undefined) next.textHash = item.textHash
  if (item.head !== undefined) next.head = item.head
  const isChanged = old?.seenAt !== undefined && (item.textHash !== old.seenHash || (item.head !== old.head && item.head !== old.seenHead))
  return isChanged ? changedEntry(next, now) : next
}

// Whether gh is on PATH, asked once per session and only after a call was refused before it ran.
function hasGh($: EngineInterface): Promise<boolean> {
  ghCheck ??= $.process.run(['gh', '--version'], { timeoutMs: GH_TIMEOUT_MS }).then(
    () => true,
    () => false,
  )
  return ghCheck
}

// One read-only gh call. A refusal carries the engine's words, which go nowhere: it is told by how long it took. A run
// that failed carries its facts too (runFactsOf), for the pane's y.
async function gh($: EngineInterface, args: string[], parse = answerOf): Promise<{ json: unknown } | { failed: Phrase; facts?: RunFacts }> {
  const startedAt = await $.clock.now()
  try {
    const run = await $.process.run(['gh', ...args], { timeoutMs: GH_TIMEOUT_MS })
    const answer = parse(run.exitCode, run.stdout, run.stderr)
    return 'failed' in answer ? { ...answer, facts: runFactsOf(run.exitCode, run.stdout, run.stderr) } : answer
  } catch {
    if ((await $.clock.now()) - startedAt >= GH_TIMEOUT_MS) return { failed: 'GitHub timed out' }
    return { failed: (await hasGh($)) ? 'GitHub error' : 'gh not found on PATH' }
  }
}

async function readOne($: EngineInterface, repo: string, item: PairItem, readAt: number): Promise<PrRead | IssueRead | Phrase> {
  const args = ghArgs(item.kind === 'issue' ? ISSUE : CARD, repo, item.number)
  if (args === undefined) return 'GitHub error'
  const answer = await gh($, args)
  if ('failed' in answer) return answer.failed
  return item.kind === 'issue' ? issueOf(answer.json, readAt) : cardOf(answer.json, repo, item.number, readAt)
}

async function armStale($: EngineInterface, readAt: number) {
  // A slower refresh of an earlier read must not replace the timer of a later one.
  if (readAt < staleFor) return
  staleFor = readAt
  const now = await $.clock.now()
  staleTimer?.cancel()
  staleTimer = $.clock.after(Math.max(0, readAt + STALE_MS - now), () => $.ui.invalidate('ui.render'))
}

// Whether the pair on screen still holds this item: a read or a toast for one it no longer shows is dropped.
async function isInPair($: EngineInterface, repo: string, number: number): Promise<boolean> {
  const current = await read($, pair)
  return current !== null && current.repo === repo && current.items.some(one => one.number === number)
}

// One card, uncached. A failed read keeps the last good one, marked as failed. A refresh (a poll, a press, a turn
// end, a write) whose good read differs from the basis toasts each change in fixed words and the number, while the
// item is still shown; a show call's read never toasts, being the new pair's first.
async function readCard($: EngineInterface, repo: string, item: PairItem, isToasting: boolean, isPosted = false): Promise<void> {
  const readAt = await $.clock.now()
  refreshedAt = readAt
  const started = epoch
  const got = await readOne($, repo, item, readAt)
  if (started !== epoch) return
  const key = keyOf(repo, item.number)
  let basis: Card['basis']
  let isLanded = false
  await update($, cards, old => {
    const card = old[key]
    // A read that started later has landed already: it stands.
    isLanded = card?.read === undefined || card.read.at <= readAt
    if (!isLanded) return old
    basis = card?.basis ?? card?.read
    const next: Card = typeof got !== 'string' ? { read: got, basis: basisOf(basis, got) } : card?.read === undefined ? { failed: got } : { ...card, failed: got }
    if (typeof got !== 'string' && isPosted) next.posted = true
    return { ...old, [key]: next }
  })
  if (isToasting && isLanded && basis !== undefined && typeof got !== 'string' && (await isInPair($, repo, item.number))) {
    for (const change of changesOf(basis, got)) $.ui.toast(`review-pair: #${item.number} ${change}`)
  }
  // I5: a live head other than the one the viewer looked at marks a seen item changed.
  if (isLanded && typeof got !== 'string' && got.kind === 'pr' && got.head !== '') {
    const live = got.head
    await update($, ledger, book => {
      const entry = book[key]
      if (entry?.seenAt === undefined || entry.seenHead === undefined || live === entry.seenHead) return book
      return touch(book, key, changedEntry(entry, readAt))
    })
  }
  await armStale($, readAt)
}

const flightOf = (repo: string, item: PairItem) => `${keyOf(repo, item.number)} ${item.kind ?? 'pr'}`

function refreshItem($: EngineInterface, repo: string, item: PairItem, isToasting = true): Promise<void> {
  const key = flightOf(repo, item)
  const running = itemFlights.get(key)
  if (running !== undefined) return running
  const done = readCard($, repo, item, isToasting, posted.delete(key)).finally(() => {
    itemFlights.delete(key)
    if (rereads.delete(key)) void followUp($, repo, item)
  })
  itemFlights.set(key, done)
  return done
}

// The read a write asked for while one ran: only for an item the shown pair still holds, with the pane on screen.
async function followUp($: EngineInterface, repo: string, item: PairItem) {
  if ((await isInPair($, repo, item.number)) && (await isShown($))) await refreshItem($, repo, item)
}

// Every card of the pair at once.
async function refresh($: EngineInterface, current: Pair, isToasting = true): Promise<void> {
  await Promise.all(current.items.map(item => refreshItem($, current.repo, item, isToasting)))
}

// After a write of Claude's: a read already running may have started before the write landed, so one follows it.
function rereadItem($: EngineInterface, repo: string, item: PairItem) {
  const key = flightOf(repo, item)
  if (itemFlights.has(key)) rereads.add(key)
  else void refreshItem($, repo, item)
}

async function refreshPair($: EngineInterface) {
  const current = await read($, pair)
  if (current !== null && REPO.test(current.repo)) await refresh($, current)
}

const isShown = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
// I2e: a pane still placed across /clear or a hot reload says duty was running in this session.
const isPlaced = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// Only a pane on screen is refreshed: a hidden or background one costs nothing.
async function refreshShown($: EngineInterface) {
  if (!(await isShown($))) return
  startPoll($)
  const which = await read($, view)
  if (which === 'pair') await refreshPair($)
  else if (which === 'detail') await refreshShownDetail($)
  else await queueIfStale($)
}

function startPoll($: EngineInterface) {
  pollTimer ??= $.clock.every(POLL_EVERY, () => void poll($))
}

function stopPoll() {
  pollTimer?.cancel()
  pollTimer = undefined
}

// Each period: the shown pair's cards, the shown detail, or the queue under the queue and issues views. A pane behind
// another tab or waiting undrawn skips the period, since showing it again raises no drawing that could restart the
// timer; only a pane gone stops it (ui.close and /review-pair stop it too).
async function poll($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane === undefined) return stopPoll()
  if (!pane.isPlaced || !pane.isShown) return
  const which = await read($, view)
  if (which === 'pair') await refreshPair($)
  else if (which === 'detail') await refreshShownDetail($)
  else await forceQueue($)
}

// A write of Claude's that names the shown pair's repo and one of its numbers re-reads that item at once. I5: and marks
// it written in the ledger, whether or not the pane is on screen. Review S4: not a write the engine answered as an
// error (a non-zero exit, a throw, an interruption), which may have reached nothing; its card is still re-read.
async function afterWrite($: EngineInterface, writes: Write[], isFailed: boolean) {
  const [current, isUp, now] = await Promise.all([read($, pair), isShown($), $.clock.now()])
  if (current === null) return
  const repo = current.repo.toLowerCase()
  const named = current.items.filter(item => writes.some(write => write.repo?.toLowerCase() === repo && write.number === item.number))
  if (named.length === 0) return
  await update($, ledger, book => {
    let next = book
    for (const item of named) {
      const key = keyOf(current.repo, item.number)
      const entry = next[key]
      if (entry !== undefined && !isFailed) next = touch(next, key, { ...entry, writtenAt: now })
    }
    return next
  })
  if (!isUp) return
  for (const item of named) {
    posted.add(flightOf(current.repo, item))
    rereadItem($, current.repo, item)
  }
}

// I5: the shown tab's item was seen: its tab in the focused, placed pane with its draft's end in view, or it has no
// draft. Once per look: an entry already seen is left as it is, so the drawings that follow write nothing. The head
// the viewer looked at is the card's live one, or the head as given before any read. Review S5: `drawn` is the item as it was
// drawn; a show that landed since gave the entry facts the viewer never saw, so nothing is written.
async function markSeen($: EngineInterface, repo: string, number: number, drawn: PairItem) {
  const key = keyOf(repo, number)
  const [now, known] = await Promise.all([$.clock.now(), read($, cards)])
  const live = known[key]?.read
  const liveHead = live?.kind === 'pr' && live.head !== '' ? live.head : undefined
  await update($, ledger, book => {
    const entry = book[key]
    if (entry === undefined || entry.seenAt !== undefined || entry.textHash !== drawn.textHash || entry.head !== drawn.head) return book
    const next: LedgerEntry = { ...entry, seenAt: now }
    delete next.changedAt
    if (entry.textHash !== undefined) next.seenHash = entry.textHash
    const seenHead = liveHead ?? entry.head
    if (seenHead !== undefined) next.seenHead = seenHead
    return touch(book, key, next)
  })
}

// I5: the pair view's window reached the tree's end: the shown tab's item is seen while the pane holds the keys.
async function seenByScroll($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  const [current, chosen] = await Promise.all([read($, pair), read($, tab)])
  const item = current?.items[Math.min(chosen, current.items.length - 1)]
  if (pane?.isPlaced === true && pane.isFocused && current !== null && item !== undefined) await markSeen($, current.repo, item.number, item)
}

// I5: h on the pair view: the shown tab's item held, or no longer. A mark only.
async function toggleHold($: EngineInterface) {
  const [current, chosen] = await Promise.all([read($, pair), read($, tab)])
  const item = current?.items[Math.min(chosen, current.items.length - 1)]
  if (current === null || item === undefined) return
  const key = keyOf(current.repo, item.number)
  await update($, ledger, book => {
    const entry = book[key]
    if (entry === undefined) return book
    const next: LedgerEntry = { ...entry }
    if (next.held === true) delete next.held
    else next.held = true
    return touch(book, key, next)
  })
}

// The shown tab's item key, for e and s.
async function shownKeyOf($: EngineInterface): Promise<string | undefined> {
  const [current, chosen] = await Promise.all([read($, pair), read($, tab)])
  const item = current?.items[Math.min(chosen, current.items.length - 1)]
  return current === null || item === undefined ? undefined : keyOf(current.repo, item.number)
}

const toggled = (open: string[], key: string) => (open.includes(key) ? open.filter(one => one !== key) : [...open, key])

// e on the pair view: the shown tab's evidence opened under its reason, or closed again.
async function toggleEvidence($: EngineInterface) {
  const key = await shownKeyOf($)
  if (key !== undefined) await update($, evidenceOpen, open => toggled(open, key))
}

// s on the pair view: the shown tab's status rows opened under its status line, or closed again.
async function toggleDetails($: EngineInterface) {
  const key = await shownKeyOf($)
  if (key !== undefined) await update($, detailsOpen, open => toggled(open, key))
}

async function askViewer($: EngineInterface): Promise<{ login: string } | { failed: Phrase; facts?: RunFacts }> {
  const answer = await gh($, VIEWER_ARGS)
  if ('failed' in answer) return answer
  const login = loginOf(answer.json)
  return login === undefined ? { failed: 'GitHub error' } : { login }
}

function viewerOf($: EngineInterface): Promise<{ login: string } | { failed: Phrase; facts?: RunFacts }> {
  viewer ??= askViewer($).then(answer => {
    if ('failed' in answer) viewer = undefined
    return answer
  })
  return viewer
}

type Failed = Omit<Fault, 'at'>

async function prsReadOnce($: EngineInterface, repo: string): Promise<{ login: string; json: unknown } | Failed> {
  const who = await viewerOf($)
  if ('failed' in who) return { phrase: who.failed, read: 'viewer', ...who.facts }
  const args = queueArgs(repo, who.login)
  if (args === undefined) return { phrase: 'GitHub error', read: 'viewer' }
  const answer = await gh($, args)
  return 'failed' in answer ? { phrase: answer.failed, read: 'pull requests', ...answer.facts } : { login: who.login, json: answer.json }
}

// The pull requests, the issues and their cross-references, read side by side: a failed issues read costs only the
// issues, a failed pull request read the whole queue.
async function queueReadOnce($: EngineInterface, repo: string): Promise<QueueRead | Failed> {
  const read = (document: string) => {
    const args = repoArgs(document, repo)
    return args === undefined ? Promise.resolve({ failed: 'GitHub error' as const }) : gh($, args)
  }
  const [prs, issues, refs] = await Promise.all([prsReadOnce($, repo), read(ISSUES), read(REFS)])
  if ('phrase' in prs) return prs
  const got = queueReadOf(prs.json, prs.login, repo, issues, refs)
  return typeof got === 'string' ? { phrase: got, read: 'pull requests' } : got
}

// The board's two files of human calls and when each was last written, for its own repo only and only when
// REVIEW_PAIR_BOARD_DIR names their folder; when each standing call was first seen is kept in $.store, and a store that
// refuses leaves the files' times.
async function boardRead($: EngineInterface, repo: string): Promise<Queue['board']> {
  if (repo.toLowerCase() !== BOARD_REPO.toLowerCase()) return 'none'
  const dir = await $.env.get('REVIEW_PAIR_BOARD_DIR')
  if (dir === undefined || dir === '') return 'none'
  let read: [string, string, number, number]
  try {
    const [buckets, chase, bucketsStat, chaseStat] = await Promise.all([
      $.fs.read(`${dir}/buckets.json`),
      $.fs.read(`${dir}/chase.json`),
      $.fs.stat(`${dir}/buckets.json`),
      $.fs.stat(`${dir}/chase.json`),
    ])
    read = [buckets, chase, bucketsStat.mtimeMs, chaseStat.mtimeMs]
  } catch {
    return 'unreadable'
  }
  const seen = await $.store.get(CALLS_KEY).catch(() => undefined)
  const board = boardOf(...read, seen)
  if (board === undefined) return 'unreadable'
  if (JSON.stringify(board.since) !== JSON.stringify(seen)) {
    await $.store.set(CALLS_KEY, board.since).catch(error => $.ui.log(`the board calls were not saved: ${String(error)}`))
  }
  return board
}

async function readQueue($: EngineInterface, repo: string): Promise<void> {
  const readAt = await $.clock.now()
  queueReadAt = readAt
  const started = epoch
  const [got, board] = await Promise.all([queueReadOnce($, repo), boardRead($, repo)])
  // A read of a repo no longer shown, or begun before off, lands nowhere: it would replace the shown repo's queue
  // and status line.
  if (started !== epoch || (await read($, shownRepo)) !== repo) return
  // A failed read keeps the last good one and its time, so the lists stay, said to be as of then; the fault says what
  // failed. Landings are ordered by the latest of either, so a slower read that started earlier never replaces one.
  const fault: Fault | undefined = 'phrase' in got ? { ...got, at: readAt } : undefined
  const good: QueueRead | undefined = 'phrase' in got ? undefined : got
  await update($, queue, old => {
    const held = old !== null && old.repo === repo ? old : undefined
    if (held !== undefined && Math.max(held.at, held.fault?.at ?? 0) > readAt) return old
    if (good !== undefined) return { repo, at: readAt, read: good, board }
    if (fault === undefined) return old
    return held?.read === undefined ? { repo, at: readAt, failed: fault.phrase, fault, board } : { ...held, failed: fault.phrase, fault, board }
  })
  const current = await read($, queue)
  if (current !== null) $.ui.status(statusOf(current, readAt))
  if (good !== undefined) $.clock.after(0, () => void trendIfDue($))
}

// One read per repo at a time: presses, view switches and turn ends while it runs share it.
function refreshQueue($: EngineInterface, repo: string): Promise<void> {
  const running = queueFlights.get(repo)
  if (running !== undefined) return running
  const done = readQueue($, repo).finally(() => queueFlights.delete(repo))
  queueFlights.set(repo, done)
  return done
}

// A queue view or the status line reads only when what it holds is another repo's or 60 s old.
async function queueIfStale($: EngineInterface) {
  const [repo, held, now] = await Promise.all([read($, shownRepo), read($, queue), $.clock.now()])
  if (repo === null) return
  if (held?.repo !== repo || now - queueReadAt >= QUEUE_EVERY) await refreshQueue($, repo)
  else await trendIfDue($)
}

async function forceQueue($: EngineInterface) {
  const repo = await read($, shownRepo)
  if (repo !== null) await refreshQueue($, repo)
}

// The open PRs of the queue read (drafts in, as the board counts them) and every PR closed since the window began, a
// page at a time; unknown past the page cap, on a read short of the open PRs, or on any failed page.
async function trendOnce($: EngineInterface, repo: string, open: QueueRead, now: number): Promise<number[] | NonNullable<Trend['failed']>> {
  if (open.prsShort) return 'more than 100 open PRs'
  if (open.prs.some(pr => !Number.isFinite(pr.createdAt))) return 'GitHub error'
  const spans: Span[] = open.prs.map(pr => ({ createdAt: pr.createdAt, closedAt: Infinity }))
  let after: string | undefined
  for (let page = 0; page < TREND_PAGES; page += 1) {
    const args = trendArgs(repo, after)
    if (args === undefined) return 'GitHub error'
    const answer = await gh($, args)
    if ('failed' in answer) return answer.failed
    const got = trendPageOf(answer.json, now)
    if (typeof got === 'string') return got
    spans.push(...got.spans)
    if (got.next === undefined) return weeksOf(spans, now)
    after = got.next
  }
  return `more than ${TREND_PAGES * 100} PRs closed in 16 weeks`
}

async function readTrend($: EngineInterface, repo: string): Promise<void> {
  const held = await read($, queue)
  if (held?.repo !== repo || held.read === undefined) return
  const now = await $.clock.now()
  const started = epoch
  const got = await trendOnce($, repo, held.read, now)
  if (started !== epoch || (await read($, shownRepo)) !== repo) return
  const next: Trend = typeof got === 'string' ? { repo, day: dayOf(now), at: now, failed: got } : { repo, day: dayOf(now), at: now, weeks: got }
  await update($, trend, old => (old?.repo === repo && old.at > now ? old : next))
  if (next.weeks !== undefined) await $.store.set(trendKey(repo), next).catch(error => $.ui.log(`the trend was not saved: ${String(error)}`))
}

function refreshTrend($: EngineInterface, repo: string): Promise<void> {
  const running = trendFlights.get(repo)
  if (running !== undefined) return running
  const done = readTrend($, repo).finally(() => trendFlights.delete(repo))
  trendFlights.set(repo, done)
  return done
}

// A trend saved by this repo's last read: the same day's 16 weeks.
function savedTrend(value: unknown, repo: string, day: string): Trend | undefined {
  const saved = value as Partial<Trend> | undefined
  const isWeeks = Array.isArray(saved?.weeks) && saved.weeks.length === 16 && saved.weeks.every(Number.isFinite)
  return saved?.repo === repo && saved.day === day && typeof saved.at === 'number' && isWeeks ? (saved as Trend) : undefined
}

// The queue view's trend: worked out once a good queue read is held, then at most once an hour (failed or not) and on
// a new UTC day; the hour holds across reloads and sessions through $.store. isForced: r, past the cache.
async function trendIfDue($: EngineInterface, isForced = false) {
  const [repo, which, held, known, now] = await Promise.all([read($, shownRepo), read($, view), read($, queue), read($, trend), $.clock.now()])
  if (repo === null || which !== 'queue' || held?.repo !== repo || held.read === undefined || !(await isShown($))) return
  if (!isForced) {
    const isFresh = (one: Trend | null | undefined) => one?.repo === repo && one.day === dayOf(now) && now - one.at < TREND_EVERY
    if (isFresh(known)) return
    const saved = savedTrend(await $.store.get(trendKey(repo)).catch(() => undefined), repo, dayOf(now))
    if (isFresh(saved) && saved !== undefined) {
      await update($, trend, old => (old?.repo === repo && old.at >= saved.at ? old : saved))
      return
    }
  }
  await refreshTrend($, repo)
}

// r, in every view: the queue read, the shown cards or detail, and under the queue view the trend past its cache. A
// press while one runs joins it, and so does any read already running.
function refreshAll($: EngineInterface): Promise<void> {
  refreshFlight ??= (async () => {
    await update($, refreshing, () => true)
    try {
      const which = await read($, view)
      const shown = which === 'pair' ? refreshPair($) : which === 'detail' ? refreshShownDetail($) : Promise.resolve()
      await Promise.all([shown, forceQueue($).then(() => trendIfDue($, true))])
    } finally {
      refreshFlight = undefined
      await update($, refreshing, () => false)
    }
  })()
  return refreshFlight
}

async function remember($: EngineInterface, repo: string) {
  await update($, shownRepo, () => repo)
  // Only /review-pair in a later session needs it: a store that refuses never stops a pair from showing.
  await $.store.set(REPO_KEY, repo).catch(error => $.ui.log(`the last repo was not saved: ${String(error)}`))
}

// The last repo shown, back after a start, a reload or /clear: the pair's own repo first, since a pair written
// before the store key existed survives a hot reload without it, then $.store.
async function restoreRepo($: EngineInterface) {
  if ((await read($, shownRepo)) !== null) return
  const saved = (await read($, pair))?.repo ?? (await $.store.get(REPO_KEY))
  if (typeof saved === 'string' && REPO.test(saved)) await update($, shownRepo, () => saved)
}

const detailKeyOf = (shown: Pick<Detail, 'repo' | 'kind' | 'number'>) => `${keyOf(shown.repo, shown.number)} ${shown.kind}`

// I2: the cursors and the opened groups saved by the last move, back after /clear: only keys a list can draw, and
// only from a store value of the shape this code writes. The groups come back with the cursors (S2): a cursor inside
// a collapsed group is no cursor once $.state is emptied, since the group's rows are not focusables until it opens.
async function restoreCursor($: EngineInterface) {
  const saved = (await $.store.get(CURSOR_KEY).catch(() => undefined)) as Partial<Record<string, unknown>> | undefined
  if (saved === null || typeof saved !== 'object') return
  const groups = saved.expanded as Partial<Record<string, unknown>> | undefined
  const kept: Cursor = {}
  const opened: Expanded = { queue: [], issues: [] }
  for (const which of ['queue', 'issues'] as const) {
    const key = saved[which]
    if (typeof key === 'string' && isCursorKey(key)) kept[which] = key
    const list = groups !== null && typeof groups === 'object' ? groups[which] : undefined
    if (Array.isArray(list)) opened[which] = list.filter((one): one is string => typeof one === 'string' && GROUP_KEY.test(one))
  }
  await update($, cursor, old => ({ ...old, ...kept }))
  await update($, expanded, old => ({ queue: [...new Set([...old.queue, ...opened.queue])], issues: [...new Set([...old.issues, ...opened.issues])] }))
}

// I2e: arming, in this session only: what a session's start and a turn's end did for every session before. The repo
// comes back from the pair or the store whenever it is unknown (a pair written before the store key existed, under a
// hot reload); from dormant the cursors come back too; and, isReading, the status line's queue read follows once the
// caller has returned (a show call's own reads are its cards: the turn's end reads the queue, as before). A shown
// pane polls.
async function arm($: EngineInterface, isReading = true) {
  const wasArmed = await read($, armed)
  if (!wasArmed) await update($, armed, () => true)
  await restoreRepo($)
  if (!wasArmed) await restoreCursor($)
  if (await isShown($)) startPoll($)
  if (isReading) $.clock.after(0, () => void queueIfStale($))
}

// I2e: /review-pair off: the status line goes, a placed pane closes (the plugin's own close: the engine's unasked
// floor stays where it was, spike S), the poll stops, and the pair, its cards, the repo and its queue are forgotten
// for this session, never in the store; the next show call or /review-pair arms again. Review R1: a read in flight
// lands nowhere (epoch). Review R3: the engine draws the pane once more while it closes, and a drawing restarts the
// poll, so it is stopped again last of all.
async function disarm($: EngineInterface) {
  epoch += 1
  stopPoll()
  $.ui.status(undefined)
  if (await isPlaced($)) await $.ui.close({ id: PANE })
  await update($, pair, () => null)
  await update($, cards, () => ({}))
  await update($, shownRepo, () => null)
  await update($, queue, () => null)
  await update($, trend, () => null)
  await update($, detail, () => null)
  await update($, detailCard, () => null)
  await update($, view, () => 'pair')
  await update($, armed, () => false)
  stopPoll()
}

// I2: the keys the shown list's cursor walks now, and where it rests. The shown repo's rows only (S1): while a new
// repo's read is in flight the old queue is still held, and a walk over it would save its keys as the new repo's
// cursor and read its numbers against the new repo.
async function cursorKeys($: EngineInterface, which: ListView): Promise<{ keys: string[]; at: string | undefined }> {
  const [held, opened, known, repo] = await Promise.all([read($, queue), read($, expanded), read($, cursor), read($, shownRepo)])
  const keys = focusablesOf(held === null || held.repo !== repo ? undefined : queueModelOf(held), which, opened[which])
  return { keys, at: cursorOf(keys, known[which]) }
}

// I2: a cursor move that is not a step (a click, Tab, a group's row, back from the detail): the state the ▸ is drawn
// from, then what every move does.
async function setCursor($: EngineInterface, which: ListView, key: string, isFocusing: boolean) {
  await update($, cursor, old => ({ ...old, [which]: key }))
  await afterMove($, isFocusing ? key : undefined)
}

// I2: what follows every cursor write: its mirror in $.store (the cursors with the opened groups, one value and one
// write per move, so classic.SessionStart can put both back), and the engine's focus ring when the move is the mod's
// own (j, k: a hotkey press means the pane holds the keys; a refusal leaves the ring where it was and the ▸ still
// moves). Once the ring moved, a wide pane is drawn again (R3): the engine's own move of the window to keep the ring
// in view asks for no drawing, and the master-detail column is pinned to the window's offset as drawn. The drawing
// that follows arms the column's rest timer.
async function afterMove($: EngineInterface, focusKey: string | undefined) {
  const [saved, opened] = await Promise.all([read($, cursor), read($, expanded)])
  await $.store.set(CURSOR_KEY, { ...saved, expanded: opened }).catch(error => $.ui.log(`the cursor was not saved: ${String(error)}`))
  if (focusKey === undefined) return
  const focused = await $.ui.focus({ requestId: PANE, key: focusKey }).catch((error: unknown) => ({ deny: String(error) }))
  if (focused.deny !== undefined) $.ui.log(`review-pair: the focus ring did not move to ${focusKey} (${focused.deny})`, { to: 'debug' })
  else if (lastColumns >= SIDE_FROM) $.ui.invalidate('ui.render')
}

// j or k in a list: one row on or back, stopping at the ends (no wrap: the top and the bottom are where a press
// lands you, never a surprise jump). The step is taken inside the compare-and-swap update (R1): presses that arrive
// together (auto-repeat, a batch the engine dispatched at once) each step from the row the one before landed on,
// where a step read before the write would send them all to the same row.
async function moveCursor($: EngineInterface, delta: 1 | -1) {
  const which = await read($, view)
  if (which !== 'queue' && which !== 'issues') return
  const { keys } = await cursorKeys($, which)
  const step: { to?: string } = {}
  await update($, cursor, old => {
    const at = cursorOf(keys, old[which])
    const index = at === undefined ? -1 : keys.indexOf(at)
    const to = keys[Math.min(keys.length - 1, Math.max(0, index + delta))]
    step.to = to === undefined || to === at ? undefined : to
    return step.to === undefined ? old : { ...old, [which]: step.to }
  })
  if (step.to !== undefined) await afterMove($, step.to)
}

// I2: Enter or a click on a group's row opens it in place, or closes it; the cursor rests on the group.
async function toggleGroup($: EngineInterface, which: GroupView, group: string) {
  await update($, expanded, old => ({ ...old, [which]: old[which].includes(group) ? old[which].filter(key => key !== group) : [...old[which], group] }))
  await setCursor($, which, group, false)
}

// I2: the master-detail column's read of the cursor's item (DETAIL_PR or DETAIL_ISSUE, the detail view's own
// documents), only from SIDE_FROM body columns and only after the cursor has rested SIDE_REST_MS. A list drawing
// whose column has no card for the cursor's row arms it; every drawing after a move arms it again, so a run of j
// presses reads once, for the row it stops on; a drawing whose column holds the cursor's card disarms it (S4: a move
// back onto that row, back from its detail). One read in flight at a time; one that lands for a row the cursor has
// left is dropped.
function disarmSide() {
  sideTimer?.cancel()
  sideTimer = undefined
}

function armSide($: EngineInterface) {
  disarmSide()
  if (lastColumns < SIDE_FROM) return
  sideTimer = $.clock.after(SIDE_REST_MS, () => void readSide($))
}

// The item the cursor rests on, as the side column's card key, or undefined on a group row or with no rows.
const sideTargetOf = (repo: string, at: string | undefined) => {
  const row = at === undefined ? null : ROW_KEY.exec(at)
  return row === null ? undefined : { repo, kind: row[1] === 'pull' ? ('pr' as const) : ('issue' as const), number: Number(row[2]) }
}

async function readSide($: EngineInterface) {
  // A read still running when the rest ends: this one waits for it, then rests again, so the row the cursor is on
  // now is read once it lands.
  if (sideFlight !== undefined) {
    void sideFlight.then(() => armSide($))
    return
  }
  const [which, repo] = await Promise.all([read($, view), read($, shownRepo)])
  if ((which !== 'queue' && which !== 'issues') || repo === null) return
  const target = sideTargetOf(repo, (await cursorKeys($, which)).at)
  if (target === undefined) return
  const key = detailKeyOf(target)
  // A card already held, reading or failed for that row is not read again (R4): the timer that fired was armed by a
  // drawing before the column caught up (back from the detail, a flight that landed on the row).
  if ((await read($, side))?.key === key) return
  await update($, side, () => ({ key }))
  sideFlight = (async () => {
    const readAt = await $.clock.now()
    const started = epoch
    const args = ghArgs(target.kind === 'issue' ? DETAIL_ISSUE : DETAIL_PR, target.repo, target.number)
    const answer = args === undefined ? { failed: 'GitHub error' as const } : await gh($, args, partialOf)
    const got = 'failed' in answer ? answer.failed : detailOf(answer.json, target.kind, target.number, readAt)
    if (started !== epoch || (await read($, side))?.key !== key) return
    await update($, side, old => {
      const card = old?.key === key ? old : { key }
      return typeof got === 'string' ? { ...card, failed: got } : { key, read: mergeDetail(card.read, got) }
    })
  })().finally(() => {
    sideFlight = undefined
  })
  await sideFlight
}

// I2: j or k in the detail: the next or previous item of the list it was opened from, read at once; the origin's
// cursor (or the pair's tab) follows, so back lands on the item shown last. The swap is taken inside the
// compare-and-swap update of the shown item (R1), as moveCursor's step is, so presses that arrive together swap once
// each. A read that lands for an item no longer shown is dropped by readDetail, and a card written for one is
// replaced by the shown item's own.
async function walkDetail($: EngineInterface, delta: 1 | -1) {
  const shown = await read($, detail)
  if (shown === null) return
  const [held, current] = await Promise.all([read($, queue), read($, pair)])
  const model = held === null || held.repo !== shown.repo ? undefined : queueModelOf(held)
  const step: { to?: Neighbour } = {}
  const next = await update($, detail, old => {
    const walk = old === null ? undefined : walkOf(old, model, current)
    step.to = delta > 0 ? walk?.next : walk?.previous
    return old === null || step.to === undefined ? old : { repo: old.repo, kind: step.to.kind, number: step.to.number, from: old.from, back: step.to.key, scroll: 0 }
  })
  const to = step.to
  if (to === undefined || next === null) return
  if (next.from === 'pair') await update($, tab, () => to.index)
  else await setCursor($, next.from, to.key, false)
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
  const key = detailKeyOf(next)
  await update($, detailCard, old => (old?.key === key ? old : { key }))
  await refreshDetail($, next)
}

// One read of the shown item. It lands only while that item still shows; a failed read keeps the last good one, a
// partial one keeps each part it could not read from the read before. Reads of one item never overlap, so a read that
// lands is always the latest.
async function readDetail($: EngineInterface, shown: Detail): Promise<void> {
  const readAt = await $.clock.now()
  const started = epoch
  const args = ghArgs(shown.kind === 'issue' ? DETAIL_ISSUE : DETAIL_PR, shown.repo, shown.number)
  const answer = args === undefined ? { failed: 'GitHub error' as const } : await gh($, args, partialOf)
  const got = 'failed' in answer ? answer.failed : detailOf(answer.json, shown.kind, shown.number, readAt)
  const key = detailKeyOf(shown)
  const current = await read($, detail)
  if (started !== epoch || current === null || detailKeyOf(current) !== key) return
  await update($, detailCard, old => {
    const card = old?.key === key ? old : { key }
    if (typeof got === 'string') return { ...card, failed: got }
    return { key, read: mergeDetail(card.read, got) }
  })
}

function refreshDetail($: EngineInterface, shown: Detail): Promise<void> {
  const key = detailKeyOf(shown)
  const running = detailFlights.get(key)
  if (running !== undefined) return running
  const done = readDetail($, shown).finally(() => detailFlights.delete(key))
  detailFlights.set(key, done)
  return done
}

async function refreshShownDetail($: EngineInterface) {
  const shown = await read($, detail)
  if (shown !== null) await refreshDetail($, shown)
}

// A row's letter, or the pair's 0: the item's detail in the same pane, read at once. Never a write.
async function openDetail($: EngineInterface, target: Pick<Detail, 'repo' | 'kind' | 'number'>) {
  const from = await read($, view)
  if (from === 'detail' || !REPO.test(target.repo)) return
  const back = from === 'pair' ? 'detail' : `${target.kind === 'pr' ? 'pull' : 'issues'}-${target.number}`
  const shown: Detail = { ...target, from, back, scroll: 0 }
  // I2: a click or Enter on a row is a move of the cursor too, so back lands on it.
  if (from !== 'pair') await setCursor($, from, back, false)
  // The engine keeps the pane's window offset across views, and the detail's tree is a row taller than the pane, so a
  // list the person had scrolled would hide the detail's key row: the window goes back to the top first, while the hook
  // still passes the event on; a pane that cannot scroll refuses, which is nothing to do.
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
  await update($, detail, () => shown)
  await update($, detailCard, () => ({ key: detailKeyOf(shown) }))
  await update($, view, () => 'detail')
  await refreshDetail($, shown)
}

// Back to the view the detail was opened from; its next drawing brings the row that opened it back into view.
async function closeDetail($: EngineInterface) {
  const shown = await read($, detail)
  if (shown === null) return
  revealKey = shown.back
  // The detail's read, once landed or failed, is the side column's card for the row back lands on (S5): the same
  // document, not read twice. A read still in flight is left to the column's own rest. The view switches before the
  // detail is dropped (R4), so no drawing sees a detail view with nothing to show and falls through to the queue.
  const card = await read($, detailCard)
  if (shown.from !== 'pair' && card !== null && (card.read !== undefined || card.failed !== undefined)) await update($, side, () => card)
  await update($, view, () => shown.from)
  await update($, detail, () => null)
  await update($, detailCard, () => null)
  if (shown.from !== 'pair') await queueIfStale($)
}

// The engine's window shows the row whole again ('nearest'); the exact old offset has no API. A row not drawn yet is
// refused, so one more try follows; a second refusal leaves the window at the view's top. I2: the focus ring goes
// back onto the row too, when the pane holds the keys (a refusal is nothing to do: the ▸ marks the row regardless).
async function reveal($: EngineInterface, key: string, isRetry = false) {
  const moved = await $.ui.scroll({ to: { key }, in: PANE }).catch((error: unknown) => ({ deny: String(error) }))
  if (moved.deny === undefined) {
    await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
    return
  }
  if (!isRetry) $.clock.after(REVEAL_RETRY_MS, () => void reveal($, key, true))
  else $.ui.log(`review-pair: ${key} did not come back into view (${moved.deny})`, { to: 'debug' })
}

async function switchView($: EngineInterface, to: View) {
  const from = await read($, view)
  await update($, view, () => to)
  // I4 (review I4R-5): a from a detail leaves it as back would, the view switched first (R4), without its row's reveal.
  if (from === 'detail') {
    await update($, detail, () => null)
    await update($, detailCard, () => null)
  }
  if (to !== 'pair') await queueIfStale($)
}

async function toastOnce($: EngineInterface, text: string) {
  if (await read($, toasted)) return
  await update($, toasted, () => true)
  $.ui.toast(`review-pair: ${text}`)
}

// Resolves undefined once the pane is on screen, else why it is not.
async function openPane($: EngineInterface, isAsked: boolean): Promise<string | undefined> {
  if (!isAsked && (await read($, dismissed))) return 'the user closed it'
  if (!isAsked && isFullscreen === false) {
    if (await isPlaced($)) {
      startPoll($)
      return undefined
    }
    await toastOnce($, 'type /review-pair to see the pair; the right-hand dock needs the fullscreen layout')
    return 'the terminal is not in the fullscreen layout'
  }
  const pane = { id: PANE, title: 'Review pair' }
  // Opened by the person, it takes the keyboard so the keys work at once; Esc hands it back.
  const opened = await $.ui.open(isAsked ? { ...pane, focus: true as const } : pane)
  if (opened.isPlaced) {
    startPoll($)
    return undefined
  }
  await toastOnce($, 'widen the terminal or type /review-pair to see the pair')
  return opened.reason
}

// Opens only a URL the allow-lists pass: the pair's items and check logs, the queue's pull requests and issues, and
// the board's one URL.
// When open fails, the URL goes to the clipboard.
async function openUrl($: EngineInterface, url: string, surface: RenderSurface) {
  const [current, repo] = await Promise.all([read($, pair), read($, shownRepo)])
  const isPairs = current !== null && (isItemUrl(url, current.repo) || isLogUrl(url, current.repo))
  if (url !== BOARD_URL && !isPairs && !(repo !== null && isItemUrl(url, repo))) return
  const isOpened = await $.process.run(['/usr/bin/open', url], { timeoutMs: OPEN_TIMEOUT_MS }).then(
    run => run.exitCode === 0,
    () => false,
  )
  if (isOpened) return
  const copied = await $.ui.copy({ text: url, surface })
  $.ui.toast(copied.isCopied ? 'review-pair: link copied' : 'review-pair: the link did not open')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'show', description: DESCRIPTION, inputSchema: SCHEMA })
    try {
      await $.command.register({ name: 'review-pair', description: 'Show or hide the pair under review; on, off', immediate: true })
    } catch (error) {
      $.ui.log(`/review-pair was not added: ${String(error)}`)
    }
    // A reload drops the module's r in flight, which can no longer clear its caption.
    await update($, refreshing, () => false)
    // I2e: dormant until armed; the store's repo is read into nothing. This also runs after a hot reload, when the
    // pane may be up with nothing read by this code: a pane placed then means duty was running here.
    if ((await read($, armed)) || (await isPlaced($))) {
      await arm($, false)
      $.clock.after(0, () => void refreshShown($))
    }
    return next(e)
  })

  // /clear empties $.state under an open pane and raises no session.start (spike S); this refreshes what a shown pane
  // holds. I2: the list cursors come back from their $.store mirror.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      // I2e: $.state is empty after /clear, armed with it: a pane still placed means duty was running here, and
      // nothing else below runs in a session that is not. Review R2: the engine keeps a plugin's status line across
      // /clear until a call replaces it, so a session dormant from here clears the one its armed past drew.
      if (!(await read($, armed)) && !(await isPlaced($))) {
        $.ui.status(undefined)
        return next(e)
      }
      await arm($, false)
      // The view atom is back at its 'pair' default: with no pair and a repo known, the pane shows the queue, as
      // /review-pair opens it.
      if ((await read($, pair)) === null && (await read($, shownRepo)) !== null) await update($, view, () => 'queue')
      $.clock.after(0, () => void refreshShown($))
    }
    return next(e)
  })

  // I2e: the skill running here is duty, typed or through the Skill tool (the same event at each): the session is
  // armed before the pane is placed, so a placed pane never polls in a dormant session. Review R5, the accepted gap:
  // the event carries no agentId, so an agent definition that preloads the skill raises the same event and arms the
  // main session too; /review-pair off is the way back. One hook per name, since a matcher takes one.
  on('skill.prompt', { skill: 'pr-maintainer' }, async ($, e, next) => {
    const expanded = await next(e)
    await arm($)
    await openPane($, false)
    return expanded
  })
  on('skill.prompt', { skill: 'pr-agent-maintainer' }, async ($, e, next) => {
    const expanded = await next(e)
    await arm($)
    await openPane($, false)
    return expanded
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'Ignored: only the main conversation shows a pair.' }
    if (Array.isArray(e.items) && e.items.length === 0) {
      if (e.repo !== undefined && !(typeof e.repo === 'string' && REPO.test(e.repo))) return { deny: 'Not cleared: repo must be owner/name.' }
      await update($, dismissed, () => false)
      await update($, pair, () => null)
      await update($, evidenceOpen, () => [])
      await update($, detailsOpen, () => [])
      if (typeof e.repo === 'string') await remember($, e.repo)
      // I2e: any show call arms this session; its reads stay its own, the turn's end reads the queue.
      await arm($, false)
      await update($, view, () => 'queue')
      // The pane stays seated; a shown one reads the queue after the call returns, never on its path.
      if (!(await isShown($))) return { result: 'Pair cleared; the pane is not on screen.' }
      $.clock.after(0, () => void queueIfStale($))
      return { result: 'Pair cleared; the pane shows the queue.' }
    }
    const current = pairOf(e)
    if (typeof current === 'string') return { deny: `Not shown: ${current}` }
    // I5: each item's text hash, worked out here once from what the call gave and kept on the item.
    for (const item of current.items) {
      const text = canonicalText(item.draft, item.inline)
      if (text !== undefined) item.textHash = await textHashOf(text)
    }
    // Only an item carried straight over from the pair before keeps its card: any other starts with no earlier read.
    const old = await read($, pair)
    const isCarried = (item: PairItem) => old?.repo === current.repo && old.items.some(one => one.number === item.number)
    const kept = new Set(current.items.filter(isCarried).map(item => keyOf(current.repo, item.number)))
    await update($, cards, known => Object.fromEntries(Object.entries(known).filter(([key]) => kept.has(key))))
    await update($, evidenceOpen, open => open.filter(key => kept.has(key)))
    await update($, detailsOpen, open => open.filter(key => kept.has(key)))
    await update($, pair, () => current)
    // I5: every item of the new pair is written to the ledger, which no show clears.
    const shownAt = await $.clock.now()
    await update($, ledger, book =>
      current.items.reduce((next, item) => touch(next, keyOf(current.repo, item.number), shownEntry(next[keyOf(current.repo, item.number)], current.repo, item, shownAt)), book),
    )
    await update($, tab, () => 0)
    await update($, view, () => 'pair')
    await remember($, current.repo)
    await arm($, false)
    const hidden = await openPane($, false)
    await refresh($, current, false)
    const known = await read($, cards)
    const alerts = current.items.flatMap(item => alertsOf(known[keyOf(current.repo, item.number)], item))
    const shown = hidden === undefined ? 'Shown in the review-pair pane.' : `Saved, not on screen (${hidden}); /review-pair opens it.`
    // I5: one clause per item in integers, hex and fixed words, the hash Claude prints beside its action line.
    const clauses = current.items.map(item => `#${item.number} ${item.textHash === undefined ? 'no text' : `text ${item.textHash.slice(0, 6)}`} ${item.head === undefined ? 'head unknown' : `head ${item.head.slice(0, 7)}`}.`)
    return { result: [shown, ...alerts, ...clauses].join(' ') }
  }).catch(async ($, e, next) => ({ deny: `review-pair failed (${next.error?.kind ?? 'error'}); the pair was not shown.` }))

  // Claude's own writes, once they ran: a gh write in Bash or a GitHub write tool naming a shown item re-reads it
  // after the call returns. The call and its result pass through untouched; a subagent's never count.
  on('tool.call', { tool: WRITTEN_BY }, async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || done.deny !== undefined) return done
    const writes = e.tool === 'Bash' ? writesOf(String(e.command)) : [mcpWriteOf(e.tool, e as Record<string, unknown>)].filter(one => one !== undefined)
    if (writes.length > 0) $.clock.after(0, () => void afterWrite($, writes, done.isError === true))
    return done
  }).catch(async ($, e, next) => next(e))

  // I2e: the model running the pr-maintainer skill through the engine's Skill tool arms this session once the
  // engine's own run returned; the call and its result pass through untouched, and another skill's name, a
  // subagent's call, or a run that was denied or errored (review R4: the name alone is not duty) never count. A
  // failed arming is logged, never a second run of the tool.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined && !done.isError && e.agentId === undefined && e.tool === 'Skill' && SKILLS.includes(String(e.skill))) {
      await arm($).catch((error: unknown) => $.ui.log(`review-pair: not armed: ${String(error)}`))
    }
    return done
  })

  on('command.run', { command: 'review-pair' }, async ($, e) => {
    // I2e: off disarms this session; on arms it, opening the pane only when a pair is held; bare shows or hides the
    // pane and arms. Hiding keeps the session armed: the status line goes on.
    const word = e.args.trim()
    if (word === 'off') {
      await disarm($)
      return {}
    }
    if (word !== '' && word !== 'on') return { text: '/review-pair takes on or off.' }
    const isOn = word === 'on'
    if (await isShown($)) {
      if (isOn) {
        await arm($)
        return {}
      }
      stopPoll()
      await update($, dismissed, () => true)
      await $.ui.close({ id: PANE })
      return {}
    }
    await arm($, false)
    if (isOn && (await read($, pair)) === null) {
      await queueIfStale($)
      return {}
    }
    await update($, dismissed, () => false)
    await restoreRepo($)
    const [current, repo, which] = await Promise.all([read($, pair), read($, shownRepo), read($, view)])
    if (current === null && repo !== null && which !== 'detail') await update($, view, () => 'queue')
    await openPane($, true)
    const shown = await read($, view)
    if (shown === 'pair') await refreshPair($)
    else if (shown === 'detail') await refreshShownDetail($)
    else await queueIfStale($)
    // The engine docks a pane on the right only in the fullscreen layout from 110 columns.
    const { isFullscreen: docks, columns } = e.presentation
    if (!docks) return { text: 'Opened above the prompt: the right-hand dock needs the fullscreen layout.' }
    if (columns < 110) return { text: `Opened above the prompt: the right-hand dock needs 110 columns and this terminal has ${columns}.` }
    return {}
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // I2e: a dormant session reads nothing and sets no status line.
    if (!(await read($, armed))) return next(e)
    const now = await $.clock.now()
    const isUp = await isShown($)
    if (isUp) startPoll($)
    if (now - refreshedAt >= CARD_EVERY && isUp && (await read($, view)) === 'pair') {
      $.clock.after(0, () => void refreshPair($))
    }
    // The one background read: the status line's counts, at most once a minute or when the repo changed, whether
    // or not the pane shows.
    if ((await read($, shownRepo)) === null) $.ui.status(undefined)
    else $.clock.after(0, () => void queueIfStale($))
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopPoll()
    if (e.origin.kind === 'person') await update($, dismissed, () => true)
    return next(e)
  })

  // The band draws nothing here; its viewport says whether a pane would dock on the right.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    return next(e)
  })

  // I2: the person's own moves of the focus ring (Tab, Shift+Tab, and the arrows on a tree that fits: spike S saw Up
  // and Down walk the Button ring and raise ui.focus then, and scroll by one row with no focus on a tree that
  // overflows, which the ui.scroll hook below leaves to the engine's window; nothing else intercepts arrows) sync the
  // list's cursor when the ring lands on a row or a group. A click raises ui.press only, so onDetail and onToggle sync
  // it on their way. The mod's own $.ui.focus is skipped here (re-entry) and sets the cursor itself.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && typeof e.element === 'string' && isCursorKey(e.element)) {
      const which = await read($, view)
      if (which === 'queue' || which === 'issues') await setCursor($, which, e.element, false)
    }
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // The detail view scrolls its own rows under its fixed head, so the engine's window stays put. I5: on the pair view
  // the engine's window moves, and one that reaches the tree's end, in a focused pane, has draft-end (the view's last
  // element) in view: the shown tab's item is seen, whatever the drawing's own count said.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const which = await read($, view)
    if (which === 'pair') {
      const done = await next(e)
      if (done.deny === undefined && e.offset + e.bodyRows >= e.contentRows) $.clock.after(0, () => void seenByScroll($))
      return done
    }
    if (which !== 'detail') return next(e)
    // A page key asks for the pane's bodyRows, and page keys held or crowded reach here summed, so any multiple of it is
    // that many pages; the detail's window is the rows under its head.
    const pages = e.bodyRows > 0 && Math.abs(e.by) % e.bodyRows === 0 ? Math.abs(e.by) / e.bodyRows : 0
    const by = pages > 0 ? Math.sign(e.by) * pages * detailRoom : e.by
    // The stored offset is clamped to the max of the pane as drawn now before the step: a narrower pane's offset can
    // be past it, and a step from there would land on the max the view already shows.
    await update($, detail, old => (old === null ? old : { ...old, scroll: Math.min(Math.max(0, Math.min(old.scroll, detailMax) + by), detailMax) }))
    return {}
  }).catch(async ($, e, next) => next(e))

  // The pane draws one pure view from state and the clock; every button reads, refreshes or opens.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e)
    const [isArmed, current, known, chosen, which, repo, held, now, isLegend, shown, card, weekly, isReading, at, opened, aside, isWhy, book, evidenced, detailed] = await Promise.all([
      read($, armed),
      read($, pair),
      read($, cards),
      read($, tab),
      read($, view),
      read($, shownRepo),
      read($, queue),
      $.clock.now(),
      read($, legendOpen),
      read($, detail),
      read($, detailCard),
      read($, trend),
      read($, refreshing),
      read($, cursor),
      read($, expanded),
      read($, side),
      read($, whyOpen),
      read($, ledger),
      read($, evidenceOpen),
      read($, detailsOpen),
    ])
    // A pane is drawn only once placed: drawing it is how a pane placed again (widened, reopened) restarts the poll.
    // Review R3: not while the session is dormant, since the drawings off raises while it closes the pane and
    // writes the state land after its own last stopPoll.
    if (isArmed) startPoll($)
    const actions: Actions = {
      onTab: i => void update($, tab, () => i),
      onOpen: (url, surface) => void openUrl($, url, surface),
      onRefresh: () => void refreshAll($),
      onView: to => void switchView($, to),
      onLegend: () => void update($, legendOpen, isOpen => !isOpen),
      onWhy: () => void update($, whyOpen, isOpen => !isOpen),
      onDetail: target => void openDetail($, target),
      onBack: () => void closeDetail($),
      onMove: delta => void (which === 'detail' ? walkDetail($, delta) : moveCursor($, delta)),
      onToggle: (list, group) => void toggleGroup($, list, group),
      onHold: () => void toggleHold($),
      onEvidence: () => void toggleEvidence($),
      onDetails: () => void toggleDetails($),
    }
    const { isFocused, bodyColumns, scroll } = e.props
    lastColumns = bodyColumns
    if (which === 'detail' && shown !== null) {
      const walk = walkOf(shown, held === null || held.repo !== shown.repo ? undefined : queueModelOf(held), current)
      const drawn = detailView(ui, shown, card, now, isFocused, bodyColumns, scroll.bodyRows, actions, isLegend, isReading, held, walk)
      detailMax = drawn.max
      detailRoom = drawn.room
      return drawn.tree
    }
    // The view's first drawing after the detail: once it holds its rows, the row that opened the detail comes back.
    if (revealKey !== undefined) {
      const key = revealKey
      revealKey = undefined
      $.clock.after(0, () => void reveal($, key))
    }
    if (which !== 'pair') {
      const list = which === 'issues' ? 'issues' : 'queue'
      const nav = { expanded: opened[list], ...(at[list] === undefined ? {} : { cursor: at[list] }) }
      // I2: a wide list whose side column has no card for the cursor's row starts the rest before its read; one whose
      // column holds it cancels a rest still running (S4). The shown repo's rows only (S1), as cursorKeys walks.
      const model = held === null || held.repo !== repo ? undefined : queueModelOf(held)
      const target = bodyColumns >= SIDE_FROM && repo !== null ? sideTargetOf(repo, cursorOf(focusablesOf(model, list, opened[list]), at[list])) : undefined
      if (target !== undefined && aside?.key !== detailKeyOf(target)) armSide($)
      else disarmSide()
      return queueView(ui, list, repo, held, current !== null, now, isFocused, bodyColumns, scroll.bodyRows, actions, isLegend, weekly, isReading, nav, aside, scroll.offset, isWhy)
    }
    const index = Math.min(chosen, Math.max(0, (current?.items.length ?? 1) - 1))
    const item = current?.items[index]
    const itemKey = current === null || item === undefined ? undefined : keyOf(current.repo, item.number)
    const isEvidence = itemKey !== undefined && evidenced.includes(itemKey)
    const isDetails = itemKey !== undefined && detailed.includes(itemKey)
    const drawn = pairView(ui, current, known, index, now, isFocused, bodyColumns, scroll.bodyRows, actions, repo !== null, isLegend, isReading, held, book, isEvidence, isDetails)
    // I5: the shown tab's item is seen once the focused pane draws it with its draft's end in the window (or it has no
    // draft); the write follows the drawing, and an entry already seen is not written again.
    const isEndShown = drawn.end === undefined || scroll.offset + scroll.bodyRows >= drawn.end
    if (current !== null && item !== undefined && isFocused && isEndShown && book[keyOf(current.repo, item.number)]?.seenAt === undefined) {
      $.clock.after(0, () => void markSeen($, current.repo, item.number, item))
    }
    return drawn.tree
  })
}
