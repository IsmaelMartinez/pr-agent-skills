// What every string from GitHub or the model goes through before it is drawn. Classes are written only
// as \p{...} properties: an editor turns a four-hex escape into the character itself.

// A drawing refuses a control character other than tab and newline, and a refused tree closes the pane.
const CONTROL = /(?![\t\n])\p{Cc}/gu
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]/u
const KEYCAP = 0x20e3
const VS15 = 0xfe0e
const VS16 = 0xfe0f
const ZWJ = 0x200d

export const clean = (value: unknown) => String(value ?? '').replace(/\r\n/g, '\n').replace(CONTROL, '')

// One line of at most `max` code points (a title, a name, a path), cut at its end.
export function line(value: unknown, max: number): string {
  const points = Array.from(clean(value).replace(/[ \t\n]+/g, ' ').trim())
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('')
}

// points: how many code points of the input the piece covers, which the wrap pass walks with.
export type Piece = { text: string; isHidden: boolean; points: number }

const hex = (point: number) => point.toString(16).toUpperCase().padStart(4, '0')

// Each run of invisible code points becomes one visible token such as {U+202E} or {U+E0041 +5}, never the
// character itself; a selector or joiner that is part of an emoji stays as it is. One pass, no backtracking.
export function marks(input: string): Piece[] {
  const points = Array.from(input)
  const pieces: Piece[] = []
  let run: number[] = []
  let text = ''
  let count = 0
  const endText = () => {
    if (text !== '') pieces.push({ text, isHidden: false, points: count })
    text = ''
    count = 0
  }
  const endRun = () => {
    if (run.length === 0) return
    pieces.push({ text: `{U+${hex(run[0] ?? 0)}${run.length > 1 ? ` +${run.length - 1}` : ''}}`, isHidden: true, points: run.length })
    run = []
  }
  for (let i = 0; i < points.length; i += 1) {
    const char = points[i] ?? ''
    const point = char.codePointAt(0) ?? 0
    const before = points[i - 1] ?? ''
    const after = points[i + 1] ?? ''
    const isSelector = (point === VS15 || point === VS16) && (EMOJI.test(before) || after.codePointAt(0) === KEYCAP)
    const isJoiner = point === ZWJ && (EMOJI.test(before) || before.codePointAt(0) === VS16) && EMOJI.test(after)
    if (!HIDDEN.test(char) || isSelector || isJoiner) {
      endRun()
      text += char
      count += 1
      continue
    }
    endText()
    run.push(point)
  }
  endRun()
  endText()
  return pieces
}

export const hiddenRuns = (input: string) => marks(input).filter(piece => piece.isHidden).length

// I5: the one string an item's text hash is taken over, which I6's verifier and the pr-maintainer skill rebuild byte for
// byte. The canonical form is the JSON of [draft, [[path, line, body], ...]]: the stored draft (the clean() value the
// show tool keeps, so CR LF is already LF and no control character but tab and newline is left; '' when there is none),
// then each inline comment in the order given, path and body as stored and line a number. JSON, not joined text, so it
// reads back one way only (security review: a draft holding "\n\na:1\nb" must not hash like an inline comment on a, line
// 1). The hash is the whole SHA-256 over its UTF-8 in lowercase hex, compared whole; the pane and the tool result show
// its first 6. Undefined with neither a draft nor an inline comment: such an item has no hash. For example, the draft
// "Thanks, one ask below." with one comment on pr_agent/git_providers/gitlab_provider.py line 979 reading "Could this
// reuse `_as_line`?" is ["Thanks, one ask below.",[["pr_agent/git_providers/gitlab_provider.py",979,"Could this reuse
// `_as_line`?"]]].
export function canonicalText(draft: string | undefined, inline: readonly { path: string; line: number; body: string }[] = []): string | undefined {
  if (draft === undefined && inline.length === 0) return undefined
  return JSON.stringify([draft ?? '', inline.map(comment => [comment.path, comment.line, comment.body])])
}

export async function textHashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

// The line a code fence opens on when it never closes (CommonMark's rule, simplified); no regex.
export function openFence(text: string): number | undefined {
  let open: { mark: string; size: number; line: number } | undefined
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    let start = 0
    while (start < 3 && raw[start] === ' ') start += 1
    const mark = raw[start]
    if (mark !== '`' && mark !== '~') continue
    let end = start
    while (raw[end] === mark) end += 1
    const size = end - start
    if (size < 3) continue
    const rest = raw.slice(end).trim()
    if (open === undefined) {
      if (mark === '`' && rest.includes('`')) continue
      open = { mark, size, line: i + 1 }
    } else if (mark === open.mark && size >= open.size && rest === '') {
      open = undefined
    }
  }
  return open?.line
}

