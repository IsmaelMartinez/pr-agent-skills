---
name: pr-agent-maintainer
description: "Use when reviewing, triaging or replying to an issue or pull request on The-PR-Agent/pr-agent itself as one of its maintainers or reviewers: verify a fix by running it, draft a short reply for the maintainer to approve, and post or merge only on their word."
version: 1.1.0
author: The-PR-Agent community
license: MIT
---

# Maintaining PR-Agent

Use this skill when an agent helps a maintainer or reviewer of [PR-Agent](https://github.com/The-PR-Agent/pr-agent) work through the project's own issues and pull requests. Running PR-Agent on another repository is a different job.

The goal for any single item is a reply that is short, verified by running something rather than by reading something, and approved by the maintainer before it goes out.

## Ground rules

Nothing goes out without the maintainer's word. Never merge, approve, close, comment or push to a contributor's branch on your own: draft, show, and wait. A green pipeline is not permission to merge, and `--auto` is never used.

Approval covers exactly the text the maintainer saw. An instruction to review, look at or close something is not approval of the wording that goes with it: "close #123" approves the close, not the comment. A draft changed after they saw it, by a fact-check, a re-anchoring or a cut for length, is a new draft, so show it again. A message naming a subset ("post #123 and #456") approves that subset and nothing else in the table. When a message could mean more than one thing, ask rather than infer.

A security finding of your own never goes into a public issue or pull request. It goes to a private advisory, following `SECURITY.md`.

## Presenting drafts

Unless the maintainer prefers another shape, after a batch show one table first (item, action, confidence), then the drafts two at a time, easiest first: clean approve-and-merge items before anything that carries an ask. Keep a count of how many are left.

Head each draft with the action as something the maintainer can say yes to (approve and merge, COMMENT with two inline suggestions, close as duplicate, carry and merge, no reply owed), whether the contributor has to do anything, and a confidence from 0 to 10. Then one or two plain sentences of reasoning, then the exact text between clear delimiters, each inline comment shown against its `path:line`. The action line answers "do they need to change something or not?" before anyone has to ask.

Everything else is short too: the verdict, the one or two facts that decide it, and what the maintainer has to choose. Not a walkthrough of the probes.

## The process

### 1. Pull live state, and always pass the repo

Never work from memory or an earlier survey. Re-fetch the item before forming a view, because reviews land, authors force-push and other maintainers act between sessions.

Skip draft pull requests unless the maintainer names one, and skip anything assigned to or parked with another maintainer. An unassigned item that falls in another maintainer's usual area, such as a request to list a vendor in the docs, is routed to them by assignment rather than answered. Never write anything in a public draft that reads as blaming another maintainer for a delay.

Pass `--repo The-PR-Agent/pr-agent` on every `gh pr` and `gh issue` call (`gh api` takes the full path instead). If you work from a fork or a worktree of one, `gh` resolves the repository from the current directory, and pull request numbers collide silently between the fork and upstream. In zsh, quote any `gh api` path containing `?`, or `pulls?state=all` is read as a glob.

Two counting traps. The Search API lags on recent closes, so queue sizes and throughput come from `repos/The-PR-Agent/pr-agent/pulls?state=all`, paginated and counted locally. And filter bots with the GraphQL `__typename == "User"` test rather than a list of names, because new apps get installed.

A claim about a branch is not the branch. Descriptions and comments describe a scope the head may no longer match, in either direction, so diff the head and read `pulls/{n}/files` before accepting, repeating or arguing with any statement about what a pull request touches.

Re-read the head SHA when you post, not only when you start. A hunk header spanning the whole file (`@@ -1,370 +1,386 @@`) on a pull request whose point is a few lines usually means changed line endings; count `\r\n` against `\n` in the raw blob before calling it a rewrite.

### 2. Verify the fix by reverting it, not by reading it

This is the core move. Merge the branch onto today's `main` in a scratch worktree, run the full suite and record the count. Then restore only the source files the pull request touches with `git checkout upstream/main -- <paths>` (`upstream` being your remote for The-PR-Agent/pr-agent; delete any source file the pull request adds), leaving its new tests in place, and re-run just those tests.

Red means the bug is real and the test covers it. Green means either `main` already fixes it or the test does not exercise the change, so find out which before replying. Never simulate the old behaviour by hand-editing source, which proves something about your edit rather than about `main`. A collection error counts as red, since the test imports something only the branch has.

Compare against the merged tree, never the raw branch. A pull request months behind `main` carries stale copies of every file it touches, so reading the branch's copy credits it with reverting everything merged since. Use `git merge-tree --write-tree upstream/main <branch>` and confirm the merged file differs from `main` by exactly the diff.

A suite pass is not corroboration: run it on `main` too, because equal counts on both sides mean no existing test covers the change. Nor is a local pass CI: a fork pull request whose runs sit at `action_required` has run nothing until a maintainer approves the workflows.

Before a failing test becomes a finding, rule out your environment. Run tests the way `AGENTS.md` says (`PYTHONPATH=. uv run pytest ...`), which syncs to `uv.lock`; a virtualenv that drifted from the lock has produced fake "missing symbol" defects. Then ask what about the host could be responsible, since a local timing difference has made a sleep-based test fail that CI passed. Green CI on the same commit is the clue, and swapping the suspect primitive is the proof.

Then try to break the fix, not just confirm it: feed the new logic edge inputs (empty, `None`, a string where a bool is expected, very large input), and grep the codebase for the same pattern the pull request fixes, since a sibling site it missed is often the most useful thing a review can add.

Where the tests touch an optional dependency group (qdrant, pinecone, lancedb, pandas), confirm they ran rather than skipped (`pytest -rs`): only the dev group installs in CI, so an import-guarded test can pass by never running. Where a claim is about a library's API, install the version `uv.lock` pins into a scratch target and call it.

Never let two agents share one worktree; they silently measure each other's checkout.

### 3. Run what the pull request exists to produce

A green suite says the code imports and does not crash, not that the thing the pull request was written for appears.

Where the payoff is a log line, trigger it and read the output. PR-Agent logs through loguru, which formats with `str.format` and not `%`, so `get_logger().warning("dropped %d files: %s", n, paths)` prints the template verbatim and drops both arguments.

### 4. Look for the smaller fix

Once the fix is proven real, ask whether it could be much smaller: reuse an existing helper, widen one condition instead of adding a branch, delete rather than wrap. If a version under roughly half the lines passes the same tests, offer it as a committable suggestion with the line count. If the larger shape is genuinely needed, say why in one line so the next reviewer does not relitigate it. Moving code around is not simplification; the test is fewer lines or fewer concepts for the same behaviour.

A performance pull request earns a merge only with a measured saving on a realistic input and a differential test showing the old and new code give identical results over many generated inputs. Check the premise against the API's documentation too: one such pull request reversed GitLab note order because it misread the endpoint's default sort.

### 5. Time every new regular expression

The absence of a nested quantifier is not a safety proof: overlapping alternatives under one quantifier can still go exponential, and adjacent quantifiers polynomial. Watch especially for two unbounded quantifiers over the same character class on either side of an optional group, as in `[ \t]*(?:yaml|yml)?[ \t]*`. Measure by doubling an adversarial input (a long run of the matching class with no closing delimiter): roughly 2x per doubling is linear, roughly 4x quadratic. On #2622 the pattern as pushed took about 4.4 s on a 32k input, dropping the `$` that CodeQL flagged still grew 4x per doubling, and moving the second quantifier inside the optional group, `(?:(?:yaml|yml)[ \t]*)?`, brought it to about 0.5 ms. Prove a rewrite matches the original on real inputs before suggesting it.

### 6. One fresh interpreter per settings probe

Settings are process-global, so a value one case sets is still there for the next. Dynaconf merging is off (`merge_enabled` is `False` in `pr_agent/config_loader.py`), so a section-level `set()` replaces the whole section and a partial dict drops the section's other keys. Whenever a probe touches `get_settings()`, run each case in its own interpreter, driven by a small parent script.

### 7. Read the bot reviews and the history before drafting

Bots comment on most pull requests, on the same page the contributor reads: the project's own PR-Agent workflow reviews every non-draft pull request a person opens, and Copilot or CodeQL reviews appear on some. List their findings and state before writing, credit them for what they found, add only what is yours, and never approve over a live finding without saying why. A finding you judge to be a false positive still gets a sentence. Check that no other human review has landed since you started.

Search the open queue for the function name, not only the linked issue: two pull requests can fix the same line without either mentioning the other. The older one's author has the prior claim and is owed the reply first.

Decide security relevance for every item. A security fix filed publicly gets one factual line pointing at the private reporting route in `SECURITY.md`, without scolding.

### 8. Draft, try to break the draft, then show it

Read the whole thread first and work out whether this is a first comment or a follow-up. Never publicly correct a claim the contributor never saw, and do not re-explain what they already wrote.

Open with thanks for what they actually did, worded differently each time, and check that they supplied it, since a root cause may have come from an earlier issue. Apologise for a genuinely long wait and put it on the maintainers.

Length is a defect with a number on it. A clean approve-and-merge is one sentence ("Thanks for picking this up, approving and merging."). Anything else aims at about 80 words and needs a reason to pass 120. Lead with the verdict. Say that you checked and what held, never how. Delete every sentence that would not change what the contributor does next.

Inline by default, and the suggestion is the comment. Every point that names a file and line goes on that line, and where the fix is code it is a `suggestion` block with one sentence of why. The body holds only what cannot be anchored: thanks, the verdict, a judgement about scope. GitHub rejects the whole review with `422 Line could not be resolved` when one anchor falls outside the diff, so map anchors from the hunk headers. Apply each suggestion to a scratch copy at the head and run it, since it is applied verbatim, and grep for sibling sites of your own suggestion as you would for the contributor's fix: a suggestion that covers one path out of three gets committed as is.

Then try to break it. Hand the draft to a second agent briefed to find errors rather than agree, with a numbered list of its claims and the one you are least sure of flagged, and ask for CORRECT, WRONG or OVERSTATED per claim with file and line evidence. Repeat until a pass finds nothing material, at most three passes; after that, show the maintainer what is still open. Then walk its findings against the revised draft one by one, run anything the draft asserts about `main` or the repository's settings, and reproduce each correction before acting on it; the checker is not an oracle.

### 9. Post through a guard that re-checks live state

Post with a script that checks each item before it writes: still open, the expected author, and the head SHA you reviewed, passed as the review's `commit_id`. Refuse to post if anything moved.

A review that carries a suggestion or an ask is `COMMENT` or `REQUEST_CHANGES`, never an approval. A real nit is left out so the approval stays clean. Word the body to match the event: a `COMMENT` that opens "Changes requested:" contradicts its own badge.

Default to a pending review: omit `event` from `POST /repos/The-PR-Agent/pr-agent/pulls/{n}/reviews` and the review stays `PENDING`, visible only to its author and rendered as the contributor will see it, marked Pending. Create it with the maintainer's own token, and check they have no pending review on that pull request already, since GitHub allows one per user. They read it in place and submit it; submit directly only when told to. Afterwards re-read each pull request's reviews to confirm every one was submitted.

On a follow-up, check old suggestion threads first. A rebase can remap an unresolved suggestion onto lines it was never about, so read `reviewThreads { isResolved isOutdated startLine line }` at the current head and resolve any whose range drifted. Verify pending anchors through GraphQL (`pullRequest.reviews.nodes.comments { path line startLine }`).

An "LGTM" posted as an ordinary comment approves nothing, and `reviewDecision` is not enough on its own either: a Copilot `APPROVED` review turns it to `APPROVED` with no human approval. Read the approving reviews and confirm one comes from a `User` with write access.

### 10. Merging

`gh pr merge <n> --repo The-PR-Agent/pr-agent --squash` is the whole command. The repository merges by squash only, with the pull request title as the commit title and a blank body, so the description never becomes the commit message and nobody needs to rewrite it on those grounds. Head branches in this repository are deleted on merge; fork branches are not. GitHub counts a Copilot `APPROVED` review towards the required approval, so call nothing approved until a person with write access has approved it, checking `collaborators/{user}/permission` for each approving `User`. A maintainer cannot approve their own pull request; request a reviewer instead.

A workflow-file change in a fork pull request only runs if the workflow triggers on `pull_request`; under `pull_request_target` GitHub runs `main`'s copy, so the change takes effect only after merge. Changes to workflow definitions still need a maintainer's explicit go-ahead.

Before merging a batch, test the batch, because two pull requests each green on their own can break `main` together. Merge every approved head into one scratch worktree at today's `main`, run the full suite, and check the count equals the baseline plus each pull request's own delta; a shortfall is a semantic conflict. Merge in dependency order, then confirm with `gh run list --repo The-PR-Agent/pr-agent --branch main --event push --workflow Build-and-test` (without `--event push`, a fork's pull request from a branch named `main` shows up). If `main` goes red, stop merging and open a focused fix or revert pull request. Right after a merge GitHub reports `mergeable: UNKNOWN` for a while; run `git merge-tree` and the touched tests rather than waiting.

### 11. Carry rather than ask, once the ask is small or the author is gone

When what is left is small or mechanical, or the author has been quiet for about two weeks, finish it rather than sending another round, with a one-line note such as "pushed the last fix, thanks, merging". With competing pull requests for one fix, take the first and credit the later authors with `Co-authored-by` trailers.

Check `maintainer_can_modify` and the fork's owner type first, because GitHub does not offer maintainer edits on organisation-owned forks. Update the branch by merging `main` into it, never by rebasing, and apply only what the review asked for. Some contributors are automated accounts that never reply; review their pull requests on the merits and carry rather than nudge.

### 12. Who owes the next move is a judgement, not a timestamp

Fold four event kinds into one timeline per item, because an answer can arrive as any of them: issue comments, reviews, review-thread comments, and pushes by the author. Drop bots by `__typename`, then read what the last event says. A contributor whose last word is "will check and come back" holds the ball; a maintainer who spoke last while waiting on a gated workflow that has since passed owes the move. Keep "they answered and nobody came back" apart from "nobody has ever replied".

## Sweeping the queue with subagents

When a check of the queue, scheduled or by hand, finds an item that needs a look (a non-draft pull request nobody has replied to, a new pull request or issue, an author push or reply since the last review, or a parked item whose blocker has moved), start the review subagents straight away rather than reporting the item and waiting. They only research and draft; the table and drafts still go to the maintainer, and nothing posts or merges without their word.

For a sweep, give each subagent two or three items and its own worktree, today's baseline suite count, the instruction to run tests through `uv run`, the presentation format above, and the rule that it posts nothing. Every draft that comes back gets the adversarial pass of step 8 before the maintainer sees it, and the table says that it ran. Drafts age while agents run: re-fetch every head and mergeable state at the moment you post, re-run cheap load-bearing measurements yourself, and re-read each draft against what earlier items in the same batch merged or closed.

## Project direction

Until v1 the focus is bug fixes and work aligned with what exists ([Discussion #3147](https://github.com/The-PR-Agent/pr-agent/discussions/3147)). Pull requests outside that line, such as ones adding a model call or a second pass, are parked with the `do not merge yet` label however good the engineering, and the review says the hold is about direction, not the code. Tool calling and MCP wait for the runtime that discussion is settling.
