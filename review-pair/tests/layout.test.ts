import { expect, test } from 'claude-code/testing'

import { FIT } from './fixtures'
import { PAIR, PRA, SURFACES, TFL_PAIR, TOOL, clone, columnOf, detailed, mountPane, world } from './world'

// G2 in the kit: the drawing every surface is handed. Whether a row paints as one screen row is the paint
// harness's to show (tmp/i1a/paint); here, head and CI hold the same place in the column on every tab, the
// rows from the title to them are each one cut line (Claude's row above wraps, I2d), red comes before amber, and
// clear never lists an unknown.
// I5: the decision facts row under the title moves the status line one row down; s opens head and CI under it.
const STATUS_ROW = 5
const HEAD_ROW = STATUS_ROW + 1
const CI_ROW = STATUS_ROW + 2
// The 39-column dock is tall: for a pair its column also lists the batch row (the ledger names the next item), so the
// status line sits one row lower than on the 104-column strip, which has none. A lone item has no batch row.
const STATUS_ROWS: Record<number, number> = { 39: STATUS_ROW + 1, 104: STATUS_ROW }
const CLAUDE_ROWS: Record<number, number> = { 39: 2, 104: 1 }

async function tabsOf($: any, surface: (typeof SURFACES)[number], columns: number, count: number, isDetailed = false) {
  const ui = await mountPane($, surface, columns)
  const columnsByTab: string[][] = []
  for (let tab = 0; tab < count; tab += 1) {
    await ui.press({ key: `tab-${tab}` })
    // s stays as it was left for each item, so a collapsed read closes what an earlier one opened.
    if (isDetailed) await detailed(ui)
    else if ((await ui.find({ type: 'Button', key: 'details' }))?.props?.label === 'collapse') await ui.press({ key: 'details' })
    columnsByTab.push(await columnOf(ui))
  }
  return { ui, columnsByTab }
}

test('the status line, and head and CI under it once s opens them, sit at the same place on every tab, at 39 and 104 columns', async ($, on) => {
  world(on)
  for (const pair of [PAIR, TFL_PAIR, { repo: PRA, items: [PAIR.items[0], { number: 3887, kind: 'issue', action: 'reply' }] }]) {
    await $.tool.call({ tool: TOOL, tool_use_id: `c-${pair.items.length}-${pair.repo}`, ...pair })
    for (const surface of SURFACES) {
      for (const columns of [39, 104]) {
        for (const isDetailed of [false, true]) {
          const { ui, columnsByTab } = await tabsOf($, surface, columns, pair.items.length, isDetailed)
          const at = STATUS_ROWS[columns] as number
          for (const column of columnsByTab) {
            expect(column[at]).toMatch(/^[✓▲✗●○] .* s: (details|collapse)$/)
            if (isDetailed) {
              expect(column[at + 1]).toMatch(/^. (head|issue) /)
              expect(column[at + 2]).toMatch(/^. (CI |labels:? )/)
            } else expect(column.some((row, i) => i !== at && /^. (head|CI) /.test(row))).toBe(false)
            expect(column[CLAUDE_ROWS[columns] as number]).toMatch(/^✻ Claude/)
          }
          await ui.unmount()
        }
      }
    }
  }
})

test('the column takes the whole room on every tab, so an inline strip never resizes and its rows hold still', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...TFL_PAIR })
  for (const surface of SURFACES) {
    for (const [columns, rows] of [[104, 11], [39, 34]] as const) {
      const ui = await mountPane($, surface, columns)
      for (const tab of [0, 1]) {
        await ui.press({ key: `tab-${tab}` })
        expect(((await ui.drawn()) as any).props.minHeight).toBe(rows)
      }
      await ui.unmount()
    }
  }
})

test('the title, byline, head, CI and clear line are each one line cut at its end; the Claude row wraps whole (I2d)', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    for (const tab of [0, 1]) {
      await ui.press({ key: `tab-${tab}` })
      await detailed(ui)
      const root = (await ui.drawn()) as any
      // I5: the facts row sits between the title and the byline. The 39-column dock is tall: the batch row follows the
      // tabs, and spacer rows sit before Claude's row and the title.
      const [, , , claude, , title, , byline, status, rows] = root.children
      expect(status.props.key).toBe('status')
      const [head, ci] = rows.children
      const wordsOf = (row: any) => row.children[row.children.length - 1].children[0] ?? row.children[1].children[0]
      // I2d: Claude's ask wraps in full beside its glyph; the rows from the title down stay one row each.
      expect(claude.children[1].children[0].props.wrap).toBe('wrap')
      // I2b: the title row starts with the item's detail key, 0, and its words are cut at their end. I1 colour roles: the
      // item's pill leads the row when it has one (HEAD MOVED on tab 2; tab 1's open thread is amber, so none).
      const at = tab === 0 ? 0 : 1
      if (tab === 1) expect(title.children[0].children[0]).toMatchObject({ type: 'Text', props: { backgroundColor: 'error' } })
      expect(title.children[at].children[0]).toMatchObject({ type: 'Button', props: { hotkey: '0', label: 'detail' } })
      expect(title.children[at + 1].children[0].props.wrap).toBe('truncate-end')
      expect(byline.props.wrap).toBe('truncate-end')
      expect(head.children[1].children[0].props.wrap).toBe('truncate-end')
      expect(ci.children[1].children[0].props.wrap).toBe('truncate-end')
      expect(wordsOf(head)).toBeDefined()
      const clear = await ui.find({ type: 'Text', text: /^clear: / })
      expect(clear?.props.wrap).toBe('truncate-end')
    }
    await ui.unmount()
  }
})