// I2d: how many terminal columns one code point takes, as the engine measures a row: 0 for a combining or enclosing
// mark and the joiner and selectors an emoji is built with, 2 for East Asian Wide and Fullwidth (JavaScript has no
// \p{East_Asian_Width}, so the blocks are listed: Unicode 16's W and F, checked point by point, plus the few the engine's
// own width table has that Unicode leaves unassigned) and anything Extended_Pictographic, 1 otherwise. Over, never
// under: a text-presentation pictograph such as © counts 2 where the engine draws 1, which leaves a column spare on the
// row, while a point counted 1 and drawn 2 would overflow the row and lose its end to the truncate-end guard.
const ZERO = /[\p{Mn}\p{Me}\u{200D}]/u
const WIDE =
  /[\p{Extended_Pictographic}\u{1100}-\u{115F}\u{2329}-\u{232A}\u{2630}-\u{2637}\u{268A}-\u{268F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DFF}\u{4E00}-\u{9FFF}\u{A000}-\u{A4CF}\u{A960}-\u{A97F}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE10}-\u{FE19}\u{FE30}-\u{FE6F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{16FE0}-\u{16FE4}\u{16FF0}-\u{16FF6}\u{17000}-\u{18DF2}\u{1AFF0}-\u{1AFFE}\u{1B000}-\u{1B2FF}\u{1D300}-\u{1D356}\u{1D360}-\u{1D376}\u{1F200}-\u{1F251}\u{1F260}-\u{1F265}\u{1F3FB}-\u{1F3FF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u

export const columnsOf = (char: string): number => (ZERO.test(char) ? 0 : WIDE.test(char) ? 2 : 1)

// The columns a drawn string takes, each hidden run as the token the marks pass draws it as.
export const widthOf = (text: string): number =>
  marks(text).reduce((sum, piece) => sum + (piece.isHidden ? piece.text.length : Array.from(piece.text).reduce((n, char) => n + columnsOf(char), 0)), 0)

type Atom = { text: string; width: number }

// One line of text as rows of at most `width` columns: split at spaces, a word wider than the row cut hard, the
// spaces at a break dropped, every other space and the indentation kept, and the empty line one empty row. A hidden
// run is one atom as wide as its token, so the row the marks pass then draws measures the same (a token is at most 16
// columns, so only a row narrower than that could overflow, and no pane is). One pass over the code points, no regex
// but the per-character classes above.
// The limitation: the marks pass runs on each row alone, so a hard cut inside an emoji sequence (a run of them wider
// than the row, with no space) leaves a joiner at the row's end with no emoji after it, drawn as its {U+200D} token
// and cut by the row's truncate-end guard; a zero-width point otherwise always stays on the row of what it follows.
export function wrap(text: string, width: number): string[] {
  const room = Math.max(1, width)
  const points = Array.from(text)
  const atoms: Atom[] = []
  let at = 0
  for (const piece of marks(text)) {
    if (piece.isHidden) {
      const size = piece.points
      atoms.push({ text: points.slice(at, at + size).join(''), width: piece.text.length })
      at += size
      continue
    }
    for (const char of piece.text) atoms.push({ text: char, width: columnsOf(char) })
    at += piece.points
  }
  const rows: string[] = []
  let row: Atom[] = []
  let used = 0
  let word: Atom[] = []
  let wordWidth = 0
  let isBroken = false
  const flush = () => {
    while (row.length > 0 && row[row.length - 1]?.text === ' ') row.pop()
    // A row that held only indentation (the word after it did not fit beside it) is no row: the word starts the line.
    if (row.length > 0) rows.push(row.map(atom => atom.text).join(''))
    row = []
    used = 0
    isBroken = true
  }
  const place = (atom: Atom) => {
    if (used > 0 && used + atom.width > room) flush()
    row.push(atom)
    used += atom.width
    isBroken = false
  }
  const endWord = () => {
    if (word.length === 0) return
    if (used > 0 && used + wordWidth > room) flush()
    for (const atom of word) place(atom)
    word = []
    wordWidth = 0
  }
  for (const atom of atoms) {
    if (atom.text !== ' ') {
      word.push(atom)
      wordWidth += atom.width
      continue
    }
    endWord()
    if (isBroken) continue
    if (used + 1 > room) {
      flush()
      continue
    }
    row.push(atom)
    used += 1
  }
  endWord()
  rows.push(row.map(atom => atom.text).join(''))
  return rows
}
