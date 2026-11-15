// The four RGB built-in themes of Claude Code 2.1.294 and 2.1.296 (identical in both), read from each binary with
// tmp/visual-designer/themes.py; f1() in the binary maps light, light-daltonized, dark-daltonized and the default (dark).
// The ansi themes take the terminal's own palette and are not measured here. I1: selectionBg and userMessageBackground
// are the two untyped keys a focus band may take, read from the 2.1.296 binary's theme strings beside each theme's
// success value (2026-10-18); an untyped key resolves like a ThemeKey (d.ts 12518).
export const PALETTES: Record<string, { family: 'light' | 'dark'; keys: Record<string, [number, number, number]> }> = {
  'light': {
    family: 'light',
    keys: {
      text: [0, 0, 0],
      inverseText: [255, 255, 255],
      inactive: [102, 102, 102],
      subtle: [175, 175, 175],
      suggestion: [87, 105, 247],
      remember: [0, 0, 255],
      success: [44, 122, 57],
      error: [171, 43, 63],
      warning: [150, 108, 30],
      merged: [135, 0, 255],
      claude: [215, 119, 87],
      permission: [87, 105, 247],
      planMode: [0, 102, 102],
      autoAccept: [135, 0, 255],
      promptBorder: [138, 138, 138],
      bashBorder: [255, 0, 135],
      ide: [71, 130, 200],
      diffAdded: [105, 219, 124],
      diffRemoved: [255, 168, 180],
      diffAddedDimmed: [199, 225, 203],
      diffRemovedDimmed: [253, 210, 216],
      diffAddedWord: [47, 157, 68],
      diffRemovedWord: [209, 69, 75],
      selectionBg: [180, 213, 255],
      userMessageBackground: [240, 240, 240],
    },
  },
  'light-daltonized': {
    family: 'light',
    keys: {
      text: [0, 0, 0],
      inverseText: [255, 255, 255],
      inactive: [102, 102, 102],
      subtle: [175, 175, 175],
      suggestion: [51, 102, 255],
      remember: [51, 102, 255],
      success: [0, 102, 153],
      error: [204, 0, 0],
      warning: [255, 153, 0],
      merged: [135, 0, 255],
      claude: [255, 153, 51],
      permission: [51, 102, 255],
      planMode: [51, 102, 102],
      autoAccept: [135, 0, 255],
      promptBorder: [138, 138, 138],
      bashBorder: [0, 102, 204],
      ide: [71, 130, 200],
      diffAdded: [153, 204, 255],
      diffRemoved: [255, 204, 204],
      diffAddedDimmed: [209, 231, 253],
      diffRemovedDimmed: [255, 233, 233],
      diffAddedWord: [51, 102, 204],
      diffRemovedWord: [153, 51, 51],
      selectionBg: [180, 213, 255],
      userMessageBackground: [220, 220, 220],
    },
  },
  'dark': {
    family: 'dark',
    keys: {
      text: [255, 255, 255],
      inverseText: [0, 0, 0],
      inactive: [153, 153, 153],
      subtle: [80, 80, 80],
      suggestion: [177, 185, 249],
      remember: [177, 185, 249],
      success: [78, 186, 101],
      error: [255, 107, 128],
      warning: [255, 193, 7],
      merged: [175, 135, 255],
      claude: [215, 119, 87],
      permission: [177, 185, 249],
      planMode: [72, 150, 140],
      autoAccept: [175, 135, 255],
      promptBorder: [136, 136, 136],
      bashBorder: [253, 93, 177],
      ide: [71, 130, 200],
      diffAdded: [34, 92, 43],
      diffRemoved: [122, 41, 54],
      diffAddedDimmed: [71, 88, 74],
      diffRemovedDimmed: [105, 72, 77],
      diffAddedWord: [56, 166, 96],
      diffRemovedWord: [179, 89, 107],
      selectionBg: [38, 79, 120],
      userMessageBackground: [55, 55, 55],
    },
  },
  'dark-daltonized': {
    family: 'dark',
    keys: {
      text: [255, 255, 255],
      inverseText: [0, 0, 0],
      inactive: [153, 153, 153],
      subtle: [80, 80, 80],
      suggestion: [153, 204, 255],
      remember: [153, 204, 255],
      success: [51, 153, 255],
      error: [255, 102, 102],
      warning: [255, 204, 0],
      merged: [175, 135, 255],
      claude: [255, 153, 51],
      permission: [153, 204, 255],
      planMode: [102, 153, 153],
      autoAccept: [175, 135, 255],
      promptBorder: [136, 136, 136],
      bashBorder: [51, 153, 255],
      ide: [71, 130, 200],
      diffAdded: [0, 68, 102],
      diffRemoved: [102, 0, 0],
      diffAddedDimmed: [62, 81, 91],
      diffRemovedDimmed: [62, 44, 44],
      diffAddedWord: [0, 119, 179],
      diffRemovedWord: [179, 0, 0],
      selectionBg: [38, 79, 120],
      userMessageBackground: [55, 55, 55],
    },
  },
}

// The backgrounds G7 measures on: pure white and Catppuccin Latte under a light theme, black and Mocha under a dark one.
export const BACKGROUNDS: Record<'light' | 'dark', Record<string, [number, number, number]>> = {
  light: { white: [255, 255, 255], latte: [239, 241, 245] },
  dark: { black: [0, 0, 0], mocha: [30, 30, 46] },
}

const channel = (value: number) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

// WCAG 2.x contrast of a theme key on a background.
export function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// I1 (plan section 2, Q1): the keys a pill may be drawn on, with inverseText words, and the keys a band may be drawn
// on, with text words. Each pairing is measured at load, so a theme change that drops one under 5:1 fails every test
// file: the lint's allow-lists are only as good as these figures.
export const PILL_BG = ['error', 'planMode', 'success', 'merged', 'inactive'] as const
export const BAND_BG = ['selectionBg', 'userMessageBackground', 'diffAddedDimmed', 'diffRemovedDimmed'] as const
export const PILL_FLOOR = 5

// Words in `fg` on the key `bg`, in each RGB theme, to two decimals; 0 for a key a theme lacks.
export function pairing(fg: string, bg: string): Record<string, number> {
  const table: Record<string, number> = {}
  for (const [name, palette] of Object.entries(PALETTES)) {
    const [words, ground] = [palette.keys[fg], palette.keys[bg]]
    table[name] = words === undefined || ground === undefined ? 0 : Math.round(contrast(words, ground) * 100) / 100
  }
  return table
}

// Throws for the first pairing under the floor in `palettes`; run at load over the real ones.
export function assertFloors(palettes: typeof PALETTES = PALETTES): void {
  for (const [fg, keys] of [['inverseText', PILL_BG], ['text', BAND_BG]] as const) {
    for (const bg of keys) {
      for (const [theme, palette] of Object.entries(palettes)) {
        const [words, ground] = [palette.keys[fg], palette.keys[bg]]
        const ratio = words === undefined || ground === undefined ? 0 : Math.round(contrast(words, ground) * 100) / 100
        if (ratio < PILL_FLOOR) throw new Error(`palette: ${fg} on ${bg} reaches ${ratio}:1 in ${theme}, under ${PILL_FLOOR}:1`)
      }
    }
  }
}
assertFloors()
