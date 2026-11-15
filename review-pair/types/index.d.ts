export type InlineComment = { path: string; line: number; body: string }

// I5: what posting an item's draft would do, as the show call says it; the pane never parses the action string.
export type Verb = 'pending' | 'comment' | 'approve' | 'approve-merge' | 'request-changes' | 'close'

// I5: verb and sensitive as the show call gave them (both optional until the skill passes them, I6); textHash: the
// whole SHA-256 in hex of the item's draft and inline comments (text.ts canonicalText; the pane shows its first 6),
// worked out once at show time and never from GitHub, absent for an item with neither.
export type PairItem = {
  number: number
  kind?: 'pr' | 'issue'
  action: string
  confidence?: number
  contributorActs?: boolean
  why?: string
  // The evidence bullets Claude printed under the item, verbatim, one string each.
  evidence?: string[]
  draft?: string
  inline?: InlineComment[]
  head?: string
  verb?: Verb
  sensitive?: boolean
  textHash?: string
}

// I5: one item of the decision ledger, keyed repo#number: what its last show gave (verb, textHash, head as given) and
// when, and the marks. seenAt, seenHash, seenHead: when its tab was shown in the focused pane with its draft's end in
// view, the hash then, and the live head the card held then (the head as given before any read). changedAt: a later
// show gave another hash or head, or a card read another live head, since it was seen; the next seen clears it. held:
// the h key's mark, nothing else. writtenAt: a write of Claude's named it (the drawn word is merged once a card read
// after it says merged).
export type LedgerEntry = {
  repo: string
  number: number
  verb?: Verb
  textHash?: string
  head?: string
  shownAt: number
  seenAt?: number
  seenHash?: string
  seenHead?: string
  changedAt?: number
  held?: true
  writtenAt?: number
}

export type Pair = { repo: string; items: PairItem[]; left?: number }

// The fixed words a failed gh call is told by: the only failure text the model or the pane ever sees.
export type Phrase =
  | 'GitHub timed out'
  | 'gh not found on PATH'
  | 'GitHub sign-in failed: run gh auth login'
  | 'GitHub rate limit reached'
  | 'GitHub unreachable: offline?'
  | 'GitHub error'

// A list GitHub sent short of its total: what was read, of how many.
export type Short = { read: number; total: number }

export type Ci = {
  // Which rule matched; the model is told this and the count, never a check's name.
  state: 'failing' | 'held' | 'unknown' | 'running' | 'not-run' | 'passed'
  tier: 'ok' | 'warn' | 'bad'
  // The words after 'CI ': 'passed · 9 checks', 'failing · dmg', 'held for your approval'.
  text: string
  // Failing checks, counted for the model, which never sees their names.
  failing?: number
  // The first failing check's permalink, only when it passed the log allow-list.
  log?: string
}

export type Thread = { isBot: boolean; path: string; line?: number }

export type Code = { category: string; path: string }

export type Linked = {
  number: number
  // nameWithOwner as GitHub sent it; only one equal to the pair's repo gets a key.
  repo: string
  isSameRepo: boolean
  isClosed: boolean
  // Other open pull requests in the same repository that reference the issue.
  rivals: number[]
  // Open pull requests in other repositories, drawn as plain text.
  others: string[]
  refsShort?: Short
}

// What one card read says about a pull request, cleaned, before any reviewed item is compared with it.
export type PrRead = {
  kind: 'pr'
  at: number
  title: string
  author: string
  isBot: boolean
  association: string
  createdAt: number
  additions: number
  deletions: number
  changedFiles: number
  state: string
  isDraft: boolean
  // The full head SHA, or '' when GitHub's did not look like one.
  head: string
  base: string
  canModify: boolean
  merge: string
  // GitHub's reviewDecision when it is one of APPROVED, CHANGES_REQUESTED or REVIEW_REQUIRED, else ''.
  decision: string
  // undefined: not known from what was read.
  changesRequested?: boolean
  reviewsShort?: Short
  ci: Ci
  threads: Thread[]
  threadsShort?: Short
  breaking?: boolean
  labelsShort?: Short
  code: Code[]
  filesShort?: Short
  settings: boolean
  linked: Linked[]
  linkedShort?: Short
}

