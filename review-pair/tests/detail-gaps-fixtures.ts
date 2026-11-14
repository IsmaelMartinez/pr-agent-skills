// Variants of the recorded PR #3995 (detail-fixtures.ts) for the states and shapes the recording never held: a draft,
// a merged PR, more labels than the document's window, and a hostile title. Each is the recording with one change.
import { PR_3995 } from './detail-fixtures'

const variant = (change: (pr: any) => void): unknown => {
  const answer = JSON.parse(JSON.stringify(PR_3995))
  change(answer.data.repository.pullRequest)
  return answer
}

export const PR_3995_DRAFT: unknown = variant(pr => {
  pr.isDraft = true
})

export const PR_3995_MERGED: unknown = variant(pr => {
  pr.state = 'MERGED'
})

// Seven labels on GitHub, five in the window the document asks for.
export const PR_3995_LABELLED: unknown = variant(pr => {
  pr.labels = { totalCount: 7, nodes: ['bug', 'two', 'three', 'four', 'five'].map(name => ({ name })) }
})

// ESC and BEL (control characters the drawing refuses), a bidi override and its pop (invisible, drawn as tokens).
export const HOSTILE_TITLE = 'fix \u{1B}[31mred\u{7} \u{202E}hidden\u{202C} end'
export const PR_3995_HOSTILE_TITLE: unknown = variant(pr => {
  pr.title = HOSTILE_TITLE
})
