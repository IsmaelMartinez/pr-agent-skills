---
name: release-map
description: "Use after a PR-Agent release, or whenever someone asks what changed between releases, to build one shareable HTML page of every merged pull request in the last few releases plus what is waiting on the default branch: upgrade notes first, a per-day chart, headline changes in plain English, and a searchable list."
version: 1.0.0
author: The-PR-Agent community
license: MIT
---

# Release map

A release map is one self-contained HTML file that answers two questions for people deciding whether to upgrade: what do I need to change before upgrading, and what is new. It lists every pull request merged between the last few published releases, plus an Unreleased lane for the default branch, with the upgrade notes at the top. Run it after each release and share the file.

Two scripts do the mechanical work, and you do the editorial part in between:

1. `scripts/collect.py` reads the releases, compare ranges, pull requests and release notes from GitHub and writes `collected.json` plus the full description of every PR under `bodies/`.
2. You write `editorial.json`: a theme for each PR, a short note for the headline changes, and upgrade notes where the release notes have none. This step is optional, and the page works without it.
3. `scripts/render.py` checks both files and writes `release-map.html`. It refuses to write the page while any check fails.

## Prerequisites and scope

- `gh`, authenticated with read access to the repository, and Python 3. Nothing else: no packages, no network calls other than through `gh`.
- GitHub repositories only. The scripts read compare ranges, releases and pull requests through the GitHub API. They recognise squash-merge titles ending in `(#123)` and `Merge pull request #123` merge commits; other commits are counted and reported, not dropped silently.
- Published releases only. Draft and pre-releases are skipped, so an unpublished release shows up as the Unreleased lane.

## Run it

```bash
SKILL=<path to this skill>
python3 $SKILL/scripts/collect.py --repo The-PR-Agent/pr-agent --releases 3 --workdir release-map-work
# write release-map-work/editorial.json (next section)
python3 $SKILL/scripts/render.py release-map-work/collected.json --editorial release-map-work/editorial.json --out release-map.html
```

`collect.py` takes `--repo` (default: the repository of the current directory), `--releases N` (default 3, or `all` for every published release), `--no-unreleased` to leave out the default-branch lane, and `--workdir`. It prints one line per release with its PR count and the number of upgrade notes it found, then how many PRs are missing or were not merged through GitHub. Read that summary before going on: a release with zero upgrade notes either had none or uses a heading the script does not recognise.

## Write editorial.json

Read `collected.json` for the list of PRs and `bodies/<pr>.md` for each description. Then write:

```json
{
  "lede": "Optional. One paragraph on what the latest release is about, citing PRs as #123.",
  "themes": {"review": "Review quality", "security": "Security and isolation", "config": "Configuration and output",
             "models": "Models and cost", "providers": "Provider parity", "maint": "Maintenance"},
  "items": [
    {"pr": 4700, "theme": "security",
     "h": "Auto-approval pinned to the reviewed head and made host-only",
     "why": "Approval now targets the reviewed head SHA and is skipped if the head moved. config.enable_auto_approval can no longer be set from a repository's .pr_agent.toml.",
     "cfg": "Host-only",
     "evidence": "a sentence copied verbatim from the PR description that the note relies on"}
  ],
  "upgrade": {"Unreleased": ["`/answer` and `/auto_review` are removed (#4798)."]}
}
```

- Themes: about six, the same set for every release, and one per PR. Six keeps the filter readable; a seventh is fine if a release really needs it. Skip themes entirely and the theme filter disappears.
- Headlines: about one PR in eight. Pick user-visible features, changed defaults, settings that moved, were renamed or became host-only, security fixes, and anything that breaks an existing configuration. Routine fixes, tests, docs and dependency bumps are not headlines.
- `h` is one plain line. `why` is one or two sentences in your own words, from the full description, not the title. `cfg` says how the change is switched on: "On by default", "Off by default: set <key>", "Configuration" or "Host-only". Name a key only if the description names it.
- `evidence` is optional but recommended: `render.py` checks it is a verbatim sentence of the description, which catches notes written from the wrong PR or from memory.
- Upgrade notes come from the release notes' breaking-changes or upgrade-notes section by default. Add an `upgrade` entry only for the Unreleased lane, or for a release whose notes have no such section, and take every line from PR descriptions. Every line cites at least one PR.
- Write facts from the PRs and release notes only. Paraphrase rather than quote, and leave out anything you cannot verify.

The work splits cleanly by release. If your agent can run independent workers, give each one release's PRs and have it write `editorial.<tag>.json`; otherwise go release by release. Pass all the files to `render.py --editorial a.json b.json`.

## What render.py checks

It stops without writing the page when a PR appears twice or belongs to no release, an editorial entry names a PR outside the compared ranges, a theme is not in `themes`, a note names a config key (a backticked or dotted token) that is not in that PR's title or description, an `evidence` sentence is not in the description, an upgrade line cites no PR, or editorial text contains an em-dash. Commits without a PR number and PRs merged outside their release's dates are printed as warnings. Fix every error and run it again; do not edit the generated HTML.

The key check catches invented or misspelled keys, not inverted logic: read each `why` against its description once more before sharing.

## Share it

`release-map.html` has no external requests (system fonts, inline data and script), so it opens from disk, a static host, a gist preview or an attachment. Tell the person where the file is; publishing it is their call.

## Known limits

- A PR number in a commit title is trusted only when GitHub names that commit as the PR's merge commit or the PR merged inside the release's window, so numbers from a merged fork's own history are reported instead of mislabelled. Rebase merges, whose commits carry no PR number, are counted as unmapped.
- A PR record that GitHub no longer has falls back to commit data and links to the commit; a PR closed without merging, whose change landed as a direct commit, uses the commit date. The page footer counts both.
- Dates are UTC merge dates; a release's shipped date is its GitHub publication date.
