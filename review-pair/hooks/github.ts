import type {
  Board,
  Body,
  Card,
  Ci,
  Code,
  DetailCard,
  DetailEntry,
  DetailRead,
  RunFacts,
  IssueRead,
  Linked,
  PairItem,
  Phrase,
  PrRead,
  Queue,
  QueueIssue,
  QueuePr,
  QueueRead,
  Thread,
} from '../types'
import { clean, hiddenRuns, line, openFence } from './text'

// Fixed documents: only owner, name and a validated integer travel, as variables. Every list carries its
// totalCount, so a read short of it can say the fact is unknown.
export const CARD = `query Card($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      state
      isDraft
      createdAt
      author { login __typename }
      authorAssociation
      headRefOid
      baseRefName
      headRepositoryOwner { login }
      maintainerCanModify
      mergeStateStatus
      reviewDecision
      additions
      deletions
      changedFiles
      labels(first: 10) { totalCount nodes { name } }
      files(first: 30) { totalCount nodes { path } }
      closingIssuesReferences(first: 5) {
        totalCount
        nodes {
          number
          state
          repository { nameWithOwner }
          timelineItems(first: 20, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
            totalCount
            nodes {
              ... on CrossReferencedEvent { source { ... on PullRequest { number state repository { nameWithOwner } } } }
              ... on ConnectedEvent { subject { ... on PullRequest { number state repository { nameWithOwner } } } }
            }
          }
        }
      }
      reviewThreads(first: 50) {
        totalCount
        nodes { isResolved isOutdated path line comments(first: 1) { nodes { author { login __typename } } } }
      }
      latestReviews(first: 10) { totalCount nodes { author { login __typename } state } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 50) {
                totalCount
                nodes {
                  ... on CheckRun { name conclusion status permalink }
                  ... on StatusContext { context state }
                }
              }
            }
            checkSuites(first: 50) { totalCount nodes { conclusion workflowRun { event } } }
          }
        }
      }
    }
  }
}`

export const ISSUE = `query Issue($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { title state author { login } labels(first: 10) { totalCount nodes { name } } }
  }
}`

// Never on the show path: the open pull requests oldest first, with what their group needs (who spoke last, holds and
// assignees). Only owner, name and the viewer's checked login travel, as -f strings. I2 (Q8): the viewer's last review
// carries its state, a scalar on a node already read (cost 6 points on pr-agent before and after, rateLimit { cost }
// measured 2026-10-18); reviewDecision would say the same of anyone's approval, and the owe rule is the viewer's own.
// The comments carry their body, to tell the viewer's published pr-agent output from a word of the viewer's: GraphQL
// has no substring or truncated body, so the whole body is read; measured 2026-11-08 on pr-agent, the 100 open PRs'
// last 10 comments are 274 KB with the body against 15 KB without (about 260 KB more).
export const QUEUE = `query Queue($owner: String!, $name: String!, $me: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage }
      nodes {
        number
        title
        createdAt
        isDraft
        headRefOid
        author { login __typename }
        mine: reviews(last: 1, author: $me, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { state submittedAt commit { oid } } }
        reviews(last: 10) { totalCount nodes { author { login __typename } authorAssociation submittedAt } }
        comments(last: 10) { totalCount nodes { author { login __typename } authorAssociation createdAt body } }
        commits(last: 1) { nodes { commit { committedDate author { user { login } } } } }
        labels(first: 10) { totalCount nodes { name } }
        assignees(first: 5) { totalCount nodes { login } }
      }
    }
  }
}`

// Read beside QUEUE, so a large repo's limits cost only the issues: the open issues newest first, with what their
// section needs (who spoke last, labels and the open pull requests that close them).
export const ISSUES = `query Issues($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number
        title
        createdAt
        author { login __typename }
        authorAssociation
        comments(last: 10) { totalCount nodes { author { login __typename } authorAssociation createdAt } }
        labels(first: 10) { totalCount nodes { name } }
        closedByPullRequestsReferences(first: 5) { totalCount nodes { state } }
      }
    }
  }
}`

// The same issues' last 25 cross-references, on their own: nested in ISSUES they exceed GitHub's resource limits on
// cli/cli (measured 2026-10-11), alone they take 5 to 7 s there and 1 s on pr-agent.
export const REFS = `query Refs($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number
        timelineItems(last: 25, itemTypes: [CROSS_REFERENCED_EVENT]) { totalCount nodes { ... on CrossReferencedEvent { source { ... on PullRequest { state repository { nameWithOwner } } } } } }
      }
    }
  }
}`

// The trend's other half: closed and merged pull requests, the latest updated first, a page at a time. closedAt is never
// after updatedAt, so the pages stop at the first one updated before the window. Only owner, name and GitHub's own
// cursor travel, as -f strings.
export const TREND = `query Trend($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: [CLOSED, MERGED], first: 100, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { createdAt closedAt updatedAt }
    }
  }
}`

export const VIEWER = `query Viewer { viewer { login } }`

// The detail view's reads, one per open and poll: sized to what it draws (5 labels, 8 files, the last 5 comments) and
// naming the viewer, who is 'you'. The last 20 reviews, since the empty shells of review-thread replies take places
// in that window and are not drawn. Each costs 1 point (rateLimit { cost }, measured 2026-10-11).
export const DETAIL_PR = `query Detail($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      state
      isDraft
      createdAt
      author { login __typename }
      headRefOid
      additions
      deletions
      body
      labels(first: 5) { totalCount nodes { name } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      files(first: 8) { totalCount nodes { path additions deletions } }
      comments(last: 5) { totalCount nodes { author { login __typename } createdAt body } }
      reviews(last: 20, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { totalCount nodes { author { login __typename } state submittedAt body } }
    }
  }
}`

export const DETAIL_ISSUE = `query IssueDetail($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number
      title
      state
      createdAt
      author { login __typename }
      body
      labels(first: 5) { totalCount nodes { name } }
      comments(last: 5) { totalCount nodes { author { login __typename } createdAt body } }
    }
  }
}`

// The boundary: what reaches gh or a URL is a GitHub owner/name, a reviewed head and integers, nothing else.
export const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/
export const HEAD = /^[0-9a-f]{7,40}$/
export const LOGIN = /^[A-Za-z0-9-]{1,39}$/
// The board (update_board.py's files), read only for its own repo from the folder REVIEW_PAIR_BOARD_DIR names; notes
// are never read.
export const BOARD_REPO = 'The-PR-Agent/pr-agent'
// The maintainer skill under its local and its published name: either arms the session.
export const SKILLS = ['pr-maintainer', 'pr-agent-maintainer']
export const GH_TIMEOUT_MS = 8_000
export const OPEN_TIMEOUT_MS = 5_000
// From this age a read loses its tick.
export const STALE_MS = 5 * 60_000

const BAD = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE']
const DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']
const PASSED = ['SUCCESS', 'NEUTRAL']
const MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'package.json', 'Makefile', 'electron-builder.yml', 'electron-builder.json']
const LOCKFILES = ['uv.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock']
const SETTINGS = 'pr_agent/settings/'

export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

// The one argv builder: gh api graphql, a constant document, owner and name as -f strings, one -F integer.
export function ghArgs(document: string, repo: string, number: number): string[] | undefined {
  if (!REPO.test(repo) || !isCount(number)) return undefined
  const [owner = '', name = ''] = repo.split('/')
  return ['api', 'graphql', '-f', `query=${document}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`]
}

export const VIEWER_ARGS = ['api', 'graphql', '-f', `query=${VIEWER}`]

