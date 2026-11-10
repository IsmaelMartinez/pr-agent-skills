---
name: pr-agent-local-review
description: "Use when running PR-Agent's own /review on a GitHub pull request from a local checkout with the coding agent itself (a subagent) answering PR-Agent's prompt instead of an API model: to preview the exact comment PR-Agent would post, to test a PR-Agent change against a real PR, or to publish a locally run, signed review on a PR you are allowed to comment on."
version: 1.2.0
author: The-PR-Agent community
license: MIT
---

# PR-Agent /review, run locally, with your agent as the model

PR-Agent accepts its model handler as a constructor argument (`PRAgent(ai_handler=...)`). `scripts/local_review.py` passes a file-backed handler: PR-Agent renders the prompt it would send, a subagent writes the answer to a file, and PR-Agent parses, renders and (only when asked) publishes it. No API key and no model bill. The PR-Agent code under test is whatever checkout you run the script from, which makes this a quick way to see how a PR-Agent change behaves on a real PR.

The point is fidelity. The comment must be what PR-Agent itself would produce from that answer, so the agent answering the prompt gets the prompt and nothing else, and the only change to the rendered comment is the signature line appended at the end. Do not give the answering agent the repository, extra context or review guidance of your own: that tests your agent, not PR-Agent.

## Prerequisites

- A PR-Agent checkout (a worktree of `main`, or the branch you are testing) and a virtualenv synced from its lockfile: `UV_PROJECT_ENVIRONMENT=<venv> uv sync --frozen`. Call `<venv>/bin/python` directly with `PYTHONPATH=.` from the checkout root; avoid `uv run` when several runs share one venv, because it re-syncs the editable install.
- A GitHub token in the environment, never in a file: `GITHUB__USER_TOKEN=$(gh auth token)`. The review is published under that token's account. Only the script needs it; keep it out of the answering agent's environment.
- GitHub only. The script reads the PR head through the GitHub provider.
- A clean environment. PR-Agent reads settings from environment variables (`PR_REVIEWER__EXTRA_INSTRUCTIONS` and the like), so anything exported in your shell changes the prompt.

A full run from the checkout root looks like this:

```bash
export GITHUB__USER_TOKEN=$(gh auth token)
S=<skill>/scripts/local_review.py; PY=<venv>/bin/python; PR=https://github.com/<owner>/<repo>/pull/<n>; W=/tmp/review/<n>
SIG="<sub>Run locally: pr-agent $(git log -1 --format=%h), <answering model> as the model, published by @<you>.</sub>"
PYTHONPATH=. $PY $S capture $PR $W
# a subagent writes $W/answer_0.yaml from $W/prompt_0.system.txt and $W/prompt_0.user.txt
PYTHONPATH=. $PY $S preview $PR $W "$SIG"
PYTHONPATH=. $PY $S publish $PR $W "$SIG"   # only after the preview is approved
```

## The four phases

Every phase exits non-zero when it did not complete, and prints why.

1. Capture writes `prompt_0.json`, plain-text copies `prompt_0.system.txt` and `prompt_0.user.txt`, and `meta.json` with the PR URL, head SHA and a hash of the prompt. Nothing is published. Each capture embeds fresh random boundary markers, so a re-capture always produces a new prompt; an existing `answer_0.yaml` is then moved aside as stale rather than replayed against a prompt it was not written for.
2. Answer: give one subagent the two text files and have it write `answer_0.yaml`. The prompt carries the PR's title, description and diff, which anyone can write, so run this agent without shell, network or credentials: its only tools read the two files and write the answer. Instructions that work: act as the model behind PR-Agent's /review; read only these two files; write only the YAML, exactly in the shape of the prompt's "Example output", no fences or commentary; follow the prompt's own rules on what counts as a key issue. The system prompt is long and largely shared across PRs, so after the first PR the agent can read just its tail (schema and example). The schema varies per PR (ticket compliance appears only when a ticket is linked), so answer the schema in the prompt in hand.
3. Preview replays the answer with publishing off and writes the exact comment to `preview.md`. It refuses if `meta.json` belongs to another PR, if any prompt file was edited, if the PR head moved, or if the prompt PR-Agent renders now differs from the captured one (an edited PR description, changed repository settings, new earlier findings, or a new day, since the prompt carries the date). It fails if PR-Agent could not parse the answer, and a stale `preview.md` never survives a failed run. Show `preview.md` to the person who will publish it.
4. Publish, only on their explicit yes, runs the same checks, needs a non-empty signature and a successful preview of this exact answer and signature, then replays with publishing on. Every comment PR-Agent tries to send is intercepted first: anything that differs from `preview.md` (ignoring the hidden markers below) or would exceed GitHub's size limit is refused before it is sent, and saved as `refused.md`. On success it prints the comment URL.

