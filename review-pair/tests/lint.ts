import { BACKGROUNDS, BAND_BG, PALETTES, PILL_BG, contrast } from './palette'
import { textOf } from './world'

export { contrast }

// G7's theme lint over a drawn tree: ThemeKeys only, no subtle, no dimColor, words only in a key that reaches 5:1 on
// white, Latte, black and Mocha in every RGB theme (text or inactive), colour only on the glyphs, every row a glyph
// plus words (the tab glyphs exempt: the card names the state), and the one border a left rule ('quote', the
// terminal's style that draws its left edge; I4 review F2 saw it cost a blank row above and below a one-row Box on
// 2.1.296, so a one-row rule is drawn as the ▎ glyph instead) in a key that reaches 3:1, the non-text floor, everywhere.
// One exception it cannot see or fix: the engine draws each Button's hotkey letter in its accent colour, measured as
// the suggestion blue (3.89:1 on Latte), and ButtonProps has no colour; theme.test.ts asserts it and the legend
// names it. I2c: the trend's bars are graphics, held to the 3:1 non-text floor in their key; this week's words take the
// one other key that reaches 5:1 everywhere (autoAccept); its direction is a status glyph (▼ falling).
// I1 (rule R1, Q1): a pill is a Text with backgroundColor from PILL_BG, inverseText words, bold, uppercase, one space
// of padding each side; a band is a Box or Text with backgroundColor from BAND_BG and words in text. Any other
// background is refused, as are warning, claude and suggestion words still. The budget: at most one pill per keyed
// Box, three in the attention line, three across a drawing (the legend's swatches aside), and no colour on a Button.
export const THEME_KEYS = [
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude',
  'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved',
  'diffAddedDimmed', 'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord',
]
// The rule glyph is the legend's swatch of the draft block's left edge, which 'quote' draws with the same glyph.
export const RULE = '▎'
// I5: the decision ledger's marks join them: ◆ seen, ◇ changed since you looked, ‖ held.
export const GLYPHS = ['✓', '✗', '▲', '▼', '○', '●', '✻', RULE, '◆', '◇', '‖']
// A run of bar heights: the trend's graphics, never words; a lone one is the legend's swatch, its row's glyph.
const BARS = /^[▁▂▃▄▅▆▇█]+$/
// A pill's words: one space, uppercase words, counts or a number after them, one space.
const PILL_WORDS = /^ [A-Z][A-Z ]*( [0-9#][0-9a-z]*)* $/
export const PILL_LIMIT = 3
export const ATTENTION_KEY = 'attention'
export const LEGEND_KEY = 'legend-lines'

// A key's lowest contrast over every RGB theme on that theme's two backgrounds.
export function worst(key: string): number {
  let low = Number.POSITIVE_INFINITY
  for (const palette of Object.values(PALETTES)) {
    const fg = palette.keys[key]
    if (fg === undefined) return 0
    for (const bg of Object.values(BACKGROUNDS[palette.family])) low = Math.min(low, contrast(fg, bg))
  }
  return low
}

export const WORD_FLOOR = 5
export const RULE_FLOOR = 3
// The roles allow words in text and inactive alone, and only while each still reaches 5:1 everywhere.
const WORD_COLORS: unknown[] = [undefined, ...['text', 'inactive', 'autoAccept'].filter(key => worst(key) >= WORD_FLOOR)]
// The draft's blue: either blue key the themes carry, while it reaches 3:1 everywhere.
const RULE_COLORS: unknown[] = ['suggestion', 'permission'].filter(key => worst(key) >= RULE_FLOOR)

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (value: unknown): value is Node => value !== null && typeof value === 'object' && typeof (value as Node).type === 'string'
const keyOf = (node: Node) => String(node.props?.key ?? '')
const isPillBg = (value: unknown) => (PILL_BG as readonly string[]).includes(String(value))
const isBandBg = (value: unknown) => (BAND_BG as readonly string[]).includes(String(value))
export const isPill = (node: unknown) => isNode(node) && node.type === 'Text' && isPillBg(node.props?.backgroundColor)

function texts(node: unknown, found: Node[] = []): Node[] {
  if (!isNode(node)) return found
  if (node.type === 'Text') found.push(node)
  for (const child of node.children ?? []) texts(child, found)
  return found
}

export function lint(tree: unknown): string[] {
  const problems: string[] = []
  // The pills drawn, by the keyed Box holding each; the legend's swatches are not counted.
  const pillsIn = new Map<string, number>()
  let drawn = 0
  const walk = (node: unknown, row: string | undefined, holder: string | undefined, isLegend: boolean) => {
    if (!isNode(node)) return
    const props = node.props ?? {}
    const key = keyOf(node)
    const here = node.type === 'Box' && (key.startsWith('row-') || key.startsWith('tabs-')) ? key : row
    // The budget's holders alone: a pill wrapped in any other keyed Box still counts under its row or the attention line.
    const keyed = node.type === 'Box' && (key.startsWith('row-') || key.startsWith('tabs-') || key === ATTENTION_KEY || key === 'title') ? key : holder
    const inLegend = isLegend || key === LEGEND_KEY
    for (const prop of ['color', 'backgroundColor', 'borderColor']) {
      const value = props[prop]
      if (value === undefined) continue
      if (!THEME_KEYS.includes(String(value)) && !isBandBg(value)) problems.push(`${node.type} ${prop} "${String(value)}" is not a ThemeKey`)
      if (value === 'subtle') problems.push(`${node.type} ${prop} subtle`)
    }
    if (props.dimColor !== undefined) problems.push(`dimColor on ${node.type} "${textOf(node)}"`)
    if (props.borderDimColor !== undefined) problems.push(`borderDimColor on ${node.type} "${key}"`)
    if (node.type === 'Button' && (props.color !== undefined || props.backgroundColor !== undefined)) {
      problems.push(`Button "${String(props.label ?? '')}" carries colour`)
    }
    if (node.type === 'Box' && (props.borderStyle !== undefined || props.borderColor !== undefined)) {
      if (props.borderStyle !== 'quote') problems.push(`Box "${key}" border ${String(props.borderStyle)}: only the left rule, quote, is drawn`)
      if (!RULE_COLORS.includes(props.borderColor)) problems.push(`Box "${key}" rule in ${String(props.borderColor)}, under ${RULE_FLOOR}:1 or not the draft blue`)
    }
    if (node.type === 'Box' && props.backgroundColor !== undefined) {
      if (!isBandBg(props.backgroundColor)) problems.push(`Box "${key}" band on ${String(props.backgroundColor)}: not a band key`)
      for (const text of texts(node)) {
        const color = text.props?.color
        if (color !== undefined && color !== 'text') problems.push(`band "${key}" words "${textOf(text).slice(0, 40)}" in ${String(color)}, not text`)
      }
    }
    if (node.type === 'Text') {
      const shown = textOf(node)
      const isGlyph = GLYPHS.includes(shown)
      const isBars = BARS.test(shown)
      const bg = props.backgroundColor
      const isPilled = isPillBg(bg)
      if (bg !== undefined && isPilled) {
        if (props.color !== 'inverseText') problems.push(`pill "${shown}" words in ${String(props.color)}, not inverseText`)
        if (props.bold !== true) problems.push(`pill "${shown}" not bold`)
        if (!PILL_WORDS.test(shown)) problems.push(`pill "${shown}" is not uppercase words with one space each side`)
        if (!inLegend) {
          drawn += 1
          pillsIn.set(keyed ?? '', (pillsIn.get(keyed ?? '') ?? 0) + 1)
        }
      } else if (bg !== undefined && isBandBg(bg)) {
        if (props.color !== undefined && props.color !== 'text') problems.push(`band words "${shown.slice(0, 40)}" in ${String(props.color)}, not text`)
      } else if (bg !== undefined) problems.push(`backgroundColor ${String(bg)} on "${shown.slice(0, 40)}": not a pill or band key`)
      if (isBars && !(THEME_KEYS.includes(String(props.color)) && worst(String(props.color)) >= RULE_FLOOR)) problems.push(`bars "${shown}" in ${String(props.color)}, under ${RULE_FLOOR}:1`)
      if (!isGlyph && !isBars && !isPilled && !WORD_COLORS.includes(props.color)) problems.push(`words "${shown.slice(0, 40)}" in ${String(props.color)}`)
      if (isGlyph && here === undefined) problems.push(`glyph ${shown} outside a row`)
      if (shown === RULE && !RULE_COLORS.includes(props.color)) problems.push(`rule glyph in ${String(props.color)}`)
    }
    if (node.type === 'Box' && key.startsWith('row-')) {
      const inside = texts(node)
      const marks = inside.filter(text => GLYPHS.includes(textOf(text)) || isPill(text))
      const bars = inside.filter(text => BARS.test(textOf(text)))
      const glyphs = marks.length > 0 ? marks : bars
      const words = inside.filter(text => !GLYPHS.includes(textOf(text)) && !BARS.test(textOf(text)) && textOf(text).trim() !== '')
      if (glyphs.length !== 1) problems.push(`row ${key} has ${glyphs.length} glyphs`)
      if (words.length === 0) problems.push(`row ${key} has a glyph and no words`)
    }
    for (const child of node.children ?? []) walk(child, here, keyed, inLegend)
  }
  walk(tree, undefined, undefined, false)
  for (const [key, count] of pillsIn) {
    const limit = key === ATTENTION_KEY ? PILL_LIMIT : 1
    if (count > limit) problems.push(`Box "${key}" has ${count} pills, over ${limit}`)
  }
  if (drawn > PILL_LIMIT) problems.push(`${drawn} pills drawn, over ${PILL_LIMIT}`)
  return problems
}