export type IssueRead = {
  kind: 'issue'
  at: number
  title: string
  author: string
  isOpen: boolean
  labels: string[]
  labelsShort?: Short
}

// One item's card: the last good read, and the phrase of a refresh that failed after it. basis: what the next good
// read is compared with for a change toast (github.ts basisOf). posted: this read followed a write of Claude's on
// the item (I1: the POSTED pill), gone with the next read.
export type Card = { read?: PrRead | IssueRead; failed?: Phrase; basis?: PrRead | IssueRead; posted?: true }

export type View = 'pair' | 'queue' | 'issues' | 'detail'

// One pull request or issue shown in the detail view (I2b): which, the view it was opened from and the key of the
// Button that opened it there, brought back into view on back, and the detail's own offset under its fixed head rows.
// I2: back is also the origin list's cursor row, which j and k move as the detail walks its neighbours.
export type Detail = { repo: string; kind: 'pr' | 'issue'; number: number; from: Exclude<View, 'detail'>; back: string; scroll: number }

// I2: each list view's cursor, the key of its focused row (a row's Button or a collapsed group's), and the groups
// opened in place. Kept in $.state per view; the cursors are mirrored to $.store for the restore after /clear.
export type ListView = 'queue' | 'issues'
export type GroupView = 'queue' | 'issues'
export type Cursor = Partial<Record<ListView, string>>
export type Expanded = Record<GroupView, string[]>

// One part of a detail read and when it was read: a later read that could not read it keeps it with that time.
export type Part<T> = { at: number; value: T }

// A body's lines as kept (I2d: whole, under github.ts's storage caps), a run of blank lines between them as one '',
// and how many non-empty lines the caps left out.
export type Body = { lines: string[]; more: number }

// One comment or review of the Latest list. who: 'you', 'author' or the login, cleaned; body: its words, whole.
export type DetailEntry = {
  who: string
  isBot: boolean
  kind: 'COMMENT' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'comment'
  at: number
  body: Body
}

export type DetailFile = { path: string; additions: number; deletions: number }

// What one detail read says, cleaned. The head (number, title, state, author) is required: without it the read failed.
// A part left out could not be read, by this read or any before it.
export type DetailRead = {
  kind: 'pr' | 'issue'
  at: number
  number: number
  title: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  author: string
  isBot: boolean
  createdAt: number
  labels?: { names: string[]; total: number }
  head?: string
  ci?: 'passed' | 'failing' | 'running' | 'not-run' | 'unknown'
  additions?: number
  deletions?: number
  description?: Part<Body>
  latest?: Part<DetailEntry[]>
  files?: Part<{ list: DetailFile[]; total: number }>
}

// The shown item's detail: the last good read, and the phrase of a read that failed after it.
export type DetailCard = { key: string; read?: DetailRead; failed?: Phrase }

// One open pull request or issue of a queue read, cleaned. group: a ready PR's group from the read alone (github.ts
// groupOf); absent for a draft and when the read could not tell. owe: the author spoke last.
// heardAt: the latest word of a person (the opening, a comment or a review), absent when the read cannot tell; a board
// call older than it gives way to the read.
// author: the login as GitHub sent it when it looked like one (github.ts LOGIN), absent otherwise.
// isApproved (I2, Q8): the viewer's last review approved it and the approval stands (S3): on the head, with no
// person's word after it. head: the head SHA when GitHub's looked like one (I2: the master-detail column draws it from
// the queue read, before any detail read).
export type QueuePr = {
  number: number
  title: string
  createdAt: number
  isDraft: boolean
  author?: string
  group?: 'mine' | 'parked' | 'nobody' | 'owe' | 'author'
  heardAt?: number
  isApproved?: true
  head?: string
}
// section: an open issue's section from the read alone (github.ts sectionOf); absent when the read could not tell.
// isUnsure: its cross-references were not all read, so a section other than pr is the read's best answer. askedAt: the
// latest word of a person who is not a maintainer; a board call older than it gives way to the read.
export type QueueIssue = {
  number: number
  title: string
  createdAt: number
  section?: 'pr' | 'nobody' | 'owe' | 'blocked' | 'community' | 'reporter'
  isUnsure?: true
  askedAt?: number
}