## What the script pins, and why

The target repository's `.pr_agent.toml` is applied per request, after anything set before `handle_request`, so the script pins these right after the repository settings load, where they hold:

- `config.publish_output` on only in publish mode.
- No progress comment, no effort or security labels, no inline key-issue comments, no failure comment, no "review updated" notice, no GitHub check run, no push outputs; persistent comment and finding-state modes on, so an update only ever edits the account's own earlier review. The review comment is then the only thing that touches the PR.
- A repository whose PR-Agent settings fail to load would normally get an error comment and a run with defaults; here nothing is posted and the phase fails.
- Large-PR chunking off, and exactly one model call. A PR too big for the token budget is reviewed from a pruned diff: PR-Agent lists the left-out files under "Additional files (insufficient token budget)" and adds a coverage note to the comment. Say so when you present the review, because it is partial.

Everything else comes from the target repository's settings, as it would in a real run: `extra_instructions`, `num_max_findings`, `require_*` sections and so on change the prompt exactly as they would for PR-Agent itself.

`config.model` defaults to a Claude id only so token counting and limits resolve; it is never called. A repository that sets `config.model` overrides it, as it would in a real run. Prompts match a real deployment as long as the effective model limits (`max_model_tokens`) match it.

## What publish adds that preview does not show

- Hidden HTML comments: an identity marker (`<!-- pr-agent:review:full -->`) and a review-state block with the findings as JSON, which PR-Agent reads on the next review.
- When it updates its own earlier comment, a `#### (Review updated until commit …)` header.

The pre-send check ignores exactly these. PR-Agent only reads review state, and only updates comments in place, when the comment was written by the same account, so a local run on a PR the hosted bot already reviewed posts a separate comment and starts with no previous findings. On a later local run the earlier local review's findings go into the prompt, as they would for the bot. The script reads that state read-only during capture and preview too, because PR-Agent itself only reads it when publishing is on.

## Signing

The signature is appended verbatim after the review, so readers can tell the comment came from a local run and which model answered. For example:

```
<sub>Run locally: pr-agent <short sha of the checkout>, <answering model> as the model, published by @<you>.</sub>
```

Read the SHA with `git log -1 --format=%h` at run time and name the model the subagent actually ran on.

## Running it across a queue

- Decide "already reviewed" by comments, not checks: a PR has a review when a comment contains "PR Reviewer Guide" (for your own runs, search for your signature). The `Run PR-Agent` check run is not a reliable signal.
- One workdir per PR under a shared root, created before the loop. Capture, preview and publish take a few seconds each and can run in a serial loop; answering is the slow part and parallelises well, several PRs per subagent.
- Ask the answering agents to page the text files with their file-reading tool; printing the JSON through a shell gets truncated.
- A strict prompt yields an empty `key_issues_to_review` on most PRs, and the comment then says "No major issues detected". That is PR-Agent's "only confident issues" rule, not a clean bill of health.
- A stacked PR (one that contains another open PR's diff) is reviewed against its own copy of that code, so its findings can disagree with the base PR's.
- Before publishing a batch, show a table (PR, findings, partial-budget flag) and the previews, then re-check each head: publish refuses a moved head, and the fix is to capture and answer again.
- An author can edit the PR description between capture and preview. Preview then refuses with a prompt-drift error even though the head has not moved. Capture again into the same workdir, which moves the old answer aside as stale, and answer the new prompt.
- Re-sync the virtualenv (`uv sync --frozen`) whenever the checkout's `uv.lock` changes before you capture, or the prompt is rendered by different dependencies than the checkout you sign with.
- When the hosted PR-Agent bot also reviews the repository, a local run adds a second "PR Reviewer Guide" comment beside the bot's, and the two do not share review state. Skip PRs the bot has already reviewed at the same head unless the point is a side-by-side comparison.

## Before publishing on someone else's PR

The comment posts under your account and is public: treat it like any public review you write, shown first and approved. For a demo or to test a PR-Agent change without touching the real PR, mirror it into a fork: push a base branch equal to upstream `main` and a head branch made with `git diff upstream/main...<pr-head> | git apply --index` (three dots; two dots would also revert everything `main` gained since the PR branched), open the PR there between those two branches, and leave upstream issue numbers unlinked so no cross-reference lands upstream.
