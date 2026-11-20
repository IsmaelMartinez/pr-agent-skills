# PR-Agent skills

This repository holds skills for AI coding agents that work with [PR-Agent](https://github.com/The-PR-Agent/pr-agent). A skill is a folder with a `SKILL.md` file. The agent reads the file when a task matches the description in its front matter.

## Skills

| Skill | Use it when |
| --- | --- |
| [`pr-agent-maintainer`](pr-agent-maintainer/SKILL.md) | An agent helps a maintainer or reviewer work through issues and pull requests on The-PR-Agent/pr-agent. The agent tests each fix by running it, drafts short replies, and posts or merges only after the maintainer approves. |
| [`pr-agent-local-review`](pr-agent-local-review/SKILL.md) | An agent runs PR-Agent's own `/review` on a GitHub pull request from a local checkout, answering PR-Agent's prompt itself instead of an API model, to preview the exact comment, test a PR-Agent change, or publish a signed review after approval. |
| [`release-map`](release-map/SKILL.md) | A maintainer wants one shareable page after a release: every merged pull request across the last few releases and the default branch, upgrade notes first, headline changes in plain English, and a per-day chart. |

## Plugins

| Plugin | What it does |
| --- | --- |
| [`review-pair`](review-pair/README.md) | An optional Claude Code pane for `pr-agent-maintainer`: the items under review beside live GitHub state, one status line each. |

## Install a skill

Skills here follow the open [Agent Skills](https://agentskills.io) format, so any agent that supports it can use them. Clone the repository and copy the skill folder into the folder your agent loads skills from; its documentation names that folder.

```sh
git clone https://github.com/The-PR-Agent/skills.git pr-agent-skills
cp -r pr-agent-skills/pr-agent-maintainer <your agent's skills folder>/
```

In Claude Code you can install them as plugins instead:

```
/plugin install pr-agent-maintainer --marketplace The-PR-Agent/skills
/plugin install pr-agent-local-review --marketplace The-PR-Agent/skills
```

## Add a skill

1. Create a folder named after the skill, in lowercase words joined by hyphens.
2. Add a `SKILL.md` file to the folder. Start the file with YAML front matter that sets `name` to the folder name and `description` to the situations where an agent should use the skill.
3. Keep the skill agent-neutral, and cover every git provider PR-Agent supports or say which ones it covers. Link to PR-Agent's documentation instead of copying from it, so the skill does not drift when the docs change.
4. Add a row for the skill to the table in this README.
5. Open a pull request.