// The queue read: the constant document, owner, name and the checked login, each a -f string.
export function queueArgs(repo: string, login: string): string[] | undefined {
  if (!REPO.test(repo) || !LOGIN.test(login)) return undefined
  const [owner = '', name = ''] = repo.split('/')
  return ['api', 'graphql', '-f', `query=${QUEUE}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `me=${login}`]
}

// A read of the whole repo (ISSUES, REFS, TREND): the constant document, owner and name, each a -f string.
export function repoArgs(document: string, repo: string): string[] | undefined {
  if (!REPO.test(repo)) return undefined
  const [owner = '', name = ''] = repo.split('/')
  return ['api', 'graphql', '-f', `query=${document}`, '-f', `owner=${owner}`, '-f', `name=${name}`]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The maintainer board, the one page outside a repository the pane opens (a), matched whole.
export const BOARD_URL = 'https://claude.ai/artifact/YKMsbTsPNF3a9MbrGjPSR9'
export const isItemUrl = (url: unknown, repo: string) =>
  typeof url === 'string' && REPO.test(repo) && new RegExp(`^https://github\\.com/${escape(repo)}/(pull|issues)/[0-9]+$`).test(url)

export const isLogUrl = (url: unknown, repo: string) =>
  typeof url === 'string' &&
  REPO.test(repo) &&
  new RegExp(`^https://github\\.com/${escape(repo)}/(actions/runs/[0-9]+/job/[0-9]+|runs/[0-9]+)$`).test(url)

// Built from the checked repo, pull or issues and the integer, then held to the allow-list it must match.
export function itemUrl(repo: string, kind: 'pull' | 'issues', number: number): string | undefined {
  if (!REPO.test(repo) || !isCount(number)) return undefined
  const url = `https://github.com/${repo}/${kind}/${number}`
  return isItemUrl(url, repo) ? url : undefined
}

// Why gh failed, in fixed words: its stderr can carry text from GitHub, so it never travels further.
export function phraseOf(stderr: string): Phrase {
  if (/HTTP 401|auth login|authentication/i.test(stderr)) return 'GitHub sign-in failed: run gh auth login'
  if (/rate limit/i.test(stderr)) return 'GitHub rate limit reached'
  if (/error connecting|connection refused|no such host|proxyconnect|network is unreachable/i.test(stderr)) {
    return 'GitHub unreachable: offline?'
  }
  return 'GitHub error'
}

// A run of gh that exited: JSON with no errors, or a phrase. A partial answer is no answer.
export function answerOf(exitCode: number, stdout: string, stderr: string): { json: unknown } | { failed: Phrase } {
  if (exitCode !== 0) return { failed: phraseOf(stderr) }
  try {
    const json: unknown = JSON.parse(stdout)
    return isNode(json) && json.errors === undefined ? { json } : { failed: 'GitHub error' }
  } catch {
    return { failed: 'GitHub error' }
  }
}

// A detail read may be partial: GitHub answers a field it could not resolve with null and an error, and gh exits 1
// with that JSON on stdout. Any answer holding data is parsed part by part; stderr still goes nowhere.
export function partialOf(exitCode: number, stdout: string, stderr: string): { json: unknown } | { failed: Phrase } {
  try {
    const json: unknown = JSON.parse(stdout)
    if (isNode(json) && isNode(json.data)) return { json }
  } catch {
    // Not JSON: told by the exit and stderr below.
  }
  return { failed: exitCode !== 0 ? phraseOf(stderr) : 'GitHub error' }
}

const ERROR_CODE = /^[A-Z][A-Z_]{1,39}$/

// What a failed run says past its phrase, as numbers and GitHub's error codes only: the exit, the HTTP status gh
// names in stderr, and up to three upper-case `type`s of a GraphQL errors list on stdout. No other text is kept.
export function runFactsOf(exitCode: number, stdout: string, stderr: string): RunFacts {
  const facts: RunFacts = {}
  if (Number.isInteger(exitCode) && exitCode !== 0) facts.exit = exitCode
  const status = Number(/\bHTTP ([1-5][0-9]{2})\b/.exec(stderr)?.[1])
  if (Number.isInteger(status)) facts.status = status
  try {
    const json: unknown = JSON.parse(stdout)
    const errors = isNode(json) && Array.isArray(json.errors) ? json.errors : []
    const codes = [...new Set(errors.map(one => (isNode(one) ? one.type : undefined)).filter((type): type is string => typeof type === 'string' && ERROR_CODE.test(type)))]
    if (codes.length > 0) facts.codes = codes.slice(0, 3)
  } catch {
    // No JSON on stdout: no codes.
  }
  return facts
}

type Node = Record<string, unknown>
type Short = { read: number; total: number }
type List = { nodes: Node[]; short?: Short }

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((here, step) => (here !== null && typeof here === 'object' ? (here as Node)[step] : undefined), value)
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const short7 = (sha: string) => sha.slice(0, 7)

// A connection as the documents ask for it; undefined when GitHub sent another shape.
function listOf(value: unknown): List | undefined {
  const nodes = at(value, 'nodes')
  const total = at(value, 'totalCount')
  if (!Array.isArray(nodes) || typeof total !== 'number' || !Number.isSafeInteger(total)) return undefined
  const list: List = { nodes: nodes.filter(isNode) }
  return total > nodes.length ? { ...list, short: { read: nodes.length, total } } : list
}

function categoryOf(path: string): string | undefined {
  if (path.startsWith('.github/workflows/')) return 'workflow'
  if (path.startsWith('.github/')) return '.github'
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (MANIFESTS.includes(name)) return 'manifest'
  if (LOCKFILES.includes(name)) return 'lockfile'
  if (name.startsWith('Dockerfile')) return 'Dockerfile'
  if (name === '.pre-commit-config.yaml') return 'pre-commit'
  if (name === 'conftest.py') return 'conftest'
  return undefined
}

// First match wins: GitHub's rollup says pass or fail, and only a pull_request run waiting for approval is a hold.
export function ciOf(commit: unknown, repo: string): Ci | undefined {
  const rollup = at(commit, 'statusCheckRollup')
  const suites = listOf(at(commit, 'checkSuites'))
  if (suites === undefined || (rollup !== null && !isNode(rollup))) return undefined
  const contexts = rollup === null ? { nodes: [] } : listOf(rollup.contexts)
  if (contexts === undefined) return undefined
  const state = rollup === null ? undefined : rollup.state
  const outcome = (check: Node) => String(check.conclusion ?? check.state ?? '')
  if (state === 'FAILURE' || state === 'ERROR') {
    const failing = contexts.nodes.filter(check => BAD.includes(outcome(check)))
    const names = failing.slice(0, 2).map(check => line(check.name ?? check.context, 60))
    const more = failing.length > 2 ? ` +${failing.length - 2}` : ''
    const text = names.length > 0 ? `failing · ${names.join(', ')}${more}` : 'failing'
    const log = failing.map(check => check.permalink).find(url => isLogUrl(url, repo))
    const ci: Ci = { state: 'failing', tier: 'bad', text, failing: failing.length }
    return typeof log === 'string' ? { ...ci, log } : ci
  }
  const isHeld = suites.nodes.some(suite => suite.conclusion === 'ACTION_REQUIRED' && at(suite, 'workflowRun', 'event') === 'pull_request')
  if (isHeld) return { state: 'held', tier: 'warn', text: 'held for your approval' }
  if (suites.short !== undefined) {
    return { state: 'unknown', tier: 'warn', text: `unknown, ${suites.short.read} of ${suites.short.total} suites read` }
  }
  if (state === 'PENDING' || state === 'EXPECTED') return { state: 'running', tier: 'warn', text: 'running' }
  if (rollup === null) return { state: 'not-run', tier: 'warn', text: 'has not run' }
  if (contexts.short !== undefined) {
    return { state: 'unknown', tier: 'warn', text: `unknown, ${contexts.short.read} of ${contexts.short.total} checks read` }
  }
  if (state !== 'SUCCESS') return { state: 'unknown', tier: 'warn', text: 'unknown' }
  const passed = contexts.nodes.filter(check => PASSED.includes(outcome(check))).length
  if (passed === 0) return { state: 'not-run', tier: 'warn', text: 'has not run' }
  return { state: 'passed', tier: 'ok', text: `passed · ${plural(passed, 'check')}` }
}

function linkedOf(issue: Node, repo: string, number: number): Linked | undefined {
  const timeline = listOf(issue.timelineItems)
  if (!isCount(issue.number) || timeline === undefined) return undefined
  const owner = String(at(issue, 'repository', 'nameWithOwner') ?? '')
  const rivals = new Set<number>()
  const others = new Set<string>()
  for (const event of timeline.nodes) {
    const pr = at(event, 'source') ?? at(event, 'subject')
    if (!isNode(pr) || !isCount(pr.number) || pr.state !== 'OPEN') continue
    const where = String(at(pr, 'repository', 'nameWithOwner') ?? '')
    if (where.toLowerCase() !== repo.toLowerCase()) others.add(`${line(where, 140)}#${pr.number}`)
    else if (pr.number !== number) rivals.add(pr.number)
  }
  const linked: Linked = {
    number: issue.number,
    repo: line(owner, 140),
    isSameRepo: owner.toLowerCase() === repo.toLowerCase(),
    isClosed: issue.state === 'CLOSED',
    rivals: [...rivals],
    others: [...others],
  }
  return timeline.short === undefined ? linked : { ...linked, refsShort: timeline.short }
}

// One card read of a pull request, reduced to what the card draws; any other shape is a failed read.
export function cardOf(raw: unknown, repo: string, number: number, readAt: number): PrRead | Phrase {
  const pr = at(raw, 'data', 'repository', 'pullRequest')
  if (!isNode(pr)) return 'GitHub error'
  const labels = listOf(pr.labels)
  const files = listOf(pr.files)
  const closing = listOf(pr.closingIssuesReferences)
  const threads = listOf(pr.reviewThreads)
  const reviews = listOf(pr.latestReviews)
  const commit = at(pr, 'commits', 'nodes', '0', 'commit')
  const ci = ciOf(commit, repo)
  if (!labels || !files || !closing || !threads || !reviews || !isNode(commit) || ci === undefined) return 'GitHub error'
  const linked = closing.nodes.map(issue => linkedOf(issue, repo, number))
  if (linked.some(one => one === undefined)) return 'GitHub error'

  const decision = pr.reviewDecision
  const isRequested = decision === 'CHANGES_REQUESTED' || reviews.nodes.some(review => review.state === 'CHANGES_REQUESTED')
  // GitHub's own decision covers every review; without one, the latest reviews must all have been read.
  const isDecided = typeof decision === 'string' || reviews.short === undefined
  const isBreaking = labels.nodes.some(label => String(label.name ?? '').toLowerCase().includes('breaking'))
  const paths = files.nodes.map(file => String(file.path ?? ''))
  const code: Code[] = paths.flatMap(path => {
    const category = categoryOf(path)
    return category === undefined ? [] : [{ category, path: line(path, 200) }]
  })
  const open: Thread[] = threads.nodes
    .filter(thread => thread.isResolved === false && thread.isOutdated === false)
    .map(thread => {
      const where: Thread = { isBot: at(thread, 'comments', 'nodes', '0', 'author', '__typename') === 'Bot', path: line(thread.path, 200) }
      return isCount(thread.line) ? { ...where, line: thread.line } : where
    })
  const sha = String(pr.headRefOid ?? '')
  const read: PrRead = {
    kind: 'pr',
    at: readAt,
    title: line(pr.title, 200),
    author: line(at(pr, 'author', 'login'), 39),
    isBot: at(pr, 'author', '__typename') === 'Bot',
    association: line(pr.authorAssociation, 40).toLowerCase().replace(/_/g, ' '),
    createdAt: Date.parse(String(pr.createdAt ?? '')),
    additions: Number(pr.additions) || 0,
    deletions: Number(pr.deletions) || 0,
    changedFiles: Number(pr.changedFiles) || 0,
    state: String(pr.state ?? ''),
    isDraft: pr.isDraft === true,
    head: HEAD.test(sha) ? sha : '',
    base: line(pr.baseRefName, 100),
    canModify: pr.maintainerCanModify === true,
    merge: String(pr.mergeStateStatus ?? ''),
    decision: DECISIONS.find(one => one === decision) ?? '',
    ci,
    threads: open,
    code,
    settings: paths.some(path => path.startsWith(SETTINGS)),
    linked: linked.filter((one): one is Linked => one !== undefined),
  }
  if (isRequested || isDecided) read.changesRequested = isRequested
  else if (reviews.short !== undefined) read.reviewsShort = reviews.short
  if (isBreaking || labels.short === undefined) read.breaking = isBreaking
  if (labels.short !== undefined) read.labelsShort = labels.short
  if (threads.short !== undefined) read.threadsShort = threads.short
  if (files.short !== undefined) read.filesShort = files.short
  if (closing.short !== undefined) read.linkedShort = closing.short
  return read
}

export function issueOf(raw: unknown, readAt: number): IssueRead | Phrase {
  const issue = at(raw, 'data', 'repository', 'issue')
  const labels = listOf(at(issue, 'labels'))
  if (!isNode(issue) || labels === undefined) return 'GitHub error'
  const read: IssueRead = {
    kind: 'issue',
    at: readAt,
    title: line(issue.title, 200),
    author: line(at(issue, 'author', 'login'), 39),
    isOpen: issue.state === 'OPEN',
    labels: labels.nodes.map(label => line(label.name, 50)),
  }
  return labels.short === undefined ? read : { ...read, labelsShort: labels.short }
}

// I2d: the description and each comment or review are kept whole, to be wrapped by the view, under a storage cap of
// lines and code points (whichever first), so a 1 MB body never reaches a drawing whole; what is left is counted.
const DETAIL_LINES = 400
const DETAIL_POINTS = 40_000
const ENTRY_LINES = 200
const ENTRY_POINTS = 20_000
const PATH_MAX = 400
const LATEST = 5
const REVIEW_KINDS: Record<string, DetailEntry['kind']> = {
  COMMENTED: 'COMMENT',
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  DISMISSED: 'DISMISSED',
}
const CI_STATES: Record<string, NonNullable<DetailRead['ci']>> = {
  SUCCESS: 'passed',
  FAILURE: 'failing',
  ERROR: 'failing',
  PENDING: 'running',
  EXPECTED: 'running',
}

// At most `max` code points of one line, an ellipsis after a cut; its spaces and indentation as they were.
export function cutEnd(text: string, max: number): string {
  const kept: string[] = []
  for (const char of text) {
    if (kept.length === max) {
      kept.pop()
      return `${kept.join('')}…`
    }
    kept.push(char)
  }
  return kept.join('')
}

// Markdown left raw, each HTML comment dropped, on the text as GitHub received it. '<!-->' and '<!--->' are empty
// comments; one never closed runs to the end only when it opens its line, and inside a line it is text. Unlike GitHub,
// a comment inside a code fence is dropped too. One forward pass of indexOf, no regex.
export function uncommented(text: string): string {
  const parts: string[] = []
  let from = 0
  for (;;) {
    const open = text.indexOf('<!--', from)
    if (open === -1) break
    const close = text.indexOf('-->', open + 2)
    if (close === -1 && text.slice(text.lastIndexOf('\n', open) + 1, open).trim() !== '') break
    parts.push(text.slice(from, open))
    if (close === -1) return parts.join('')
    from = close + 3
  }
  parts.push(text.slice(from))
  return parts.join('')
}

// The non-empty lines of a body up to `maxLines` of them or `maxPoints` code points (the last line cut to what is
// left), a run of blank lines between them kept as one, each line's trailing spaces dropped and its indentation kept,
// and how many non-empty lines are left over. Markdown stays as written, fences included. A tab becomes four spaces:
// the engine draws one to the next eight-column stop where the wrap pass would count one column, and the row would
// overflow and lose its end to the truncate-end guard (a single-character class, linear).
function bodyOf(body: unknown, maxLines: number, maxPoints: number): Body | undefined {
  if (typeof body !== 'string') return undefined
  const lines: string[] = []
  let [shown, points, more, isGap] = [0, 0, 0, false]
  for (const raw of clean(uncommented(body)).split('\n')) {
    if (raw.trim() === '') {
      isGap = shown > 0
      continue
    }
    if (shown === maxLines || points >= maxPoints) {
      more += 1
      continue
    }
    if (isGap) lines.push('')
    isGap = false
    const kept = cutEnd(raw.replace(/\t/g, '    ').trimEnd(), maxPoints - points)
    lines.push(kept)
    points += Array.from(kept).length
    shown += 1
  }
  return { lines, more }
}

const descriptionOf = (body: unknown) => bodyOf(body, DETAIL_LINES, DETAIL_POINTS)
// A comment whose body is not a string (GitHub answered null) has no words, which is not a failed read.
const entryBodyOf = (body: unknown): Body => bodyOf(typeof body === 'string' ? body : '', ENTRY_LINES, ENTRY_POINTS) ?? { lines: [], more: 0 }

// 'you' for the viewer, 'author' for the item's author, else '@' and the login, so a login spelled 'you' never reads as
// either word; 'ghost' for a deleted account, as GitHub says.
function whoOf(node: Node, viewer: string | undefined, author: string | undefined): Pick<DetailEntry, 'who' | 'isBot'> {
  const login = at(node, 'author', 'login')
  const isBot = at(node, 'author', '__typename') === 'Bot'
  if (typeof login !== 'string') return { who: 'ghost', isBot }
  if (viewer !== undefined && isLogin(login, viewer)) return { who: 'you', isBot }
  if (author !== undefined && isLogin(login, author)) return { who: 'author', isBot }
  return { who: `@${line(login, 39)}`, isBot }
}

// The newest LATEST of the comments and reviews read. A review with no words is the shell of review-thread replies,
// which the list leaves out; one still pending has no time and is no word yet.
function latestOf(comments: unknown, reviews: unknown, viewer: string | undefined, author: string | undefined): DetailEntry[] | undefined {
  const said = listOf(comments)
  const reviewed = reviews === undefined ? { nodes: [] } : listOf(reviews)
  if (said === undefined || reviewed === undefined) return undefined
  const entries: DetailEntry[] = []
  for (const node of said.nodes) entries.push({ ...whoOf(node, viewer, author), kind: 'comment', at: timeOf(node.createdAt), body: entryBodyOf(node.body) })
  for (const node of reviewed.nodes) {
    const kind = REVIEW_KINDS[String(node.state)]
    const body = entryBodyOf(node.body)
    if (kind === undefined || (kind === 'COMMENT' && body.lines.length === 0)) continue
    entries.push({ ...whoOf(node, viewer, author), kind, at: timeOf(node.submittedAt), body })
  }
  return entries.filter(one => Number.isFinite(one.at)).sort((a, b) => b.at - a.at).slice(0, LATEST)
}

function stateOf(item: Node, kind: 'pr' | 'issue'): DetailRead['state'] | undefined {
  if (item.state === 'OPEN') return kind === 'pr' && item.isDraft === true ? 'draft' : 'open'
  if (item.state === 'CLOSED') return 'closed'
  return kind === 'pr' && item.state === 'MERGED' ? 'merged' : undefined
}

// One detail read: the head or nothing, then each part that could be read. A part GitHub answered null (a partial
// answer) or in another shape is left out, for the view to say unknown.
export function detailOf(raw: unknown, kind: 'pr' | 'issue', number: number, readAt: number): DetailRead | Phrase {
  const item = at(raw, 'data', 'repository', kind === 'pr' ? 'pullRequest' : 'issue')
  if (!isNode(item) || item.number !== number || typeof item.title !== 'string') return 'GitHub error'
  const state = stateOf(item, kind)
  if (state === undefined) return 'GitHub error'
  const viewer = at(raw, 'data', 'viewer', 'login')
  const login = at(item, 'author', 'login')
  const [me, author] = [typeof viewer === 'string' ? viewer : undefined, typeof login === 'string' ? login : undefined]
  const read: DetailRead = {
    kind,
    at: readAt,
    number,
    title: line(item.title, 200),
    state,
    author: author === undefined ? 'ghost' : line(author, 39),
    isBot: at(item, 'author', '__typename') === 'Bot',
    createdAt: timeOf(item.createdAt),
  }
  const labels = listOf(item.labels)
  if (labels !== undefined) read.labels = { names: labels.nodes.map(label => line(label.name, 50)), total: labels.short?.total ?? labels.nodes.length }
  const description = descriptionOf(item.body)
  if (description !== undefined) read.description = { at: readAt, value: description }
  const latest = latestOf(item.comments, kind === 'pr' ? item.reviews : undefined, me, author)
  if (latest !== undefined) read.latest = { at: readAt, value: latest }
  if (kind === 'issue') return read
  const sha = String(item.headRefOid ?? '')
  if (HEAD.test(sha)) read.head = sha
  const commit = at(item, 'commits', 'nodes', '0', 'commit')
  const rollup = isNode(commit) ? commit.statusCheckRollup : undefined
  read.ci = rollup === null ? 'not-run' : (CI_STATES[String(at(rollup, 'state'))] ?? 'unknown')
  if (isTotal(item.additions)) read.additions = item.additions
  if (isTotal(item.deletions)) read.deletions = item.deletions
  const files = listOf(item.files)
  if (files !== undefined) {
    const list = files.nodes.map(file => ({ path: line(file.path, PATH_MAX), additions: Number(file.additions) || 0, deletions: Number(file.deletions) || 0 }))
    read.files = { at: readAt, value: { list, total: files.short?.total ?? list.length } }
  }
  return read
}

// A later read of the same item: each part it could not read keeps the last good one, with that one's time.
export function mergeDetail(before: DetailRead | undefined, after: DetailRead): DetailRead {
  if (before === undefined) return after
  const merged = { ...after }
  if (merged.description === undefined && before.description !== undefined) merged.description = before.description
  if (merged.latest === undefined && before.latest !== undefined) merged.latest = before.latest
  if (merged.files === undefined && before.files !== undefined) merged.files = before.files
  return merged
}

// Local time, as the machine's clock reads it.
export function clockOf(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function ageOf(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

// How a row reads: bad and merged rows lead, then warn, then neutral notes; idle is not read yet.
export type Tier = 'ok' | 'warn' | 'bad' | 'merged' | 'note' | 'idle'

export type Row = {
  key: string
  tier: Tier
  // Words, GitHub's among them: drawn as marked Text, never as a Button label.
  text: string
  // Threads wrap, so a path never loses its :line.
  isWrapped?: true
  // A lettered Button: the allow-listed URL it opens and its short label, before the words or at the row's end.
  open?: { url: string; label: string; isTrailing?: true }
}

export type Facts = {
  title: string
  byline: string
  // Fixed rows: head and CI for a pull request, state and labels for an issue.
  head: Row
  ci: Row
  rows: Row[]
  clear?: Row
  // After a failed refresh or from five minutes on: no tick, and the other facts turn grey.
  isStale: boolean
  // How old the read is, or that its refresh failed, while it is stale.
  age?: string
  worst: Tier
}

const RANK: Record<Tier, number> = { bad: 5, merged: 4, warn: 3, ok: 2, note: 1, idle: 0 }
export const worstOf = (tiers: Tier[]) => tiers.reduce<Tier>((worst, tier) => (RANK[tier] > RANK[worst] ? tier : worst), 'idle')

const isCarry = (item: PairItem) => /carry/i.test(item.action)

function headOf(read: PrRead, item: PairItem): { tier: Tier; text: string } {
  if (read.head === '') return { tier: 'warn', text: 'unknown' }
  if (item.head === undefined) return { tier: 'warn', text: `${short7(read.head)}, reviewed head unknown` }
  if (read.head.startsWith(item.head)) return { tier: 'ok', text: `${short7(read.head)} as reviewed` }
  return { tier: 'bad', text: `moved to ${short7(read.head)}, reviewed ${short7(item.head)}` }
}

function exceptionsOf(read: PrRead, item: PairItem, repo: string): Row[] {
  const bad: Row[] = []
  const warn: Row[] = []
  const note: Row[] = []
  const isOpen = read.state === 'OPEN'
  if (read.state === 'MERGED') bad.push({ key: 'merged', tier: 'merged', text: 'merged' })
  if (read.state === 'CLOSED') bad.push({ key: 'closed', tier: 'bad', text: 'closed' })
  if (isOpen && read.merge === 'DIRTY') bad.push({ key: 'conflicts', tier: 'bad', text: 'conflicts with the base' })
  if (read.changesRequested === true) bad.push({ key: 'changes', tier: 'bad', text: 'changes requested' })
  if (read.breaking === true) bad.push({ key: 'breaking', tier: 'bad', text: 'breaking label' })
  if (read.code.length > 0) {
    const named = read.code.slice(0, 3).map(one => `${one.category} ${one.path}`).join(', ')
    const more = read.code.length > 3 ? ` +${read.code.length - 3}` : ''
    bad.push({ key: 'code', tier: 'bad', text: `code that runs: ${named}${more}` })
  }
  if (isCarry(item) && !read.canModify) bad.push({ key: 'carry', tier: 'bad', text: 'maintainer edits off, the carry cannot be pushed' })

  if (read.isDraft) warn.push({ key: 'draft', tier: 'warn', text: 'draft' })
  if (isOpen && (read.merge === 'UNKNOWN' || read.merge === '')) warn.push({ key: 'merge', tier: 'warn', text: 'merge state unknown' })
  for (const isBot of [false, true]) {
    const kind = read.threads.filter(thread => thread.isBot === isBot)
    if (kind.length === 0) continue
    const where = kind.slice(0, 3).map(thread => `${thread.path.slice(thread.path.lastIndexOf('/') + 1)}:${thread.line ?? '?'}`)
    const more = kind.length > 3 ? ` +${kind.length - 3}` : ''
    const text = `${plural(kind.length, 'open thread')}, ${isBot ? 'bot' : 'person'}: ${where.join(', ')}${more}`
    warn.push({ key: isBot ? 'threads-bot' : 'threads-person', tier: 'warn', text, isWrapped: true })
  }
  const rivals = new Set<number>()
  for (const issue of read.linked) {
    if (!issue.isSameRepo) {
      note.push({ key: `other-${issue.number}`, tier: 'note', text: `closes ${issue.repo}#${issue.number}, another repository` })
      continue
    }
    const issueUrl = itemUrl(repo, 'issues', issue.number)
    if (issueUrl !== undefined && issue.isClosed) {
      warn.push({ key: `issue-${issue.number}`, tier: 'warn', text: 'linked issue already closed', open: { url: issueUrl, label: `#${issue.number}` } })
    } else if (issueUrl !== undefined) {
      note.push({ key: `issue-${issue.number}`, tier: 'note', text: 'linked issue, open', open: { url: issueUrl, label: `#${issue.number}` } })
    }
    for (const rival of issue.rivals) {
      const rivalUrl = itemUrl(repo, 'pull', rival)
      if (rivalUrl === undefined || rivals.has(rival)) continue
      rivals.add(rival)
      warn.push({ key: `pr-${rival}`, tier: 'warn', text: `rival open PR on #${issue.number}`, open: { url: rivalUrl, label: `#${rival}` } })
    }
    if (issue.others.length > 0) {
      note.push({ key: `others-${issue.number}`, tier: 'note', text: `#${issue.number} also referenced by ${issue.others.join(', ')}` })
    }
    if (issue.refsShort !== undefined) {
      const { read: got, total } = issue.refsShort
      warn.push({ key: `refs-${issue.number}`, tier: 'warn', text: `#${issue.number}: ${got} of ${total} references read, rival PRs unknown` })
    }
  }
  if (read.base !== 'main') warn.push({ key: 'base', tier: 'warn', text: `base ${read.base}, not main` })
  if (read.filesShort !== undefined && read.code.length === 0) {
    warn.push({ key: 'files', tier: 'warn', text: `${read.filesShort.read} of ${read.filesShort.total} files read, code that runs unknown` })
  }
  if (read.labelsShort !== undefined && read.breaking === undefined) {
    warn.push({ key: 'labels', tier: 'warn', text: `${read.labelsShort.read} of ${read.labelsShort.total} labels read, breaking unknown` })
  }
  if (read.threadsShort !== undefined) {
    warn.push({ key: 'threads', tier: 'warn', text: `${read.threadsShort.read} of ${read.threadsShort.total} threads read, open threads unknown` })
  }
  if (read.reviewsShort !== undefined) {
    warn.push({ key: 'reviews', tier: 'warn', text: `${read.reviewsShort.read} of ${read.reviewsShort.total} reviews read, changes requested unknown` })
  }
  if (read.linkedShort !== undefined) {
    warn.push({ key: 'linked', tier: 'warn', text: `${read.linkedShort.read} of ${read.linkedShort.total} linked issues read` })
  }
  if (read.settings) note.push({ key: 'settings', tier: 'note', text: 'touches pr_agent/settings' })
  return [...bad, ...warn, ...note]
}

// The norms that were read and hold; an unknown is never among them.
function clearOf(read: PrRead, item: PairItem): string[] {
  const clear: string[] = []
  if (read.state === 'OPEN' && read.merge !== 'UNKNOWN' && read.merge !== '' && read.merge !== 'DIRTY') clear.push('no conflicts')
  if (!read.isDraft) clear.push('not draft')
  if (read.changesRequested === false) clear.push('no changes requested')
  if (read.threads.length === 0 && read.threadsShort === undefined) clear.push('no open threads')
  if (read.breaking === false) clear.push('not breaking')
  if (read.code.length === 0 && read.filesShort === undefined) clear.push('no code that runs')
  const same = read.linked.filter(issue => issue.isSameRepo)
  if (same.length > 0 && read.linkedShort === undefined && same.every(issue => issue.rivals.length === 0 && issue.refsShort === undefined)) {
    clear.push('no rival PR')
  }
  if (read.base === 'main') clear.push('base main')
  if (isCarry(item) && read.canModify) clear.push('maintainer edits on')
  return clear
}

function unreadFacts(item: PairItem, failed: Phrase | undefined): Facts {
  const isIssue = item.kind === 'issue'
  const reviewed = item.head === undefined ? '' : `, reviewed ${short7(item.head)}`
  const head: Row = failed === undefined
    ? { key: 'head', tier: 'idle', text: isIssue ? 'state not read yet' : 'head not read yet' }
    : { key: 'head', tier: 'warn', text: isIssue ? 'state unknown' : `head unknown${reviewed}` }
  const ci: Row = failed === undefined
    ? { key: 'ci', tier: 'idle', text: isIssue ? 'labels not read yet' : 'CI not read yet' }
    : { key: 'ci', tier: 'warn', text: isIssue ? `labels unknown: ${failed}` : `CI unknown: ${failed}` }
  return {
    title: failed === undefined ? 'reading GitHub…' : 'title unknown',
    byline: failed === undefined ? '…' : 'author unknown',
    head,
    ci,
    rows: [],
    isStale: false,
    worst: worstOf([head.tier, ci.tier]),
  }
}

// Everything the card draws for one item, compared with what the item says Claude reviewed.
export function factsOf(card: Card | undefined, item: PairItem, repo: string, now: number): Facts {
  const read = card?.read
  const failed = card?.failed
  if (read === undefined) return unreadFacts(item, failed)
  const age = now - read.at
  const qualifier = failed !== undefined ? `as of ${clockOf(read.at)}, refresh failed` : age >= STALE_MS ? `${Math.floor(age / 60_000)} min old` : undefined
  const isStale = qualifier !== undefined
  // A stale fixed row loses its tick: it says how old it is beside an amber glyph.
  const fixed = (row: Row, word: string, words: string, gap = ' '): Row =>
    isStale
      ? { ...row, tier: row.tier === 'ok' || row.tier === 'note' ? 'warn' : row.tier, text: `${word} ${qualifier}: ${words}` }
      : { ...row, text: `${word}${gap}${words}` }
  if (read.kind === 'issue') {
    const state: Row = read.isOpen ? { key: 'head', tier: 'note', text: '' } : { key: 'head', tier: 'bad', text: '' }
    const labelTier = read.labelsShort === undefined ? 'note' : 'warn'
    const listed = read.labels.length > 0 ? read.labels.join(', ') : 'none'
    const counted = read.labelsShort === undefined ? listed : `${read.labelsShort.read} of ${read.labelsShort.total} read, ${listed}`
    const head = fixed(state, 'issue', read.isOpen ? 'open' : 'closed')
    const ci = fixed({ key: 'ci', tier: labelTier, text: '' }, 'labels', counted, ': ')
    return { title: read.title, byline: `issue by @${read.author}`, head, ci, rows: [], isStale, ...(qualifier === undefined ? {} : { age: qualifier }), worst: worstOf([head.tier, ci.tier]) }
  }
  const words = headOf(read, item)
  const head = fixed({ key: 'head', tier: words.tier, text: '' }, 'head', words.text)
  const ci = fixed({ key: 'ci', tier: read.ci.tier, text: '' }, 'CI', read.ci.text)
  if (read.ci.log !== undefined) ci.open = { url: read.ci.log, label: 'log', isTrailing: true }
  const rows = exceptionsOf(read, item, repo)
  const norms = clearOf(read, item)
  const parts = [
    `@${read.author}${read.isBot ? ' (bot)' : ''}`,
    read.association,
    Number.isFinite(read.createdAt) ? ageOf(now - read.createdAt) : '',
    `+${read.additions} -${read.deletions}`,
    plural(read.changedFiles, 'file'),
  ]
  const facts: Facts = {
    title: read.title,
    byline: parts.filter(part => part !== '').join(' · '),
    head,
    ci,
    rows,
    isStale,
    ...(qualifier === undefined ? {} : { age: qualifier }),
    worst: worstOf([head.tier, ci.tier, ...rows.map(row => row.tier)]),
  }
  if (norms.length > 0) facts.clear = { key: 'clear', tier: isStale ? 'note' : 'ok', text: `clear: ${norms.join(', ')}` }
  return facts
}

// One status line per item: the worst tier, the worst signals in a phrase or two, then the merge and draft slots, each
// with its own tier. The slots are absent for an issue or an item not read yet.
export type Phrased = { tier: Tier; text: string }
export type StatusLine = { tier: Tier; lead: Phrased[]; more: number; merge?: Phrased; draft?: Phrased }

const SLOTS = ['merged', 'closed', 'conflicts', 'merge', 'draft']
const CI_WORDS: Record<Ci['state'], string> = { failing: 'failing', held: 'held', unknown: 'unknown', running: 'running', 'not-run': 'not run', passed: 'passed' }

function rowPhraseOf(row: Row, read: PrRead): string {
  if (row.key === 'changes') return 'changes requested'
  if (row.key === 'breaking') return 'breaking label'
  if (row.key === 'code') return 'code that runs'
  if (row.key === 'carry') return 'maintainer edits off'
  if (row.key === 'base') return `base ${read.base}`
  if (row.key.startsWith('pr-')) return `rival ${row.open?.label ?? 'PR'}`
  if (row.key.startsWith('issue-')) return 'linked issue closed'
  return row.tier === 'warn' && /^(files|labels|threads|reviews|linked|refs-)/.test(row.key) ? 'short read' : row.text
}

export function statusLineOf(facts: Facts, read: PrRead | IssueRead | undefined, item: PairItem): StatusLine {
  if (read === undefined || read.kind === 'issue') return { tier: facts.worst, lead: [{ tier: facts.worst, text: [facts.head.text, facts.ci.text].join(' · ') }], more: 0 }
  const head = headOf(read, item).tier
  const signals: (Phrased & { order: number })[] = []
  if (head !== 'ok') signals.push({ tier: head, text: head === 'bad' ? 'head moved' : 'head unknown', order: 0 })
  if (read.ci.tier !== 'ok') signals.push({ tier: read.ci.tier, text: read.ci.failing === undefined ? `CI ${CI_WORDS[read.ci.state]}` : `CI ${read.ci.failing} failing`, order: 1 })
  const threads = read.threads.length
  if (threads > 0) signals.push({ tier: 'warn', text: plural(threads, 'open thread'), order: 2 })
  for (const row of facts.rows) {
    if (SLOTS.includes(row.key) || row.key.startsWith('threads-') || row.tier === 'note') continue
    signals.push({ tier: row.tier, text: rowPhraseOf(row, read), order: row.key === 'changes' ? 3 : 4 })
  }
  if (facts.age !== undefined) signals.push({ tier: 'warn', text: facts.age.startsWith('as of') ? facts.age : `read ${facts.age}`, order: 5 })
  // Worst first; within a tier: head, CI, threads, changes requested, the other rows, the read's age.
  signals.sort((a, b) => RANK[b.tier] - RANK[a.tier] || a.order - b.order)
  // Rows that read alike (two short reads, two closed linked issues) are one phrase.
  const phrases = signals.filter((one, i) => signals.findIndex(other => other.text === one.text) === i)
  const merge: Phrased =
    read.state === 'MERGED' ? { tier: 'merged', text: 'merged' }
    : read.state === 'CLOSED' ? { tier: 'bad', text: 'closed' }
    : read.merge === 'DIRTY' ? { tier: 'bad', text: 'conflicts' }
    : read.merge === 'UNKNOWN' || read.merge === '' ? { tier: 'warn', text: 'merge unknown' }
    : { tier: 'ok', text: 'clean' }
  const draft: Phrased = read.isDraft ? { tier: 'warn', text: 'draft' } : { tier: 'ok', text: 'not draft' }
  const checks = read.ci.state === 'passed' ? read.ci.text.replace(/^passed · /, '') : undefined
  const lead: Phrased[] =
    phrases.length > 0
      ? phrases.slice(0, 2).map(({ tier, text }) => ({ tier, text }))
      : [{ tier: facts.worst, text: facts.worst === 'ok' ? ['all clear', ...(checks === undefined ? [] : [checks])].join(' · ') : (checks ?? 'CI passed') }]
  return { tier: facts.worst, lead, more: Math.max(0, phrases.length - 2), merge, draft }
}

function draftAlerts(n: number, what: string, text: string | undefined): string[] {
  if (text === undefined) return []
  const alerts: string[] = []
  const fence = openFence(text)
  if (fence !== undefined) alerts.push(`#${n} ${what}: fence on line ${fence} never closes.`)
  const runs = hiddenRuns(text)
  if (runs > 0) alerts.push(`#${n} ${what}: ${plural(runs, 'hidden character run')} shown as tokens.`)
  return alerts
}

// What the model reads about one item: numbers, hex SHAs, state words, category names and fixed phrases only.
export function alertsOf(card: Card | undefined, item: PairItem): string[] {
  const n = item.number
  const drafted = [
    ...draftAlerts(n, 'draft', item.draft),
    ...(item.inline ?? []).flatMap((comment, i) => draftAlerts(n, `inline comment ${i + 1}`, comment.body)),
  ]
  const read = card?.read
  if (card?.failed !== undefined) return [`#${n}: ${card.failed}.`, ...drafted]
  if (read === undefined) return drafted
  if (read.kind === 'issue') return [...(read.isOpen ? [] : [`#${n} is closed.`]), ...drafted]
  const alerts: string[] = []
  if (read.head === '') alerts.push(`#${n} head unknown.`)
  else if (item.head === undefined) alerts.push(`#${n} head ${short7(read.head)} not compared: no reviewed head given.`)
  else if (!read.head.startsWith(item.head)) alerts.push(`#${n} head moved to ${short7(read.head)} since the review at ${short7(item.head)}.`)
  if (read.state === 'MERGED') alerts.push(`#${n} is merged.`)
  if (read.state === 'CLOSED') alerts.push(`#${n} is closed.`)
  if (read.isDraft) alerts.push(`#${n} is a draft.`)
  if (read.state === 'OPEN' && read.merge === 'DIRTY') alerts.push(`#${n} has conflicts.`)
  if (read.state === 'OPEN' && (read.merge === 'UNKNOWN' || read.merge === '')) alerts.push(`#${n} merge state unknown.`)
  if (read.changesRequested === true) alerts.push(`#${n} has changes requested.`)
  const ci = read.ci
  const said = { failing: `CI failing (${plural(ci.failing ?? 0, 'check')})`, held: 'CI held for your approval', running: 'CI running', 'not-run': 'CI has not run', unknown: 'CI unknown', passed: '' }[ci.state]
  if (said !== '') alerts.push(`#${n} ${said}.`)
  if (read.threads.length > 0) {
    const kinds = [read.threads.some(t => !t.isBot) ? 'person' : '', read.threads.some(t => t.isBot) ? 'bot' : ''].filter(Boolean)
    alerts.push(`#${n} has ${plural(read.threads.length, 'unresolved review thread')} (${kinds.join(' and ')}).`)
  }
  if (read.breaking === true) alerts.push(`#${n} has a breaking label.`)
  if (read.code.length > 0) alerts.push(`#${n} touches code that runs (${[...new Set(read.code.map(one => one.category))].join(', ')}).`)
  if (isCarry(item) && !read.canModify) alerts.push(`#${n}: maintainer edits are off, so the carry cannot be pushed.`)
  for (const issue of read.linked.filter(one => one.isSameRepo)) {
    if (issue.isClosed) alerts.push(`#${n} closes #${issue.number}, which is already closed.`)
    for (const rival of issue.rivals) alerts.push(`#${n}: #${rival} is another open PR on #${issue.number}.`)
  }
  if (read.base !== 'main') alerts.push(`#${n} targets a base other than main.`)
  const shorts = [
    ['files', read.code.length === 0 ? read.filesShort : undefined, 'code that runs unknown'],
    ['labels', read.breaking === undefined ? read.labelsShort : undefined, 'breaking unknown'],
    ['threads', read.threadsShort, 'open threads unknown'],
    ['reviews', read.reviewsShort, 'changes requested unknown'],
    ['linked issues', read.linkedShort, 'more unknown'],
  ] as const
  for (const [what, short, fact] of shorts) {
    if (short !== undefined) alerts.push(`#${n}: ${short.read} of ${short.total} ${what} read, ${fact}.`)
  }
  return [...alerts, ...drafted]
}

// When the oldest card of the pair was read, for the r label.
export function asOfOf(cards: (Card | undefined)[]): number | undefined {
  const times = cards.flatMap(card => (card?.read === undefined ? [] : [card.read.at]))
  return times.length === 0 ? undefined : Math.min(...times)
}

// The viewer's login, read once per session; anything that does not look like a GitHub login is no answer.
export function loginOf(raw: unknown): string | undefined {
  const login = at(raw, 'data', 'viewer', 'login')
  return typeof login === 'string' && LOGIN.test(login) ? login : undefined
}

const nodesOf = (value: unknown): Node[] | undefined => {
  const nodes = at(value, 'nodes')
  return Array.isArray(nodes) ? nodes.filter(isNode) : undefined
}
const isTotal = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const timeOf = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : Number.NaN)
const isLogin = (value: unknown, login: string) => typeof value === 'string' && value.toLowerCase() === login.toLowerCase()
// A login as GitHub sent it, only when it looks like one.
const checkedLogin = (value: unknown) => (typeof value === 'string' && LOGIN.test(value) ? value : undefined)

const MAINTAINERS = ['OWNER', 'MEMBER', 'COLLABORATOR']
// A label however it is spelled: 'Do-Not_Merge (wip)' reads 'do not merge (wip)', 'Good_First-Issue' 'good first issue'.
const isLabel = (name: unknown, ...prefixes: string[]) =>
  typeof name === 'string' && prefixes.some(prefix => name.toLowerCase().replace(/[-_]/g, ' ').startsWith(prefix))
const isHold = (name: unknown) => isLabel(name, 'do not merge')
const isPerson = (node: Node) => at(node, 'author', '__typename') === 'User'
// A comment of the viewer's own that is pr-agent output (a review guide or code suggestions the maintainer ran locally
// and published with their token): a tool's words, never a maintainer's word. Narrow on purpose: only the viewer's own.
const OUTPUT = /^\s*## PR (?:Reviewer Guide|Code Suggestions)/
const hasOutputMarker = (body: unknown) => typeof body === 'string' && (body.includes('<!-- pr-agent:') || OUTPUT.test(body))
const isOutputOf = (node: Node, login: string) => isLogin(at(node, 'author', 'login'), login) && hasOutputMarker(node.body)

// A ready PR's group from the read alone, by the board's own definitions: mine (the viewer's), parked (a hold label or
// someone else assigned), nobody (no maintainer word), then owe when the author's last word, review or own commit came
// after the last maintainer word, else author. A maintainer is a person (never a bot, never the PR's author) who is the
// viewer or an owner, member or collaborator. Undefined when the read cannot tell: a field missing, a list cut short,
// or a window cut short whose oldest word read is later than the last maintainer word, so an older one could matter.
// I2 (Q8): a PR the viewer's last review APPROVED and that is still open is owe too: the merge is the viewer's move.
const isApprovedOf = (pr: Node) => at(pr, 'mine', 'nodes', '0', 'state') === 'APPROVED'
function groupOf(pr: Node, login: string): QueuePr['group'] {
  const author = at(pr, 'author', 'login')
  if (isLogin(author, login)) return 'mine'
  const [labels, assignees] = [listOf(pr.labels), listOf(pr.assignees)]
  if (labels?.nodes.some(label => isHold(label.name))) return 'parked'
  if (typeof author !== 'string') return undefined
  const isAuthor = (value: unknown) => isLogin(value, author)
  if (assignees?.nodes.some(one => !isLogin(one.login, login) && !isAuthor(one.login))) return 'parked'
  const [mine, reviews, comments, commits] = [nodesOf(pr.mine), listOf(pr.reviews), listOf(pr.comments), nodesOf(pr.commits)]
  if (!labels || !assignees || labels.short || assignees.short || !mine || !reviews || !comments || !commits) return undefined
  const isMaintainer = (node: Node) => {
    const who = at(node, 'author', 'login')
    return at(node, 'author', '__typename') === 'User' && !isAuthor(who) && (isLogin(who, login) || MAINTAINERS.includes(String(node.authorAssociation)))
  }
  // A review still pending has no time: it is no word yet.
  const said = (list: List, field: string) => list.nodes.map(node => ({ node, time: timeOf(node[field]) })).filter(one => Number.isFinite(one.time))
  const [reviewed, commented] = [said(reviews, 'submittedAt'), said(comments, 'createdAt').filter(one => !isOutputOf(one.node, login))]
  const words = [...reviewed, ...commented]
  const last = Math.max(...words.filter(one => isMaintainer(one.node)).map(one => one.time))
  const cut = [...(reviews.short === undefined ? [] : [reviewed]), ...(comments.short === undefined ? [] : [commented])]
  if (cut.some(window => !(Math.min(...window.map(one => one.time)) <= last))) return undefined
  if (last === -Infinity) return 'nobody'
  const head = at(commits[0], 'commit')
  const isPushed =
    isAuthor(at(head, 'author', 'user', 'login')) && timeOf(at(head, 'committedDate')) > last && at(mine[0], 'commit', 'oid') !== pr.headRefOid
  return isPushed || isApprovedOf(pr) || words.some(one => isAuthor(at(one.node, 'author', 'login')) && one.time > last) ? 'owe' : 'author'
}

// The latest word of a person on an item: its opening, then each comment or review read. The lists ask for the last
// ones, so the latest is always among them; undefined when a list is missing.
function heardOf(item: Node, login: string, ...lists: [unknown, string][]): number | undefined {
  const times = [isPerson(item) ? timeOf(item.createdAt) : Number.NaN]
  for (const [value, field] of lists) {
    const list = listOf(value)
    if (list === undefined) return undefined
    times.push(...list.nodes.filter(node => isPerson(node) && !isOutputOf(node, login)).map(node => timeOf(node[field])))
  }
  const latest = Math.max(...times.filter(Number.isFinite))
  return latest === -Infinity ? undefined : latest
}

// An issue's maintainer: a person (never a bot) who is the viewer or an owner, member or collaborator.
const isIssueMaintainer = (node: Node, login: string) =>
  isPerson(node) && (isLogin(at(node, 'author', 'login'), login) || MAINTAINERS.includes(String(node.authorAssociation)))

// The latest word on an issue of a person who is not a maintainer, its opening included: the only kind that can make
// it owed, so the only kind that ends a board call. Undefined when the comments are missing or none was read.
function askedOf(issue: Node, login: string): number | undefined {
  const comments = listOf(issue.comments)
  if (comments === undefined) return undefined
  const asked = [issue, ...comments.nodes].filter(node => isPerson(node) && !isIssueMaintainer(node, login))
  const latest = Math.max(...asked.map(node => timeOf(node.createdAt)).filter(Number.isFinite))
  return latest === -Infinity ? undefined : latest
}

// Each issue of a REFS read by number: whether an open pull request of this repo cross-references it, and whether its
// last 25 cross-references were all it has. Undefined for any other shape.
type Refs = Map<number, { hasOpen: boolean; isShort: boolean }>
function refsOf(raw: unknown, repo: string): Refs | undefined {
  const nodes = nodesOf(at(raw, 'data', 'repository', 'issues'))
  if (nodes === undefined) return undefined
  const refs: Refs = new Map()
  for (const node of nodes) {
    const timeline = listOf(node.timelineItems)
    if (!isCount(node.number) || timeline === undefined) return undefined
    const isOpenHere = (event: Node) =>
      at(event, 'source', 'state') === 'OPEN' && isLogin(at(event, 'source', 'repository', 'nameWithOwner'), repo)
    refs.set(node.number, { hasOpen: timeline.nodes.some(isOpenHere), isShort: timeline.short !== undefined })
  }
  return refs
}

// An open issue's section from the read alone, by the board's definitions: pr (an open pull request closes it, or one
// of this repo cross-references it), nobody (no maintainer word, its opening included), owe (a person who is not a
// maintainer wrote after the last maintainer word), blocked (a blocked label), community (a maintainer spoke last under
// a help wanted or good first issue label), else reporter. Undefined when the read cannot tell: a field missing, a list
// cut short that could hold the answer, or a window of comments cut short whose oldest read is later than the last
// maintainer word.
function sectionOf(issue: Node, login: string, hasOpenRef: boolean): QueueIssue['section'] {
  const [prs, comments, labels] = [listOf(issue.closedByPullRequestsReferences), listOf(issue.comments), listOf(issue.labels)]
  if (hasOpenRef || prs?.nodes.some(pr => pr.state === 'OPEN')) return 'pr'
  if (!prs || prs.short || !comments || !labels) return undefined
  const isMaintainer = (node: Node) => isIssueMaintainer(node, login)
  const said = comments.nodes.map(node => ({ node, time: timeOf(node.createdAt) })).filter(one => Number.isFinite(one.time))
  const words = [{ node: issue, time: timeOf(issue.createdAt) }, ...said].filter(one => Number.isFinite(one.time))
  const last = Math.max(...words.filter(one => isMaintainer(one.node)).map(one => one.time))
  if (comments.short && !(Math.min(...said.map(one => one.time)) <= last)) return undefined
  if (last === -Infinity) return 'nobody'
  if (words.some(one => isPerson(one.node) && !isMaintainer(one.node) && one.time > last)) return 'owe'
  if (labels.nodes.some(label => isLabel(label.name, 'blocked'))) return 'blocked'
  if (labels.short) return undefined
  return labels.nodes.some(label => isLabel(label.name, 'help wanted', 'good first issue')) ? 'community' : 'reporter'
}

type Got = { json: unknown } | { failed: Phrase }

// The open issues of an ISSUES read and their cross-references from REFS. A failed or misshapen ISSUES read leaves every
// issue unknown, and the pull requests stand; without REFS for an issue (failed, misshapen or cut short) a section
// other than pr is the read's best answer, counted as undecided.
function issuesReadOf(issues: Got, refs: Got, login: string, repo: string): Pick<QueueRead, 'issues' | 'issueTotal' | 'issuesFailed' | 'refsFailed'> {
  const open = 'json' in issues ? at(issues.json, 'data', 'repository', 'issues') : undefined
  const [nodes, total] = [nodesOf(open), at(open, 'totalCount')]
  if ('failed' in issues) return { issues: [], issuesFailed: issues.failed }
  if (!nodes || !isTotal(total) || nodes.some(issue => !isCount(issue.number))) return { issues: [], issuesFailed: 'GitHub error' }
  const byNumber = 'json' in refs ? refsOf(refs.json, repo) : undefined
  const read: QueueIssue[] = nodes.map(issue => {
    const number = issue.number as number
    const ref = byNumber?.get(number)
    const [section, askedAt] = [sectionOf(issue, login, ref?.hasOpen === true), askedOf(issue, login)]
    const one: QueueIssue = { number, title: line(issue.title, 200), createdAt: timeOf(issue.createdAt) }
    if (section !== undefined) one.section = section
    if (section !== undefined && section !== 'pr' && (ref === undefined || ref.isShort)) one.isUnsure = true
    if (askedAt !== undefined) one.askedAt = askedAt
    return one
  })
  const failed = 'failed' in refs ? refs.failed : byNumber === undefined ? 'GitHub error' : undefined
  return failed === undefined ? { issues: read, issueTotal: total } : { issues: read, issueTotal: total, refsFailed: failed }
}

// One queue read, reduced to numbers, cleaned titles, times, groups and sections: a misshapen pull request answer is a
// failed read, the issues as issuesReadOf says.
export function queueReadOf(raw: unknown, login: string, repo: string, issues: Got, refs: Got): QueueRead | Phrase {
  const pulls = at(raw, 'data', 'repository', 'pullRequests')
  const prNodes = nodesOf(pulls)
  const [prTotal, hasNext] = [at(pulls, 'totalCount'), at(pulls, 'pageInfo', 'hasNextPage')]
  if (!prNodes || !isTotal(prTotal) || typeof hasNext !== 'boolean') return 'GitHub error'
  const prs: QueuePr[] = []
  for (const pr of prNodes) {
    if (!isCount(pr.number)) return 'GitHub error'
    const isDraft = pr.isDraft === true
    const group = isDraft ? undefined : groupOf(pr, login)
    const heardAt = heardOf(pr, login, [pr.reviews, 'submittedAt'], [pr.comments, 'createdAt'])
    const read: QueuePr = { number: pr.number, title: line(pr.title, 200), createdAt: timeOf(pr.createdAt), isDraft }
    const author = checkedLogin(at(pr, 'author', 'login'))
    if (author !== undefined) read.author = author
    if (group !== undefined) read.group = group
    // I2 (Q8, S3): the approval reads as one only while it stands: on the head (the author has not pushed past it)
    // and the last word of a person on the PR (nobody spoke after it, the viewer included). The PR is owed either
    // way, by groupOf; a stale approval reads back, the re-read.
    const approvedAt = timeOf(at(pr, 'mine', 'nodes', '0', 'submittedAt'))
    const isStanding = at(pr, 'mine', 'nodes', '0', 'commit', 'oid') === pr.headRefOid && Number.isFinite(approvedAt) && !(heardAt !== undefined && heardAt > approvedAt)
    if (isApprovedOf(pr) && isStanding) read.isApproved = true
    const head = String(pr.headRefOid ?? '')
    if (HEAD.test(head)) read.head = head
    if (heardAt !== undefined) read.heardAt = heardAt
    prs.push(read)
  }
  return { prs, prTotal, prsShort: hasNext || prs.length < prTotal, ...issuesReadOf(issues, refs, login, repo) }
}

const BUCKETS = ['owe', 'author', 'nobody', 'mine', 'parked', 'draft']
const SECTIONS = ['owe', 'decision', 'close', 'pr', 'community', 'reporter', 'blocked']
// The board's calls GitHub cannot express: they stand until a later word of a person (for an issue, one who is not a
// maintainer) on the item, from when the mod first saw the call.
const STICKY = ['decision', 'close', 'blocked']
const NUMBER_KEY = /^[1-9][0-9]{0,9}$/
const DAY_MS = 86_400_000

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Bucket or section names by number; _doc and every note are left unread. 'other' marks a name the board
// does not know, which update_board.py counts under no tile.
function namesOf(text: string, field: string, known: string[]): Record<string, string> | undefined {
  const json = jsonOf(text)
  if (!isNode(json)) return undefined
  const names: Record<string, string> = {}
  for (const [key, value] of Object.entries(json)) {
    if (!NUMBER_KEY.test(key)) continue
    const name = at(value, field)
    names[key] = typeof name === 'string' && known.includes(name) ? name : 'other'
  }
  return names
}

// update_board.py rewrites both files whenever any item opened or closed, so a file's time is not its calls' time. Each
// standing call keeps the time it was first seen at (`seen`, the last read's since), and a call seen for the first time
// or changed takes its file's time.
export function boardOf(buckets: string, chase: string, bucketsAt: number, sectionsAt: number, seen?: unknown): Board | undefined {
  const [byBucket, bySection] = [namesOf(buckets, 'bucket', BUCKETS), namesOf(chase, 'section', SECTIONS)]
  if (byBucket === undefined || bySection === undefined || !Number.isFinite(bucketsAt) || !Number.isFinite(sectionsAt)) return undefined
  const since: Record<string, number> = {}
  const keep = (key: string, at: number) => {
    const before = isNode(seen) ? seen[key] : undefined
    since[key] = typeof before === 'number' && Number.isFinite(before) ? Math.min(before, at) : at
  }
  for (const [number, name] of Object.entries(bySection)) if (STICKY.includes(name)) keep(`${number}:${name}`, sectionsAt)
  for (const [number, name] of Object.entries(byBucket)) if (name === 'parked') keep(`${number}:parked`, bucketsAt)
  return { buckets: byBucket, sections: bySection, bucketsAt, sectionsAt, since }
}

// GitHub's own page cursor, which travels back as one -f string to the constant document.
const CURSOR = /^[A-Za-z0-9+/=_-]{1,200}$/
// Past this many pages of 100 the trend is unknown: pr-agent closes about 1,100 in 16 weeks (13 pages, 2026-10-11).
export const TREND_PAGES = 20

export function trendArgs(repo: string, after?: string): string[] | undefined {
  const args = repoArgs(TREND, repo)
  if (args === undefined || (after !== undefined && !CURSOR.test(after))) return undefined
  return after === undefined ? args : [...args, '-f', `after=${after}`]
}

// The 16 Monday-to-Sunday UTC weeks to the week holding `now`, as day numbers; day 0, 1 January 1970, was a Thursday.
export function windowOf(now: number): { first: number; last: number } {
  const last = Math.floor(now / DAY_MS)
  return { first: last - ((last + 3) % 7) - 15 * 7, last }
}

export const dayOf = (now: number) => new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString().slice(0, 10)

// When a pull request was open: closedAt is Infinity while it is.
export type Span = { createdAt: number; closedAt: number }

// One page of closed and merged pull requests, as TREND sends them: every span, the oldest updatedAt on the page
// (Infinity when it is empty) and the cursor of the page after it, when GitHub has one. Any other shape, a cursor that
// does not look like one included, is a failed read.
export type Page = { spans: Span[]; oldest: number; next?: string }

export function pageOf(raw: unknown): Page | Phrase {
  const pulls = at(raw, 'data', 'repository', 'pullRequests')
  const nodes = nodesOf(pulls)
  const [hasNext, cursor] = [at(pulls, 'pageInfo', 'hasNextPage'), at(pulls, 'pageInfo', 'endCursor')]
  if (nodes === undefined || typeof hasNext !== 'boolean') return 'GitHub error'
  const spans: Span[] = []
  let oldest = Infinity
  for (const node of nodes) {
    const [createdAt, updatedAt, mergedAt] = [timeOf(node.createdAt), timeOf(node.updatedAt), timeOf(node.mergedAt)]
    // A merge closes: a merged PR GitHub sent without closedAt closed when it merged. Any other closedAt must be a time,
    // and a PR cannot close before it was created: either is a failed read, never a negative close time.
    const closedAt = node.closedAt === null || node.closedAt === undefined ? mergedAt : timeOf(node.closedAt)
    if (!Number.isFinite(createdAt) || !Number.isFinite(closedAt) || !Number.isFinite(updatedAt) || closedAt < createdAt) return 'GitHub error'
    spans.push({ createdAt, closedAt })
    oldest = Math.min(oldest, updatedAt)
  }
  const page: Page = { spans, oldest }
  if (!hasNext) return page
  return typeof cursor === 'string' && CURSOR.test(cursor) ? { ...page, next: cursor } : 'GitHub error'
}

// One page for the weekly trend: its spans, and the cursor of the next page while one may still hold a pull request
// closed in the 16-week window.
export function trendPageOf(raw: unknown, now: number): { spans: Span[]; next?: string } | Phrase {
  const page = pageOf(raw)
  if (typeof page === 'string') return page
  return page.next === undefined || page.oldest < windowOf(now).first * DAY_MS ? { spans: page.spans } : { spans: page.spans, next: page.next }
}

// The board's own count (recompute_series.py): a pull request, draft or not, is open at the end of a day (23:59:59 UTC)
// when it was created by then and not yet closed. Each week's value is the mean of its days, up to today.
export function weeksOf(spans: Span[], now: number): number[] {
  const { first, last } = windowOf(now)
  const weeks: number[] = []
  for (let start = first; start <= last; start += 7) {
    const counts: number[] = []
    for (let day = start; day < start + 7 && day <= last; day += 1) {
      const end = (day + 1) * DAY_MS - 1000
      counts.push(spans.filter(span => span.createdAt <= end && span.closedAt > end).length)
    }
    weeks.push(counts.reduce((sum, count) => sum + count, 0) / counts.length)
  }
  return weeks
}

const BARS = '▁▂▃▄▅▆▇█'

// Each week at the nearest of eight heights over a zero baseline, the tallest at the peak; all lowest when none was open.
export function sparkOf(weeks: number[]): { glyphs: string; peak: number; now: number } {
  const peak = Math.max(...weeks)
  const height = (mean: number) => (peak > 0 ? Math.min(8, Math.max(1, Math.round((mean / peak) * 8))) : 1)
  const glyphs = weeks.map(mean => BARS[height(mean) - 1]).join('')
  return { glyphs, peak: Math.round(peak), now: Math.round(weeks[weeks.length - 1] ?? 0) }
}

// The last 4 weeks' mean against the 4 before: a change under one pull request is flat.
export function trendWordOf(weeks: number[]): 'rising' | 'falling' | 'flat' {
  const mean = (some: number[]) => some.reduce((sum, value) => sum + value, 0) / Math.max(1, some.length)
  const change = mean(weeks.slice(-4)) - mean(weeks.slice(-8, -4))
  return Math.abs(change) < 1 ? 'flat' : change > 0 ? 'rising' : 'falling'
}

export type QueueRow = { key: string; number: number; kind: 'pull' | 'issues'; title: string; createdAt: number; tier: Tier; note?: string }

// A heading and the rows under it; count is undefined when the read could not see them all.
export type Heading = { key: string; title: string; count: number | undefined; rows: QueueRow[] }

// Undefined is unknown. undecided: open items the read could not place, filed by the board's call or as new. calls: the
// board's calls in effect, which no later word of a person has overridden.
export type Counts = {
  owe?: number
  new?: number
  author?: number
  undecided?: number
  prs?: number
  draft?: number
  parked?: number
  yours?: number
  issues?: number
  calls?: number
}

export type QueueModel = { counts: Counts; prs: Heading[]; issues: Heading[] }

const prRow = (pr: QueuePr, tier: Tier, note?: string): QueueRow => ({
  key: `pull-${pr.number}`,
  number: pr.number,
  kind: 'pull',
  title: pr.title,
  createdAt: pr.createdAt,
  tier,
  ...(note === undefined ? {} : { note }),
})
const issueRow = (issue: QueueIssue, tier: Tier, note?: string): QueueRow => ({
  key: `issues-${issue.number}`,
  number: issue.number,
  kind: 'issues',
  title: issue.title,
  createdAt: issue.createdAt,
  tier,
  ...(note === undefined ? {} : { note }),
})

const ISSUE_SECTIONS: [string, string[], Tier][] = [
  ['You owe', ['owe', 'close'], 'warn'],
  ['Nobody has looked', ['nobody'], 'warn'],
  ['Maintainer call', ['decision'], 'note'],
  ['Has a PR', ['pr'], 'note'],
  ['Open for the community', ['community'], 'note'],
  ['With the reporter', ['reporter'], 'note'],
  ['Blocked on purpose', ['blocked'], 'note'],
]

// What both views and the status line show, from one read and the board's calls: every count is the length of the
// rows under its heading, or unknown when the read was short of GitHub's total.
export function queueModelOf(queue: Queue): QueueModel | undefined {
  const read = queue.read
  if (read === undefined) return undefined
  const board = typeof queue.board === 'object' ? queue.board : undefined
  const isIssuesShort = read.issueTotal === undefined || read.issues.length < read.issueTotal
  const ofPrs = (count: number) => (read.prsShort ? undefined : count)
  const ofIssues = (count: number) => (isIssuesShort ? undefined : count)
  const ready = read.prs.filter(pr => !pr.isDraft)
  const drafts = read.prs.length - ready.length
  // A board call stands until a later word than when it was first seen; a read that cannot tell keeps it.
  const bucketOf = (pr: QueuePr) => board?.buckets[String(pr.number)]
  const calledOf = (issue: QueueIssue) => board?.sections[String(issue.number)]
  const isParked = (pr: QueuePr) =>
    board !== undefined && bucketOf(pr) === 'parked' && !((pr.heardAt ?? -Infinity) > (board.since[`${pr.number}:parked`] ?? board.bucketsAt))
  const isCalled = (issue: QueueIssue) => {
    const called = calledOf(issue)
    if (board === undefined || called === undefined || !STICKY.includes(called)) return false
    return !((issue.askedAt ?? -Infinity) > (board.since[`${issue.number}:${called}`] ?? board.sectionsAt))
  }
  // One group per PR, so each is counted once: GitHub's isDraft and the viewer's own come first, the board's parked
  // while it stands, then the read's group. A PR the read could not group takes the board's bucket (new when it has
  // none, or still draft), or is new with no board.
  const isUndecided = (pr: QueuePr) => !pr.isDraft && pr.group === undefined && !isParked(pr)
  const placeOf = (pr: QueuePr) => {
    const bucket = bucketOf(pr)
    if (pr.isDraft) return 'draft'
    if (pr.group === 'mine') return 'mine'
    if (isParked(pr)) return 'parked'
    if (pr.group !== undefined) return pr.group
    return bucket === undefined || bucket === 'draft' || bucket === 'other' ? 'nobody' : bucket
  }
  // The same for an issue: the board's standing call, the read's section, else the board's section, the read's best
  // answer or new.
  const isUnplaced = (issue: QueueIssue) => !isCalled(issue) && (issue.section === undefined || issue.isUnsure === true)
  const issuePlaceOf = (issue: QueueIssue) => {
    const section = calledOf(issue)
    if (isCalled(issue)) return section ?? 'nobody'
    if (issue.section !== undefined && issue.isUnsure !== true) return issue.section
    return section !== undefined && section !== 'other' ? section : (issue.section ?? 'nobody')
  }
  const inGroup = (group: string) => read.prs.filter(pr => placeOf(pr) === group)
  const inSections = (names: string[]) => read.issues.filter(issue => names.includes(issuePlaceOf(issue)))
  // I2 (Q8): a standing approval's note says so (isApproved, S3); the author coming back after an approval, by a push
  // or a word, still reads back, the re-read.
  const owed = [
    ...inGroup('owe').map(pr => prRow(pr, 'warn', pr.group === 'owe' ? (pr.isApproved === true ? 'approved' : 'back') : undefined)),
    ...inSections(['owe', 'close']).map(issue => issueRow(issue, 'warn', 'issue')),
  ]
  const fresh = inGroup('nobody').map(pr => prRow(pr, 'warn'))
  const author = inGroup('author').map(pr => prRow(pr, 'note'))
  const oweCount = read.prsShort || isIssuesShort ? undefined : owed.length
  const counts: Counts = {
    owe: oweCount,
    new: ofPrs(fresh.length),
    author: ofPrs(author.length),
    undecided: ofPrs(read.prs.filter(isUndecided).length + read.issues.filter(isUnplaced).length),
    prs: ofPrs(ready.length),
    draft: ofPrs(drafts),
    parked: ofPrs(inGroup('parked').length),
    yours: ofPrs(inGroup('mine').length),
    issues: read.issueTotal,
    calls: read.prs.filter(pr => placeOf(pr) === 'parked' && isParked(pr)).length + read.issues.filter(isCalled).length,
  }
  // I2: the parked PRs are a heading of their own, drawn collapsed; drafts stay a count.
  const parked = inGroup('parked').map(pr => prRow(pr, 'note'))
  const prs: Heading[] = [
    { key: 'owe', title: 'You owe the next move', count: oweCount, rows: owed },
    { key: 'nobody', title: 'Nobody has looked', count: ofPrs(fresh.length), rows: fresh },
    { key: 'author', title: 'Waiting on the author', count: ofPrs(author.length), rows: author },
    { key: 'parked', title: 'Parked', count: ofPrs(parked.length), rows: parked },
  ]
  const issues = ISSUE_SECTIONS.map(([title, names, tier]): Heading => {
    const rows = inSections(names).map(issue => issueRow(issue, tier))
    return { key: names[0] ?? title, title, count: ofIssues(rows.length), rows }
  })
  return { counts, prs, issues }
}

// 'owe 3' or 'owe unknown'; trailing, '12 issues' or 'issues unknown'.
export const told = (count: number | undefined, word: string, isTrailing = false) =>
  count === undefined ? `${word} unknown` : isTrailing ? `${count} ${word}` : `${word} ${count}`

// I1 colour roles: a pill is uppercase fixed words on a solid key, one role each (the plan's section 2 table). act:
// broken or breached, red; move: the viewer's move, teal; ready: all green or nothing owed, green; done: merged, or posted for
// one refresh; parked: not read, grey. Amber has no pill: no warning key reaches 5:1 as a pill in every theme.
export type PillRole = 'act' | 'move' | 'ready' | 'done' | 'parked'
export type Pill = { role: PillRole; words: string }
const PILL_RANK: Record<PillRole, number> = { act: 4, move: 3, parked: 2, done: 1, ready: 0 }
// Worst first, ties in the order given.
export const worstFirst = (pills: Pill[]) => [...pills].sort((a, b) => PILL_RANK[b.role] - PILL_RANK[a.role])
const NOT_READ: Pill = { role: 'parked', words: 'NOT READ' }

// The breach thresholds, in one place: a non-draft open PR nobody is parking is stale from 28 days, and an item nobody
// has looked at breaches from 24 hours.
export const STALE_PR_MS = 28 * DAY_MS
export const NOBODY_MS = DAY_MS

// The act-now breaches of a queue model: the oldest PR over the stale threshold under the owe, nobody and author
// headings (parked and drafts are waiting on purpose), the oldest PR or issue nobody has looked at past a day, how
// many items breach either (count) and how many PRs are stale (staleCount: the status line's blocked, since the
// items past a day are its new). An unknown age breaches nothing.
export function breachesOf(model: QueueModel, now: number): { stale?: QueueRow; nobody?: QueueRow; count: number; staleCount: number } {
  const oldest = (rows: QueueRow[], limit: number) =>
    rows.filter(row => Number.isFinite(row.createdAt) && now - row.createdAt > limit).sort((a, b) => a.createdAt - b.createdAt)
  const prs = model.prs.filter(heading => heading.key !== 'parked').flatMap(heading => heading.rows).filter(row => row.kind === 'pull')
  const unseen = [...(model.prs.find(heading => heading.key === 'nobody')?.rows ?? []), ...(model.issues.find(heading => heading.key === 'nobody')?.rows ?? [])]
  const [stale, nobody] = [oldest(prs, STALE_PR_MS), oldest(unseen, NOBODY_MS)]
  const breaches = { count: new Set([...stale, ...nobody].map(row => row.key)).size, staleCount: stale.length }
  return { ...breaches, ...(stale[0] === undefined ? {} : { stale: stale[0] }), ...(nobody[0] === undefined ? {} : { nobody: nobody[0] }) }
}

// The queue's pills and the first owed item: NOT READ after a failed read or five minutes on; STALE and NOBODY for
// the breaches, YOU OWE for a known count over zero. Nothing before the first read, and never CLEAR here: only the
// view, which also sees the cards, can say nothing is wrong.
export function queuePillsOf(queue: Queue | null, now: number): { pills: Pill[]; next?: number; isClear: boolean } {
  if (queue === null) return { pills: [], isClear: false }
  const model = queueModelOf(queue)
  const isUnread = queue.failed !== undefined || (queue.read !== undefined && now - queue.at >= STALE_MS)
  const pills: Pill[] = isUnread ? [NOT_READ] : []
  if (model === undefined) return { pills, isClear: false }
  const { stale, nobody, count } = breachesOf(model, now)
  if (stale !== undefined) pills.push({ role: 'act', words: `STALE ${ageOf(now - stale.createdAt)}` })
  // One PR both stale and unseen takes STALE alone, the worse reading: two act pills on one item spend the budget twice.
  if (nobody !== undefined && nobody.key !== stale?.key) pills.push({ role: 'act', words: `NOBODY ${ageOf(now - nobody.createdAt)}` })
  const owe = model.counts.owe
  if (owe !== undefined && owe > 0) pills.push({ role: 'move', words: `YOU OWE ${owe}` })
  const next = model.prs.find(heading => heading.key === 'owe')?.rows[0]?.number
  return { pills, isClear: !isUnread && owe === 0 && count === 0, ...(next === undefined ? {} : { next }) }
}

// One card's pill, worst first: NOT READ when its read failed or is stale (never READY beside stale facts), MERGED, then
// POSTED for the one read that followed a write of Claude's, HEAD MOVED, CI FAILED, CONFLICT, and READY when every
// fact read is green. A first read still running has no pill, and a closed item nothing to act on.
export function cardPillOf(card: Card | undefined, facts: Facts): Pill | undefined {
  const read = card?.read
  if (read === undefined) return card?.failed === undefined ? undefined : NOT_READ
  if (facts.isStale) return NOT_READ
  if (read.kind === 'pr' && read.state === 'MERGED') return { role: 'done', words: 'MERGED' }
  if (card?.posted === true) return { role: 'done', words: 'POSTED' }
  // An issue has no gate to pass and its facts are notes, so it is never READY: a 'blocked' label would read all green.
  if (read.kind === 'issue') return undefined
  if (read.kind === 'pr') {
    if (facts.head.tier === 'bad') return { role: 'act', words: 'HEAD MOVED' }
    if (read.ci.state === 'failing') return { role: 'act', words: 'CI FAILED' }
    if (read.state === 'OPEN' && read.merge === 'DIRTY') return { role: 'act', words: 'CONFLICT' }
  }
  return facts.worst === 'ok' || facts.worst === 'note' ? { role: 'ready', words: 'READY' } : undefined
}

// The detail view's own card: NOT READ, MERGED or CI FAILED, else nothing.
export function detailPillOf(card: DetailCard | null, now: number): Pill | undefined {
  const read = card?.read
  if (card?.failed !== undefined || (read !== undefined && now - read.at >= STALE_MS)) return NOT_READ
  if (read?.state === 'merged') return { role: 'done', words: 'MERGED' }
  return read?.ci === 'failing' ? { role: 'act', words: 'CI FAILED' } : undefined
}

// The attention line of a view: the queue's pills and the cards' given, worst first, and CLEAR when the queue says
// nothing is owed or breached and no card drawn or counted (isBlocked) is broken or unread.
export function attentionOf(queue: Queue | null, now: number, cards: Pill[], isBlocked = false): { pills: Pill[]; next?: number } {
  const { pills, next, isClear } = queuePillsOf(queue, now)
  const all = [...pills, ...cards]
  if (isClear && !isBlocked && !all.some(one => one.role === 'act' || one.role === 'parked')) all.push({ role: 'ready', words: 'CLEAR' })
  return { pills: worstFirst(all), ...(next === undefined ? {} : { next }) }
}

// The pair's attention: the queue's pills alone, since the shown item's own leads its decision row and the line must
// be the same on every tab. Never the queue's NOT READ: the pair's poll reads the cards, not the queue, so that pill
// would sit over fresh cards until a queue visit or r; CLEAR stays withheld meanwhile (isClear is false while the
// queue is unread). At most `room` pills beside the decision pill, the move pill kept over a second act pill, because
// 'next' names the owed item and YOU OWE is the pill that says why.
export function pairAttentionOf(queue: Queue | null, now: number, isBlocked: boolean, room: number): { pills: Pill[]; next?: number } {
  const { pills, next } = attentionOf(queue, now, [], isBlocked)
  const shown = pills.filter(one => one.role !== 'parked')
  const move = shown.find(one => one.role === 'move')
  const kept = shown.length <= room || move === undefined ? shown.slice(0, room) : [...shown.filter(one => one !== move).slice(0, room - 1), move]
  return { pills: worstFirst(kept), ...(next === undefined ? {} : { next }) }
}

// The status line, worst first: the repo's short name (store-held and REPO-tested, never GitHub's text; the engine
// prefixes the plugin's own name, so the words never repeat it), then fixed words and counts only, each zero part
// dropped, or 'counts unknown' after a failed read. blocked: the stale PRs; your move: owed; new: nobody has looked,
// which the NOBODY pill's item is one of, so it is never counted as blocked too.
export function statusOf(queue: Queue, now: number): string {
  const name = queue.repo.slice(queue.repo.indexOf('/') + 1)
  const model = queueModelOf(queue)
  if (model === undefined) return `${name} · counts unknown`
  const { counts } = model
  // A read that failed after a good one: the counts are that read's, and say when.
  const held = queue.failed === undefined ? '' : `as of ${clockOf(queue.at)}`
  // A read short of GitHub's open PRs leaves every PR count unknown: one phrase says so, and the line still fits.
  if (counts.prs === undefined) return [name, 'PR counts unknown', told(counts.issues, 'issues', true), held].filter(part => part !== '').join(' · ')
  const blocked = breachesOf(model, now).staleCount
  const owe = counts.owe === undefined ? '◆ your move unknown' : counts.owe > 0 ? `◆ ${counts.owe} your move` : ''
  const fresh = (counts.new ?? 0) > 0 ? `▲ ${counts.new} new` : ''
  return [name, blocked > 0 ? `✗ ${blocked} blocked` : '', owe, fresh, `${counts.prs} PRs`, told(counts.issues, 'issues', true), held].filter(part => part !== '').join(' · ')
}

// The read a later one is compared with: a merge state GitHub has not computed (UNKNOWN or none) or a CI state a
// partial read left unknown keeps the last one that said something, so a standing state never toasts twice.
export function basisOf(before: PrRead | IssueRead | undefined, after: PrRead | IssueRead): PrRead | IssueRead {
  if (before?.kind !== 'pr' || after.kind !== 'pr') return after
  const merge = after.merge === 'UNKNOWN' || after.merge === '' ? before.merge : after.merge
  return { ...after, merge, ci: after.ci.state === 'unknown' ? before.ci : after.ci }
}

// What changed between two good reads of one item, in fixed words: a toast says these and the number, nothing else.
export function changesOf(before: PrRead | IssueRead, after: PrRead | IssueRead): string[] {
  if (before.kind === 'issue' || after.kind === 'issue') {
    if (before.kind !== 'issue' || after.kind !== 'issue' || before.isOpen === after.isOpen) return []
    return [after.isOpen ? 'reopened' : 'closed']
  }
  const changes: string[] = []
  if (before.state !== after.state) {
    if (after.state === 'MERGED') changes.push('merged')
    else if (after.state === 'CLOSED') changes.push('closed')
    else if (after.state === 'OPEN') changes.push('reopened')
  }
  if (before.head !== '' && after.head !== '' && before.head !== after.head) changes.push('head moved')
  if (before.ci.state !== 'failing' && after.ci.state === 'failing') changes.push('CI failing')
  if (before.ci.state !== 'passed' && after.ci.state === 'passed') changes.push('CI passing')
  if (before.decision !== after.decision && after.decision === 'APPROVED') changes.push('approved')
  if (before.decision !== after.decision && after.decision === 'CHANGES_REQUESTED') changes.push('changes requested')
  const isDirty = (read: PrRead) => read.state === 'OPEN' && read.merge === 'DIRTY'
  if (!isDirty(before) && isDirty(after)) changes.push('has conflicts')
  return changes
}

// A write of Claude's that may change what the pane shows: the item it names, and the repo when the command names
// one (-R, GH_REPO, a URL or an api path). A gh command that names no repo acts on its working copy's, which the
// mod cannot see, so it names none.
export type Write = { repo?: string; number: number }

// The GitHub MCP server's write tools that act on one pull request or issue by number, and the field holding it.
const WRITE_FIELDS = {
  mcp__plugin_github_github__merge_pull_request: 'pullNumber',
  mcp__plugin_github_github__pull_request_review_write: 'pullNumber',
  mcp__plugin_github_github__update_pull_request: 'pullNumber',
  mcp__plugin_github_github__update_pull_request_branch: 'pullNumber',
  mcp__plugin_github_github__add_reply_to_pull_request_comment: 'pullNumber',
  mcp__plugin_github_github__add_issue_comment: 'issue_number',
  mcp__plugin_github_github__issue_write: 'issue_number',
} as const
export const WRITE_TOOLS = Object.keys(WRITE_FIELDS) as (keyof typeof WRITE_FIELDS)[]

export function mcpWriteOf(tool: string, input: Record<string, unknown>): Write | undefined {
  const field = (WRITE_FIELDS as Record<string, string>)[tool]
  const [owner, name, number] = [input.owner, input.repo, field === undefined ? undefined : input[field]]
  const repo = `${String(owner)}/${String(name)}`
  if (typeof owner !== 'string' || typeof name !== 'string' || !REPO.test(repo) || !isCount(number)) return undefined
  return { repo, number }
}

const PR_WRITES = ['merge', 'review', 'close', 'comment']
const ISSUE_WRITES = ['close', 'comment']
// gh pr and gh issue flags that take the next word as their value, so it is never read as the target.
const VALUE_FLAGS = ['-b', '--body', '-F', '--body-file', '-t', '--subject', '-c', '--comment', '-r', '--reason', '--match-head-commit', '-A', '--author-email', '--duplicate-of']
// gh api flags that take a value; the field flags also make the default method POST.
const FIELD_FLAGS = ['-f', '--raw-field', '-F', '--field', '--input']
const API_VALUE_FLAGS = ['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']
const ENV = /^[A-Za-z_][A-Za-z0-9_]*=/
const NUMBER = /^[1-9][0-9]{0,9}$/
const ITEM_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/(pull|issues)\/([1-9][0-9]{0,9})$/
const API_PATH = /^\/?repos\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/(pulls|issues)\/([1-9][0-9]{0,9})(\/[a-z0-9_/]{0,40})?$/

// The model's command in shell words, split at unquoted ; & | and newlines, quotes, backslashes and backslash-newlines
// read as sh reads them, and each here-document's body skipped as data. One forward pass, nothing run.
function segmentsOf(command: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let isWord = false
  let quote = ''
  // Here-documents opened on the current line: each body starts at the next unquoted newline.
  const heredocs: { tag: string; isTabbed: boolean }[] = []
  const endWord = () => {
    if (isWord) words.push(word)
    word = ''
    isWord = false
  }
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] ?? ''
    if (quote === "'") {
      if (char === "'") quote = ''
      else word += char
    } else if (quote === '"') {
      if (char === '"') quote = ''
      else if (char === '\\' && command[i + 1] === '\n') i += 1
      else if (char === '\\' && i + 1 < command.length) word += command[(i += 1)] ?? ''
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      isWord = true
    } else if (char === '\\' && command[i + 1] === '\n') {
      i += 1
    } else if (char === '\\' && i + 1 < command.length) {
      word += command[(i += 1)] ?? ''
      isWord = true
    } else if (char === '<' && command[i + 1] === '<') {
      // <<WORD, <<'WORD', <<"WORD" or <<-WORD: the delimiter with its quotes removed. A here-string, <<<, stops at
      // its third < with no delimiter, so no body is skipped.
      endWord()
      i += 2
      const isTabbed = command[i] === '-'
      if (isTabbed) i += 1
      while (command[i] === ' ' || command[i] === '\t') i += 1
      let tag = ''
      for (; i < command.length && !' \t\n;&|<>'.includes(command[i] ?? ''); i += 1) {
        if (command[i] !== "'" && command[i] !== '"' && command[i] !== '\\') tag += command[i]
      }
      i -= 1
      if (tag !== '') heredocs.push({ tag, isTabbed })
    } else if (char === ';' || char === '&' || char === '|' || char === '\n') {
      endWord()
      if (words.length > 0) segments.push(words)
      words = []
      // Each body runs to the line that is its delimiter (leading tabs dropped for <<-), or to the end.
      if (char === '\n') {
        for (const { tag, isTabbed } of heredocs.splice(0)) {
          for (;;) {
            const end = command.indexOf('\n', i + 1)
            const line = command.slice(i + 1, end === -1 ? command.length : end)
            i = end === -1 ? command.length : end
            if (end === -1 || (isTabbed ? line.replace(/^\t+/, '') : line) === tag) break
          }
        }
      }
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else {
      word += char
      isWord = true
    }
  }
  endWord()
  if (words.length > 0) segments.push(words)
  return segments
}

// owner/name as -R or GH_REPO take it: bare, after github.com/, or as a URL; anything else names no repo.
function repoOf(value: string | undefined): string | undefined {
  const bare = (value ?? '').replace(/^(https:\/\/)?github\.com\//, '').replace(/\/$/, '')
  return REPO.test(bare) ? bare : undefined
}

const writeOf = (repo: string | undefined, number: number): Write => (repo === undefined ? { number } : { repo, number })

function apiWriteOf(words: string[], envRepo: string | undefined): Write | undefined {
  let method: string | undefined
  let hasFields = false
  let endpoint: string | undefined
  for (let j = 0; j < words.length; j += 1) {
    const word = words[j] ?? ''
    const at = word.indexOf('=')
    const [flag, inline] = word.startsWith('--') && at > 0 ? [word.slice(0, at), word.slice(at + 1)] : [word, undefined]
    if (flag === '-X' || flag === '--method') method = inline ?? words[(j += 1)]
    else if (FIELD_FLAGS.includes(flag)) {
      hasFields = true
      if (inline === undefined) j += 1
    } else if (word.startsWith('-')) {
      if (inline === undefined && API_VALUE_FLAGS.includes(flag)) j += 1
    } else endpoint ??= word
  }
  const verb = (method ?? (hasFields ? 'POST' : 'GET')).toUpperCase()
  const path = API_PATH.exec(endpoint ?? '')
  if (!['POST', 'PUT', 'PATCH'].includes(verb) || path === null) return undefined
  return writeOf(repoOf(path[1]) ?? envRepo, Number(path[3]))
}

function segmentWriteOf(words: string[]): Write | undefined {
  let i = 0
  let envRepo: string | undefined
  for (; i < words.length && ENV.test(words[i] ?? ''); i += 1) {
    if ((words[i] ?? '').startsWith('GH_REPO=')) envRepo = repoOf((words[i] ?? '').slice('GH_REPO='.length))
  }
  if (words[i] !== 'gh') return undefined
  const [noun, verb = ''] = [words[i + 1], words[i + 2]]
  if (noun === 'api') return apiWriteOf(words.slice(i + 2), envRepo)
  if (!((noun === 'pr' && PR_WRITES.includes(verb)) || (noun === 'issue' && ISSUE_WRITES.includes(verb)))) return undefined
  let repo = envRepo
  let target: string | undefined
  for (let j = i + 3; j < words.length; j += 1) {
    const word = words[j] ?? ''
    const at = word.indexOf('=')
    const [flag, inline] = word.startsWith('--') && at > 0 ? [word.slice(0, at), word.slice(at + 1)] : [word, undefined]
    if (flag === '-R' || flag === '--repo') repo = repoOf(inline ?? words[(j += 1)])
    else if (word.startsWith('-')) {
      if (inline === undefined && VALUE_FLAGS.includes(flag)) j += 1
    } else target ??= word
  }
  if (target !== undefined && NUMBER.test(target)) return writeOf(repo, Number(target))
  const url = ITEM_URL.exec(target ?? '')
  return url === null ? undefined : writeOf(repoOf(url[1]), Number(url[3]))
}

// Every gh write in a Bash command: pr merge, review, close and comment, issue close and comment, and api POST, PUT
// or PATCH on a pulls or issues path.
export const writesOf = (command: string): Write[] => segmentsOf(command).flatMap(words => segmentWriteOf(words) ?? [])
