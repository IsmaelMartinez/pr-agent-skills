# review-pair

An optional Claude Code plugin for the [`pr-agent-maintainer`](../pr-agent-maintainer/SKILL.md) skill. When the skill shows the maintainer a draft, the plugin opens a pane beside the conversation with the item read live from GitHub: one status line per item (worst state first, then merge and draft), the exact draft text, and the repository's queue and open issues. It reads GitHub through `gh` and only opens links; it never posts, approves or merges.

It is Claude Code only and GitHub only. The skill works without it.

## Install

```sh
claude plugin marketplace add The-PR-Agent/skills
claude plugin install review-pair@pr-agent-skills
```

The pane needs `gh` signed in. It arms when the `pr-agent-maintainer` skill runs, or on `/review-pair`; `/review-pair off` turns it off for the session.

## Keys

`1`-`9` pick an item, `s` opens the rows behind the status line, `0` opens the item's detail, `o` opens it on GitHub, `r` refreshes, `q` and `i` show the queue and the issues, `a` opens the maintainers' board, `h` holds an item and `l` shows the legend.

## The board

For The-PR-Agent/pr-agent the queue can also show the maintainers' standing calls from a local copy of the board's `buckets.json` and `chase.json`. Set `REVIEW_PAIR_BOARD_DIR` to that folder to turn it on; without it the counts come from GitHub alone.

## Tests

```sh
claude plugin test review-pair
claude plugin validate review-pair
```
