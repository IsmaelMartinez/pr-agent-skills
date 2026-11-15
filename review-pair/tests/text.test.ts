import { expect, test } from 'claude-code/testing'

import { CARD, HEAD, ISSUE, REPO, answerOf, ghArgs, isItemUrl, isLogUrl, itemUrl, phraseOf } from '../hooks/github'
import { clean, line, marks, openFence } from '../hooks/text'

// The pure modules load straight into a test: the marks pass, the fence scan, the boundary and the allow-lists.
const shown = (text: string) => marks(text).map(piece => (piece.isHidden ? `[${piece.text}]` : piece.text)).join('')

const CLEAN: [string, string][] = [
  ['issue 882 title', 'Replace \u{1F440}  with \u{2764}\u{FE0F} when response is completed'],
  ['warning sign', 'careful \u{26A0}\u{FE0F} here'],
  ['keycap', 'step 1\u{FE0F}\u{20E3} done'],
  ['family', 'team \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'],
  ['rainbow flag', 'pride \u{1F3F3}\u{FE0F}\u{200D}\u{1F308}'],
  ['skin tone and joiner', 'dev \u{1F469}\u{1F3FD}\u{200D}\u{1F4BB}'],
  ['plain ascii', 'A'],
]

const HOSTILE: [string, string, string][] = [
  ['bidi override', 'abc\u{202E}def', 'abc[{U+202E}]def'],
  ['zero-width space', 'ad\u{200B}min', 'ad[{U+200B}]min'],
  ['joiner between letters', 'ad\u{200D}min', 'ad[{U+200D}]min'],
  ['selector after a letter', 'a\u{FE0F}b', 'a[{U+FE0F}]b'],
  ['tag run', 'x\u{E0041}\u{E0042}\u{E0043}y', 'x[{U+E0041 +2}]y'],
  ['line separator', 'a\u{2028}b', 'a[{U+2028}]b'],
  ['paragraph separator', 'a\u{2029}b', 'a[{U+2029}]b'],
  ['hangul filler', 'a\u{3164}b', 'a[{U+3164}]b'],
  ['grapheme joiner', 'a\u{034F}b', 'a[{U+034F}]b'],
  ['soft hyphen', 'a\u{00AD}b', 'a[{U+00AD}]b'],
  ['isolate run', '\u{2066}\u{2067}\u{2068}\u{2069}', '[{U+2066 +3}]'],
  ['scotland flag tags', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', '\u{1F3F4}[{U+E0067 +5}]'],
]

test('the marks pass: 7 emoji and plain cases draw unmarked, 12 hostile cases each become one visible token', () => {
  for (const [name, text] of CLEAN) {
    expect(marks(text).some(piece => piece.isHidden), name).toBe(false)
    expect(shown(text), name).toBe(text)
  }
  for (const [name, text, want] of HOSTILE) expect(shown(text), name).toBe(want)
  expect(CLEAN.length + HOSTILE.length).toBe(19)
})

test('the marks pass is one token for a 100,000 code point run', () => {
  const long = `a${'\u{200B}'.repeat(100_000)}b`
  expect(shown(long)).toBe('a[{U+200B +99999}]b')
})

test('the fence scan names the line a fence opens on when it never closes, and nothing else', () => {
  const cases: [string, number | undefined][] = [
    ['```suggestion\n        return value\n```\nEnd F1.', undefined],
    ['```suggestion\n    return value\n```\nEnd F2.', undefined],
    ['```suggestion\n        return value\nEnd F3.', 1],
    ['````suggestion\nx = "```"\n````\nEnd F4.', undefined],
    ['````suggestion\nx\n```\nEnd F5.', 1],
    ['Thanks for the fix, approving and merging.', undefined],
    ['text\n~~~\ncode', 2],
    ['inline ```code``` is not a fence', undefined],
  ]
  for (const [text, want] of cases) expect(openFence(text), text).toBe(want)
})

test('clean drops control characters but tab and newline; line keeps one line and cuts at its end', () => {
  expect(clean('a\u{0}b\u{1B}[31mc\u{7}d\r\ne\tf\u{7F}g\u{9F}h')).toBe('ab[31mcd\ne\tfgh')
  expect(line('  two\nlines\tand  spaces ', 100)).toBe('two lines and spaces')
  expect(line('x'.repeat(250), 200)).toHaveLength(200)
  expect(line('x'.repeat(250), 200).endsWith('…')).toBe(true)
  // A cut never splits a surrogate pair.
  expect(line('\u{1F440}'.repeat(5), 3)).toBe('\u{1F440}\u{1F440}…')
  // A separator stays, to be marked when drawn.
  expect(line('a\u{2028}b', 10)).toBe('a\u{2028}b')
})

test('the boundary takes a GitHub owner/name and a 7 to 40 hex head, nothing else', () => {
  for (const repo of ['The-PR-Agent/pr-agent', 'IsmaelMartinez/teams-for-linux', 'a/.github', 'a/b.c', `${'a'.repeat(39)}/${'b'.repeat(100)}`]) {
    expect(REPO.test(repo), repo).toBe(true)
  }
  for (const repo of ['../..', 'a/..', 'a/.', '-a/b', 'a_b/c', 'a/b/c', 'a/b c', 'a/', '/b', `${'a'.repeat(40)}/b`, `a/${'b'.repeat(101)}`, 'a/b\n']) {
    expect(REPO.test(repo), repo).toBe(false)
  }
  for (const head of ['35a07eb', '35a07ebb5e36e780792b0f6bdc04810882ae7d9d']) expect(HEAD.test(head)).toBe(true)
  for (const head of ['35a07e', '35A07EB', 'xyz1234', '35a07ebb5e36e780792b0f6bdc04810882ae7d9d0', '35a07eb\n']) expect(HEAD.test(head)).toBe(false)
})

test('the one argv builder: a constant document, owner and name with -f, only the integer with -F', () => {
  expect(ghArgs(CARD, 'The-PR-Agent/pr-agent', 4045)).toEqual([
    'api', 'graphql', '-f', `query=${CARD}`, '-f', 'owner=The-PR-Agent', '-f', 'name=pr-agent', '-F', 'number=4045',
  ])
  expect(ghArgs(ISSUE, 'The-PR-Agent/pr-agent', 3887)?.at(-1)).toBe('number=3887')
  for (const [repo, number] of [['../..', 1], ['a/b', 0], ['a/b', 1.5], ['a/b', -1], ['a/b', Number.NaN]] as const) {
    expect(ghArgs(CARD, repo, number), `${repo} ${number}`).toBeUndefined()
  }
})

test('URLs are built from the checked repo and an integer and held to the anchored allow-lists', () => {
  const repo = 'The-PR-Agent/pr-agent'
  expect(itemUrl(repo, 'pull', 4045)).toBe('https://github.com/The-PR-Agent/pr-agent/pull/4045')
  expect(itemUrl(repo, 'issues', 3887)).toBe('https://github.com/The-PR-Agent/pr-agent/issues/3887')
  expect(itemUrl('../..', 'pull', 1)).toBeUndefined()
  expect(itemUrl(repo, 'pull', 0)).toBeUndefined()
  expect(isLogUrl('https://github.com/The-PR-Agent/pr-agent/actions/runs/37982669329/job/113996811103', repo)).toBe(true)
  expect(isLogUrl('https://github.com/The-PR-Agent/pr-agent/runs/113997650002', repo)).toBe(true)
  // A dot in the repo is a dot, not any character.
  expect(isItemUrl('https://github.com/a/bxc/pull/1', 'a/b.c')).toBe(false)
  expect(isItemUrl('https://github.com/a/b.c/pull/1', 'a/b.c')).toBe(true)
  for (const url of [
    'javascript:alert(1)',
    'https://github.com/The-PR-Agent/pr-agent/pull/1\n',
    'https://github.com/The-PR-Agent/pr-agent/pull/1#x',
    'https://github.com/The-PR-Agent/pr-agent/pull/',
    'https://github.com/The-PR-Agent/pr-agent/pulls/1',
    'https://github.com/The-PR-Agent/pr-agent/actions/runs/1/job/2',
    'https://github.com/The-PR-Agent/pr-agent-x/pull/1',
    'https://github.com/x/The-PR-Agent/pr-agent/pull/1',
    'javascript:alert(1)//https://github.com/The-PR-Agent/pr-agent/pull/1',
  ]) {
    expect(isItemUrl(url, repo), url).toBe(false)
  }
  for (const url of [
    'https://github.com/The-PR-Agent/pr-agent/pull/1',
    'https://github.com/The-PR-Agent/pr-agent/runs/x',
    'https://sonarcloud.io/dashboard?id=x',
    'https://greptile.com/',
    'javascript:alert(1)//https://github.com/The-PR-Agent/pr-agent/runs/1',
    'https://github.com/The-PR-Agent/pr-agent/runs/1/x',
  ]) {
    expect(isLogUrl(url, repo), url).toBe(false)
  }
})

test('gh failures become six fixed phrases, and only JSON with no errors is an answer', () => {
  expect(phraseOf('gh: Bad credentials (HTTP 401)')).toBe('GitHub sign-in failed: run gh auth login')
  expect(phraseOf('To get started with GitHub CLI, please run:  gh auth login')).toBe('GitHub sign-in failed: run gh auth login')
  expect(phraseOf('gh: API rate limit exceeded for user ID 1.')).toBe('GitHub rate limit reached')
  expect(phraseOf('error connecting to api.github.com\ncheck your internet connection')).toBe('GitHub unreachable: offline?')
  expect(phraseOf('Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused')).toBe('GitHub unreachable: offline?')
  expect(phraseOf("gh: Could not resolve to a Repository with the name 'x/y'.")).toBe('GitHub error')
  expect(phraseOf('gh: HTTP 502: Bad Gateway')).toBe('GitHub error')
  expect(answerOf(0, '{"data":{}}', '')).toEqual({ json: { data: {} } })
  expect(answerOf(0, '{"data":{},"errors":[{}]}', '')).toEqual({ failed: 'GitHub error' })
  expect(answerOf(0, '<html>', '')).toEqual({ failed: 'GitHub error' })
  expect(answerOf(0, '[1]', '')).toEqual({ failed: 'GitHub error' })
  expect(answerOf(1, '{"data":{}}', 'gh: HTTP 401')).toEqual({ failed: 'GitHub sign-in failed: run gh auth login' })
})