test('red rows come before amber, amber before neutral notes, then the clear line', async ($, on) => {
  const seen = world(on)
  const card = clone(seen.answers[`${PRA}#2450`])
  const pr = card.data.repository.pullRequest
  pr.isDraft = false
  pr.baseRefName = 'release'
  pr.labels.nodes.push({ name: 'breaking change' })
  pr.labels.totalCount += 1
  pr.files.nodes.push({ path: 'uv.lock' }, { path: 'pr_agent/settings/configuration.toml' })
  pr.files.totalCount += 2
  pr.reviewThreads.nodes[0].comments.nodes[0].author.__typename = 'User'
  seen.answers[`${PRA}#2450`] = card
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', repo: PRA, items: [{ number: 2450, action: 'carry the fix', head: '7ca951b' }] })
  const ui = await mountPane($, 'terminal')
  // Collapsed, the line names the worst two and counts the rest; conflicts is its merge slot.
  expect((await columnOf(ui))[STATUS_ROW]).toBe('✗ breaking label · ✗ code that runs · +4 · ✗ conflicts · not draft s: details')
  await detailed(ui)
  const column = await columnOf(ui)
  const rank: Record<string, number> = { '✗': 0, '●': 0, '▲': 1, '○': 2, '✓': 3 }
  const facts = column.slice(CI_ROW + 1).filter(row => /^[✗●▲○✓] /.test(row))
  expect(facts).toEqual([
    '✗ conflicts with the base',
    '✗ breaking label',
    '✗ code that runs: lockfile uv.lock',
    '✗ maintainer edits off, the carry cannot be pushed',
    '▲ 1 open thread, person: gitlab_provider.py:979',
    '▲ 1 open thread, bot: test_github_clone_url_validation.py:18',
    // I2: a is never a row letter.
    '▲ b: #2445 linked issue already closed',
    '▲ base release, not main',
    '○ touches pr_agent/settings',
    '✓ clear: not draft, no changes requested, no rival PR',
  ])
  const ranks = facts.map(row => rank[row[0] ?? ''] ?? 9)
  expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
})

test('BLOCKED with REVIEW_REQUIRED never shows, and a norm read short of its total is never clear', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'c1', ...PAIR })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await detailed(ui)
    expect(await ui.find({ text: /blocked|BLOCKED|needs your approval|review required|REVIEW_REQUIRED/i })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^clear: / }))?.text).toBe(
      'clear: no conflicts, not draft, no changes requested, not breaking, no code that runs, base main',
    )
    await ui.unmount()
  }
  const card = clone(seen.answers[`${PRA}#4045`])
  const pr = card.data.repository.pullRequest
  pr.reviewThreads.totalCount = 51
  pr.closingIssuesReferences.totalCount = 6
  pr.reviewDecision = null
  pr.latestReviews.totalCount = 11
  seen.answers[`${PRA}#4046`] = card
  await $.tool.call({ tool: TOOL, tool_use_id: 'c2', repo: PRA, items: [{ number: 4046, action: 'approve' }] })
  const ui = await mountPane($, 'terminal')
  await detailed(ui)
  const column = await columnOf(ui)
  expect(column).toContain('▲ 2 of 51 threads read, open threads unknown')
  expect(column).toContain('▲ 1 of 11 reviews read, changes requested unknown')
  expect(column).toContain('▲ 0 of 6 linked issues read')
  const clear = column.find(row => row.startsWith('✓ clear: ')) ?? ''
  expect(clear).not.toMatch(/threads|changes requested|rival/)
})

test('I5: the 17 recorded open PRs draw one status line at row 6, and once opened head and CI at 7 and 8 and every red or amber row as one row each', async ($, on) => {
  world(on)
  const numbers = Object.keys(FIT).map(key => Number(key.split('#')[1]))
  expect(numbers).toHaveLength(17)
  const tallest: number[] = []
  for (let start = 0; start < numbers.length; start += 3) {
    const items = numbers.slice(start, start + 3).map(number => ({ number, action: 'review' }))
    await $.tool.call({ tool: TOOL, tool_use_id: `fit-${start}`, repo: PRA, items })
    const collapsed = await tabsOf($, 'terminal', 104, items.length)
    // Collapsed, the status line is the last fact row: the strip's six rows down to it hold for every PR.
    for (const column of collapsed.columnsByTab) {
      expect(column[STATUS_ROW]).toMatch(/^[✓▲✗●] .* s: details$/)
      expect(column.slice(STATUS_ROW + 1).some(row => /^[✓✗●▲○] /.test(row))).toBe(false)
    }
    await collapsed.ui.unmount()
    const { ui, columnsByTab } = await tabsOf($, 'terminal', 104, items.length, true)
    for (const column of columnsByTab) {
      expect(column[HEAD_ROW]).toMatch(/^. head /)
      expect(column[CI_ROW]).toMatch(/^. CI /)
      // With each element one row and the tab row one row at 104 columns for up to three items.
      const lastAlert = column.reduce((last, row, i) => (/^[✗●▲] /.test(row) ? i : last), CI_ROW)
      tallest.push(lastAlert + 1)
    }
    await ui.unmount()
  }
  expect(tallest).toHaveLength(17)
  // Opened, the rows are the old ones under the status line: one more than the strip's 11.
  expect(Math.max(...tallest)).toBeLessThanOrEqual(12)
})