export type QueueRead = {
  prs: QueuePr[]
  prTotal: number
  // GitHub has more open pull requests than one read holds: every count over them is unknown.
  prsShort: boolean
  // The issues come from their own reads: issueTotal is absent when that read failed, with why in issuesFailed, and
  // refsFailed says why their cross-references are unknown.
  issues: QueueIssue[]
  issueTotal?: number
  issuesFailed?: Phrase
  refsFailed?: Phrase
}

// The board's two files of human calls, pr-agent only: bucket and section names by number (notes are never read), when
// each file was last written, and since: when the mod first saw each standing call, by "number:name", which a later
// word of a person on the item overrides.
export type Board = { buckets: Record<string, string>; sections: Record<string, string>; bucketsAt: number; sectionsAt: number; since: Record<string, number> }

// The weekly means of open PRs over the 16 weeks to `day` (UTC), worked out from GitHub at `at`; failed: why there are
// none, in fixed words: a read short of the open PRs, the page cap or a phrase.
export type Trend = {
  repo: string
  day: string
  at: number
  weeks?: number[]
  failed?: Phrase | 'more than 100 open PRs' | `more than ${number} PRs closed in 16 weeks`
}

// What a failed gh call says past its phrase, in numbers and GitHub's upper-case error codes only (github.ts runFactsOf):
// stderr's words still go nowhere. The pane draws them under y; the model never reads them.
export type RunFacts = { exit?: number; status?: number; codes?: string[] }

// A failed queue read: which read failed, when, its phrase and its facts.
export type Fault = RunFacts & { phrase: Phrase; at: number; read: 'viewer' | 'pull requests' }

// The queue of the last repo shown: the last good read and when it was made (`at`), and the phrase and fault of a
// read that failed after it. A failure keeps the read, so the lists stay with their time; with no read, `at` is the
// failure's.
export type Queue = { repo: string; at: number; read?: QueueRead; failed?: Phrase; fault?: Fault; board: Board | 'none' | 'unreadable' }

declare module 'claude-code' {
  interface PluginState {
    'review-pair': {
      pair: Pair | null
      cards: Record<string, Card>
      tab: number
      dismissed: boolean
      toasted: boolean
      view: View
      // The last repo a show call named, mirrored from $.store so a drawing can read it.
      repo: string | null
      queue: Queue | null
      // I2e: whether this session runs maintainer duty: false until a show call, the Skill tool naming pr-maintainer,
      // the skill's prompt or /review-pair arms it, and after /clear unless the pane is still placed. Dormant, the mod
      // reads nothing, sets no status line and runs no poll here.
      armed: boolean
      // Whether the legend is open: closed at the start, kept across refreshes and views.
      legend: boolean
      // Whether a failed read's facts are open (y): closed at the start, kept like the legend.
      why: boolean
      // The pair items, by repo#number, whose evidence is open (e): closed at the start, kept while a show carries the
      // item over, emptied when the pair is cleared.
      evidence: string[]
      // The pair items whose status rows are open under their status line (s), kept and emptied like evidence.
      details: string[]
      detail: Detail | null
      detailCard: DetailCard | null
      // The last repo's trend, and whether an r press is still reading.
      trend: Trend | null
      refreshing: boolean
      // I2: the list views' cursors and opened groups, and the master-detail column's read of the cursor's item.
      cursor: Cursor
      expanded: Expanded
      side: DetailCard | null
      // I5: the decision ledger, per session and kept when a show replaces or clears the pair: an entry per item shown,
      // by repo#number, its keys in the order they were last touched, the 40 most recent kept. /clear empties it, as it
      // empties every atom; Claude re-shows.
      ledger: Record<string, LedgerEntry>
    }
  }
  interface McpToolInputs {
    'mcp__review-pair__show': { repo?: string; left?: number; items: Omit<PairItem, 'textHash'>[] }
  }
}
