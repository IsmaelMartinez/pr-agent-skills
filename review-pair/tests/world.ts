import type { On, ProcessRunResult, RenderElement, UiOpenResult, UiPane } from 'claude-code'
import type { MockClock } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

import { CARD, DETAIL_ISSUE, DETAIL_PR, ISSUE, ISSUES as ISSUES_DOC, QUEUE, REFS, TREND, VIEWER, WRITE_TOOLS } from '../hooks/github'
import { ISSUE_4007, PR_3995 } from './detail-fixtures'
import { CARDS, FIT, ISSUES } from './fixtures'
import { REFS_2312, TRENDS_2145 } from './live-fixtures'
import { BOARD_FILES, BOARD_WRITTEN, LIVE_QUEUES, VIEWER_ANSWER } from './queue-fixtures'

export const PRA = 'The-PR-Agent/pr-agent'
export const TFL = 'IsmaelMartinez/teams-for-linux'
export const TOOL = 'mcp__review-pair__show'
// The board's folder as REVIEW_PAIR_BOARD_DIR names it in the tests.
export const BOARD_DIR = '/home/maintainer/pr-agent-board'
export const SURFACES = ['terminal', 'desktop'] as const
// 02:48 BST on the day the answers were recorded.
export const NOW = Date.parse('2026-10-10T01:48:00Z')
export const TURN = { answer: '', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' } as const
export const TYPED = { command: 'review-pair', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
export const SHOWN: UiPane = { id: 'review-pair', title: 'Review pair', isShown: true, isFocused: false, isPlaced: true }
// 08:35 BST on 2026-10-11: the queue answers were read at 07:35 UTC, the board written at 07:22 UTC.
export const QUEUE_NOW = Date.parse('2026-10-11T07:35:12Z')

// The real texts gh 2.102.0 and the engine printed in the SRE spike.
export const REAL = {
  badCredentials: 'gh: Bad credentials (HTTP 401)',
  gateway: 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)',
  timedOut: (ms: number) => `HooksError: review-pair: $.process.run(gh) aborted: still running after ${ms}ms`,
  noGh: 'HooksError: review-pair: $.process.run(gh) failed to start: ENOENT: Executable not found in $PATH: "gh"',
}

export const clone = <T>(value: T): any => JSON.parse(JSON.stringify(value))
export const hhmm = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const paneProps = (bodyColumns: number, isFocused = false) =>
  ({
    title: 'Review pair',
    isFocused,
    bodyColumns,
    placement: bodyColumns < 80 ? 'dock' : 'inline',
    scroll: { offset: 0, bodyRows: bodyColumns < 80 ? 34 : 11 },
    view: {},
  }) as const

export const mountPane = ($: any, surface: (typeof SURFACES)[number], columns = 39, isFocused = false) =>
  $.ui.mount({ plugin: 'review-pair', surface, component: 'Pane', requestId: 'review-pair', props: paneProps(columns, isFocused) })

// How gh answers one card: as recorded, an exit with stderr, a refusal before it ran, or late.
export type Mode =
  | { kind: 'ok' }
  | { kind: 'exit'; stderr: string; stdout?: string; exitCode?: number }
  | { kind: 'stdout'; stdout: string }
  | { kind: 'refuse'; reason: string }
  | { kind: 'slow'; ms: number }

export type Call = { argv: string[]; timeoutMs: number | undefined; at: number }

export type World = {
  calls: Call[]
  answers: Record<string, unknown>
  modes: Record<string, Mode>
  hasGh: boolean
  openResult: 'ok' | 'fail' | 'refuse'
  isCopied: boolean
  opened: string[]
  closed: string[]
  toasts: string[]
  copies: { text: string; surface: string | undefined }[]
  outward: string[]
  panes: UiPane[]
  placement: UiOpenResult
  clock: MockClock
  queues: Record<string, unknown>
  // The board's files by name, as the fs hooks serve them under BOARD_DIR; a missing name is ENOENT. boardWritten: the
  // mtime every one of them is stat'ed with. boardDir: what REVIEW_PAIR_BOARD_DIR reads, undefined for unset.
  board: Record<string, string>
  boardDir: string | undefined
  boardWritten: number
  fsCalls: string[]
  status: (string | undefined)[]
  viewer: unknown
  // The plugin's $.store, kept here so a test can read what was saved.
  store: Record<string, unknown>
  // Claude's own tool calls as the engine ran them (I1c): Bash commands and GitHub write tools, or a denial.
  toolRuns: string[]
  denyTools: boolean
  // I2e review R4: the engine's Skill run failed (an unknown skill): the call answers isError, and no skill ran.
  skillErrors: boolean
  // I2e review R3: what the engine does while a pane closes (a drawing of it, as the real engine raised one); and
  // how many times the plugin asked for the panes, which is what a poll tick does first.
  onClose?: () => Promise<void>
  paneReads: number
  // I2b: the detail reads' answers by "owner/name#number"; their modes are keyed "detail owner/name#number".
  details: Record<string, unknown>
  // I2c: the trend pages by repo, then by the cursor that asks for each ('first' for none); their mode is keyed "trend".
  trends: Record<string, Record<string, unknown>>
  // I2c fixes: the REFS answers by repo (mode key "refs"); the ISSUES document is answered from `queues` (mode key
  // "issues"), whose answers hold both halves.
  refs: Record<string, unknown>
  // I2: every ui.focus the plugin raised or the test replayed: the element and who moved the ring.
  focused: { element: string | undefined; origin: string }[]
}

const ran = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const valueOf = (argv: readonly string[], name: string) => argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)

// The card each gh call asked for, as "owner/name#number".
export const cardKey = (argv: readonly string[]) => `${valueOf(argv, 'owner')}/${valueOf(argv, 'name')}#${valueOf(argv, 'number')}`
const isDocument = (argv: readonly string[], ...documents: string[]) =>
  argv[0] === 'gh' && argv[1] === 'api' && documents.some(document => argv[4] === `query=${document}`)
// Card and issue reads only: the queue and viewer reads are counted on their own.
export const ghCalls = (seen: World) => seen.calls.filter(call => isDocument(call.argv, CARD, ISSUE)).map(call => cardKey(call.argv))
// I2c fixes: the issues and cross-reference reads, beside each queue read.
export const issuesCalls = (seen: World) => seen.calls.filter(call => isDocument(call.argv, ISSUES_DOC)).map(call => `${valueOf(call.argv, 'owner')}/${valueOf(call.argv, 'name')}`)
export const refsCalls = (seen: World) => seen.calls.filter(call => isDocument(call.argv, REFS)).map(call => `${valueOf(call.argv, 'owner')}/${valueOf(call.argv, 'name')}`)
export const queueCalls = (seen: World) => seen.calls.filter(call => isDocument(call.argv, QUEUE)).map(call => `${valueOf(call.argv, 'owner')}/${valueOf(call.argv, 'name')}`)
export const viewerCalls = (seen: World) => seen.calls.filter(call => isDocument(call.argv, VIEWER))
// I2c: each trend page read, as "owner/name first" or "owner/name <cursor>".
export const trendCalls = (seen: World) =>
  seen.calls.filter(call => isDocument(call.argv, TREND)).map(call => `${valueOf(call.argv, 'owner')}/${valueOf(call.argv, 'name')} ${valueOf(call.argv, 'after') ?? 'first'}`)
export const openCalls = (seen: World) => seen.calls.filter(call => call.argv[0] === '/usr/bin/open').map(call => call.argv)

export function world(on: On, options: { now?: number; store?: Record<string, unknown> } = {}): World {
  const seen: World = {
    calls: [],
    answers: { ...CARDS, ...FIT, ...ISSUES },
    modes: {},
    hasGh: true,
    openResult: 'ok',
    isCopied: true,
    opened: [],
    closed: [],
    toasts: [],
    copies: [],
    outward: [],
    panes: [],
    placement: { isPlaced: true },
    clock: mock.clock(on, { now: options.now ?? NOW }),
    queues: { ...LIVE_QUEUES },
    // I2c fixes: only the two call files the mod reads.
    board: { 'buckets.json': BOARD_FILES['buckets.json'] ?? '', 'chase.json': BOARD_FILES['chase.json'] ?? '' },
    boardWritten: BOARD_WRITTEN,
    boardDir: BOARD_DIR,
    fsCalls: [],
    status: [],
    viewer: VIEWER_ANSWER,
    store: { ...options.store },
    toolRuns: [],
    denyTools: false,
    skillErrors: false,
    paneReads: 0,
    details: { [`${PRA}#3995`]: PR_3995, [`${PRA}#4007`]: ISSUE_4007 },
    trends: clone(TRENDS_2145),
    refs: clone(REFS_2312),
    focused: [],
  }
  // The engine beneath the plugin's tool.call hooks: it runs the call (records it) or a PreToolUse hook denies it.
  on('tool.call', { tool: new RegExp(`^(Bash|${WRITE_TOOLS.join('|')})$`) }, async ($, e) => {
    if (seen.denyTools) return { deny: 'denied by a PreToolUse hook' }
    seen.toolRuns.push(e.tool === 'Bash' ? `Bash ${String(e.command)}` : String(e.tool))
    return { result: e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false } : { content: [] }, text: 'done' } as any
  })
  // I2e: the engine beneath a Skill tool call: it runs the skill (records it) and answers as an inline run does.
  on('tool.call', { tool: 'Skill' }, async ($, e) => {
    if (seen.denyTools) return { deny: 'denied by a PreToolUse hook' }
    if (seen.skillErrors) return { isError: true, result: `Unknown skill: ${String(e.skill)}`, text: `Unknown skill: ${String(e.skill)}` } as any
    seen.toolRuns.push(`Skill ${String(e.skill)}`)
    return { result: { success: true, commandName: String(e.skill), status: 'inline' }, text: 'done' } as any
  })
  on('store.get', async ($, e) => ({ value: seen.store[e.key] }))
  on('store.set', async ($, e) => {
    seen.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    const timeoutMs = e.init?.timeoutMs
    seen.calls.push({ argv, timeoutMs, at: seen.clock.now() })
    if (argv[0] === '/usr/bin/open') {
      if (seen.openResult === 'refuse') return { deny: 'HooksError: review-pair: $.process.run(/usr/bin/open) failed to start' }
      return { value: ran(seen.openResult === 'ok' ? 0 : 1, '', seen.openResult === 'ok' ? '' : 'LSOpenURLsWithRole() failed') }
    }
    if (argv[0] !== 'gh' || !seen.hasGh) return { deny: REAL.noGh }
    if (argv[1] === '--version') return { value: ran(0, 'gh version 2.102.0 (2026-09-30)\n') }
    const isQueue = isDocument(argv, QUEUE)
    const isViewer = isDocument(argv, VIEWER)
    const isDetail = isDocument(argv, DETAIL_PR, DETAIL_ISSUE)
    const isTrend = isDocument(argv, TREND)
    const isIssues = isDocument(argv, ISSUES_DOC)
    const isRefs = isDocument(argv, REFS)
    const key = isQueue
      ? 'queue'
      : isViewer
        ? 'viewer'
        : isDetail
          ? `detail ${cardKey(argv)}`
          : isTrend
            ? 'trend'
            : isIssues
              ? 'issues'
              : isRefs
                ? 'refs'
                : cardKey(argv)
    const mode = seen.modes[key] ?? seen.modes['*'] ?? { kind: 'ok' }
    if (mode.kind === 'slow') {
      // The engine kills a child still running at its timeoutMs and rejects with its own words.
      const limit = timeoutMs ?? 30_000
      await seen.clock.sleep(Math.min(mode.ms, limit))
      if (mode.ms >= limit) return { deny: REAL.timedOut(limit) }
    }
    if (mode.kind === 'refuse') return { deny: mode.reason }
    if (mode.kind === 'exit') return { value: ran(mode.exitCode ?? 1, mode.stdout ?? '', mode.stderr) }
    if (mode.kind === 'stdout') return { value: ran(0, mode.stdout) }
    if (isViewer) return { value: ran(0, JSON.stringify(seen.viewer)) }
    const repo = `${valueOf(argv, 'owner')}/${valueOf(argv, 'name')}`
    if (isTrend) {
      const page = seen.trends[repo]?.[valueOf(argv, 'after') ?? 'first']
      return page === undefined ? { value: ran(1, '', 'gh: Could not resolve to a Repository.') } : { value: ran(0, JSON.stringify(page)) }
    }
    const answer = isQueue || isIssues ? seen.queues[repo] : isRefs ? seen.refs[repo] : isDetail ? seen.details[cardKey(argv)] : seen.answers[key]
    if (answer === undefined && (isQueue || isIssues || isRefs)) return { value: ran(1, '', 'gh: Could not resolve to a Repository.') }
    if (answer === undefined) return { value: ran(1, '', `gh: Could not resolve to a PullRequest with the number of ${valueOf(argv, 'number')}.`) }
    return { value: ran(0, JSON.stringify(answer)) }
  })
  on('ui.open', async ($, e) => {
    seen.opened.push(e.id)
    return { value: seen.placement }
  })
  on('ui.close', async ($, e) => {
    seen.closed.push(e.id)
    await seen.onClose?.()
    return { value: undefined }
  })
  on('ui.panes', async () => {
    seen.paneReads += 1
    return { value: seen.panes }
  })
  // I2: records the ui.focus events a test replays (the person's Tab, an arrow on a fitting tree). The kit holds no
  // focus ring, so a plugin's own $.ui.focus is refused as 'no implementation' before any hook, like its $.ui.scroll.
  on('ui.focus', async ($, e) => {
    const raised = e as { element?: string; key?: string; origin?: { kind?: string } }
    seen.focused.push({ element: raised.element ?? raised.key, origin: String(raised.origin?.kind) })
    return {}
  })
  on('ui.status', async ($, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('env.get', async ($, e) => ({ value: e.name === 'REVIEW_PAIR_BOARD_DIR' ? seen.boardDir : undefined }))
  const boardFile = (path: string) => (path.startsWith(`${BOARD_DIR}/`) ? path.slice(BOARD_DIR.length + 1) : undefined)
  on('fs.read', async ($, e) => {
    seen.fsCalls.push(`read ${e.path}`)
    const text = seen.board[boardFile(e.path) ?? '']
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.stat', async ($, e) => {
    seen.fsCalls.push(`stat ${e.path}`)
    const name = boardFile(e.path)
    if (name === undefined || !(name in seen.board)) return { deny: `ENOENT: ${e.path}` }
    return { value: { kind: 'file' as const, size: seen.board[name]?.length ?? 0, mtimeMs: seen.boardWritten, isLink: false } }
  })
  on('ui.toast', async ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', async ($, e) => {
    seen.copies.push({ text: e.text, surface: e.surface })
    return { value: seen.isCopied ? { isCopied: true as const } : { isCopied: false as const, reason: 'no-clipboard' as const } }
  })
  // Anything that would act or reach out beyond gh and open is recorded, so a test can show it never happens.
  on('prompt.submit', async ($, e) => {
    seen.outward.push(`prompt.submit ${e.text}`)
    return { text: e.text }
  })
  on('mcp.call', async ($, e) => {
    seen.outward.push(`mcp.call ${JSON.stringify(e)}`)
    return { value: { content: [], isError: false } }
  })
  on('http.fetch', async ($, e) => {
    seen.outward.push(`http.fetch ${JSON.stringify(e)}`)
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('skill.prompt', async ($, e) => ({ text: e.text }))
  on('turn.complete', async ($, e) => ({ text: e.answer }))
  on('classic.SessionStart', async () => ({}))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('tool.register', async ($, e) => ({ value: { tool: `mcp__review-pair__${e.name}` } }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  return seen
}

// I2e: arms the session the way the pr-maintainer skill does, with a show call (one with no items, which reads
// nothing: the pane stays where it is and the queue read waits for the turn's end). A session not armed this way, by
// the Skill tool or by /review-pair reads nothing and sets no status line, whatever the store holds (armed.test.ts).
export async function arm($: any): Promise<void> {
  await $.tool.call({ tool: TOOL, tool_use_id: 'arm', items: [] })
}

export const PAIR = {
  repo: PRA,
  left: 3,
  items: [
    {
      number: 4045,
      action: 'approve and merge',
      confidence: 9,
      contributorActs: false,
      why: 'Narrow fix with tests; the one Copilot thread is a nit.',
      draft: 'Thanks @PeterDaveHello, approving and merging.',
      head: '35a07ebb5e36',
    },
    {
      number: 2450,
      action: 'COMMENT with one inline suggestion',
      confidence: 7,
      contributorActs: true,
      draft: 'Thanks, one ask below.',
      head: '1234567',
      inline: [{ path: 'pr_agent/git_providers/gitlab_provider.py', line: 979, body: 'Could this reuse `_as_line`?' }],
    },
  ],
}

export const TFL_PAIR = {
  repo: TFL,
  items: [
    { number: 2998, action: 'COMMENT asking for the dmg fix', confidence: 6, contributorActs: true, head: '8962ae8' },
    { number: 3090, action: 'approve the held release CI', confidence: 8, head: 'bec5a6c' },
  ],
}

// I2: a collapsible group (the queue's author and parked, a long issues section) draws as one row until opened; the
// tests that read rows under one open it first, by the group's own Button, as Enter or a click does.
export async function opened(ui: any, ...groups: string[]): Promise<void> {
  for (const group of groups) {
    const row = await ui.find({ type: 'Box', key: `row-${group}` })
    if (row !== undefined && textOf(row).includes('enter opens')) await ui.press({ key: group })
  }
}

// The pair view draws one status line per item; the tests that read the rows behind it open them first with s, which
// stays open for that item across mounts and refreshes.
export async function detailed(ui: any): Promise<void> {
  const key = await ui.find({ type: 'Button', key: 'details' })
  if (key?.props?.label === 'details') await ui.press({ key: 'details' })
}

// The plain text a drawn element shows, its nested Text included.
export function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const element = node as RenderElement & { children?: unknown[]; props?: Record<string, unknown> }
  const label = element.type === 'Button' ? String(element.props?.label ?? '') : ''
  return label + (element.children ?? []).map(textOf).join('')
}

// A row part as the terminal paints it: a plain Button with a hotkey reads 'a: #2445'.
function partOf(node: unknown): string {
  const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const inner = element.children?.length === 1 ? (element.children[0] as typeof element) : undefined
  const button = element.type === 'Button' ? element : inner?.type === 'Button' ? inner : undefined
  if (button !== undefined) return button.props?.hotkey === undefined ? String(button.props?.label) : `${String(button.props.hotkey)}: ${String(button.props?.label)}`
  return textOf(node)
}

// The rows of the pane's column, top to bottom, as the words each one shows ('▲ a: #2445 linked issue already closed').
export async function columnOf(ui: { drawn: () => Promise<RenderElement> }): Promise<string[]> {
  const root = (await ui.drawn()) as unknown as { children?: unknown[] }
  // Spacer rows between the pair view's groups are blank; the column lists the rows that carry words.
  const children = (root.children ?? []).filter(child => !String((child as { props?: Record<string, unknown> }).props?.key ?? '').startsWith('gap-'))
  type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const keyOf = (node: unknown) => String((node as Drawn).props?.key ?? '')
  const rowOf = (box: Drawn) => (box.children ?? []).map(partOf).join(' ')
  return children.flatMap(child => {
    const box = child as Drawn
    // The status line reads as its parts, and the rows s opens under it as rows of their own.
    if (keyOf(box) === 'status') return [(box.children ?? []).map(part => (keyOf(part).startsWith('row-') ? rowOf(part as Drawn) : partOf(part))).join(' ')]
    if (keyOf(box) === 'status-rows') return (box.children ?? []).map(row => rowOf(row as Drawn))
    const isRow = box.type === 'Box' && keyOf(box).startsWith('row-')
    return [isRow ? rowOf(box) : textOf(child)]
  })
}

// The innermost Text showing the words carries the colour; its row's glyph is the Text before it.
export async function glyphOf(ui: any, words: string | RegExp): Promise<{ glyph: string; color: unknown } | undefined> {
  const rows: { key?: string; children: unknown[] }[] = await ui.findAll({ type: 'Box', text: words })
  const row = rows.filter(box => String(box.key ?? '').startsWith('row-')).pop()
  const first = row?.children[0] as { children?: { props?: { color?: unknown }; children?: unknown[] }[] } | undefined
  const glyph = first?.children?.[0]
  return glyph === undefined ? undefined : { glyph: textOf(glyph), color: glyph.props?.color }
}
