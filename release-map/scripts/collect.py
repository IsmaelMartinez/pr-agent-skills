"""Collect every merged pull request between recent releases of a GitHub repository.

Writes <workdir>/collected.json (releases newest first, one item per PR) and <workdir>/bodies/<pr>.md
(the full PR description, for whoever writes headline notes). Needs only `gh` (authenticated) and Python 3.

Usage: collect.py [--repo OWNER/NAME] [--releases N] [--no-unreleased] [--workdir DIR]
"""
import argparse
import datetime
import json
import re
import subprocess
import sys
import time
from pathlib import Path

PR_IN_TITLE = re.compile(r"\(#(\d+)\)\s*$")
BUMP = re.compile(r"^chore\(release\):\s*bump version", re.IGNORECASE)
PREFIX = re.compile(r"^(\w+)(?:\(([^)]*)\))?(!)?:\s*")
TYPES = {"feat": "feat", "fix": "fix", "perf": "perf", "refactor": "refactor", "docs": "docs", "doc": "docs",
         "revert": "fix", "chore": "chore", "ci": "chore", "test": "chore", "tests": "chore", "build": "chore",
         "deps": "chore", "style": "chore"}
VERBS = {"add": "feat", "allow": "feat", "enable": "feat", "support": "feat", "fix": "fix", "redact": "fix",
         "prevent": "fix", "handle": "fix", "document": "docs", "bump": "chore", "update": "chore"}
LABELS = [("feature", "feat"), ("enhancement", "feat"), ("bug", "fix"), ("performance", "perf"),
          ("documentation", "docs"), ("refactoring", "refactor"), ("dependencies", "chore"), ("chore", "chore")]
UPGRADE_HEADING = re.compile(r"^#{2,3}\s.*(breaking|upgrade)", re.IGNORECASE)


def gh(*args, retries=3):
    for attempt in range(retries):
        r = subprocess.run(["gh", *args], check=False, capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout
        if attempt < retries - 1 and re.search(r"HTTP 5\d\d|secondary rate|timed out", r.stderr, re.IGNORECASE):
            time.sleep(2 ** attempt * 3)
            continue
        sys.exit(f"gh {' '.join(args[:3])} failed: {r.stderr.strip()}")


def releases(repo, count):
    rows = json.loads(gh("release", "list", "--repo", repo, "--limit", "100", "--exclude-drafts",
                         "--exclude-pre-releases", "--json", "tagName,publishedAt"))
    rows.sort(key=lambda r: r["publishedAt"], reverse=True)
    if len(rows) < count + 1:
        sys.exit(f"need {count + 1} published releases to compare {count}; found {len(rows)}")
    out = []
    for cur, prev in zip(rows[:count], rows[1:count + 1]):
        out.append({"tag": cur["tagName"], "prev": prev["tagName"], "from": prev["publishedAt"][:10],
                    "to": cur["publishedAt"][:10], "unreleased": False})
    return out


def compare(repo, base, head):
    jq = ".commits[] | [.sha, .commit.committer.date, (.author.login // .commit.author.name), " \
         "(.commit.message | split(\"\\n\")[0])] | @tsv"
    lines = gh("api", f"repos/{repo}/compare/{base}...{head}", "--paginate", "--jq", jq).splitlines()
    return [dict(zip(("sha", "date", "author", "title"), ln.split("\t", 3))) for ln in lines if ln]


def pr_metadata(repo, numbers):
    owner, name = repo.split("/")
    found = {}
    for k in range(0, len(numbers), 40):
        chunk = numbers[k:k + 40]
        fields = "number title state mergedAt author{login} labels(first:30){nodes{name}} body"
        query = "query{repository(owner:%s,name:%s){%s}}" % (json.dumps(owner), json.dumps(name), "".join(
            f"p{n}:pullRequest(number:{n}){{{fields}}}" for n in chunk))
        r = subprocess.run(["gh", "api", "graphql", "-f", f"query={query}"],
                           check=False, capture_output=True, text=True)
        try:
            data = json.loads(r.stdout or "{}").get("data") or {}
        except json.JSONDecodeError:
            sys.exit(f"GraphQL batch failed: {r.stderr.strip()}")
        for v in (data.get("repository") or {}).values():
            if v:
                found[v["number"]] = v
    return found


def upgrade_notes(repo, tag):
    """Bullets of the release notes' breaking-changes or upgrade-notes section, with links reduced to #NNNN."""
    body = json.loads(gh("release", "view", tag, "--repo", repo, "--json", "body"))["body"] or ""
    lines, inside = [], False
    for ln in body.splitlines():
        if ln.startswith("#"):
            inside = bool(UPGRADE_HEADING.match(ln))
            continue
        if inside and re.match(r"^\s*[-*]\s+", ln):
            text = re.sub(r"\[#(\d+)\]\([^)]*\)", r"#\1", re.sub(r"^\s*[-*]\s+", "", ln))
            text = re.sub(r"https://github\.com/[^\s)]+/pull/(\d+)", r"#\1", text)
            lines.append(text.strip())
    return lines


def classify(title, labels):
    m = PREFIX.match(title)
    if m and m.group(1).lower() in TYPES:
        return TYPES[m.group(1).lower()], (m.group(2) or "").strip().lower() or None, "prefix", bool(m.group(3))
    verb = (re.match(r"^(\w+)", title) or [None, ""])[1].lower()
    if verb in VERBS:
        return VERBS[verb], None, "verb", False
    lower = [lb.lower() for lb in labels]
    for lb, t in LABELS:
        if lb in lower:
            return t, None, "label", False
    return "chore", None, "default", False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo")
    ap.add_argument("--releases", type=int, default=3)
    ap.add_argument("--no-unreleased", action="store_true")
    ap.add_argument("--workdir", default="release-map-work")
    a = ap.parse_args()
    repo = a.repo or json.loads(gh("repo", "view", "--json", "nameWithOwner"))["nameWithOwner"]
    work = Path(a.workdir)
    (work / "bodies").mkdir(parents=True, exist_ok=True)
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

    rels = releases(repo, a.releases)
    for r in rels:
        r["upgrade"] = upgrade_notes(repo, r["tag"])
    if not a.no_unreleased:
        branch = json.loads(gh("repo", "view", repo, "--json", "defaultBranchRef"))["defaultBranchRef"]["name"]
        rels.insert(0, {"tag": "Unreleased", "prev": rels[0]["tag"], "head": branch, "from": rels[0]["to"],
                        "to": today, "unreleased": True, "upgrade": []})

    items, unmapped, seen = [], [], {}
    for r in rels:
        for c in compare(repo, r["prev"], r.get("head", r["tag"])):
            if BUMP.match(c["title"]):
                continue
            m = PR_IN_TITLE.search(c["title"])
            if not m:
                unmapped.append({"sha": c["sha"], "title": c["title"], "rel": r["tag"]})
                continue
            pr = int(m.group(1))
            if pr in seen:
                sys.exit(f"#{pr} appears in both {seen[pr]} and {r['tag']}; check the tag order")
            seen[pr] = r["tag"]
            items.append({"pr": pr, "rel": r["tag"], "sha": c["sha"], "commit_date": c["date"][:10],
                          "commit_author": c["author"], "commit_title": PR_IN_TITLE.sub("", c["title"]).strip()})
    if not items:
        sys.exit("no pull requests found in the compared ranges")

    meta = pr_metadata(repo, [i["pr"] for i in items])
    for i in items:
        p = meta.get(i["pr"])
        if p is None:
            i.update(state="MISSING", title=i["commit_title"], date=i["commit_date"], author=i["commit_author"],
                     labels=[], flag="The PR record is no longer available; details come from the commit.")
        else:
            i.update(state=p["state"], title=p["title"], author=(p["author"] or {}).get("login") or "ghost",
                     labels=[n["name"] for n in p["labels"]["nodes"]])
            if p["state"] == "MERGED" and p["mergedAt"]:
                i["date"] = p["mergedAt"][:10]
            else:
                i["date"] = i["commit_date"]
                i["flag"] = "The PR was not merged through GitHub; the change landed as a direct commit."
            (work / "bodies" / f"{i['pr']}.md").write_text(p["body"] or "")
        if "dependabot" in i["author"].lower():
            i["author"] = "Dependabot"
        i["type"], i["scope"], i["type_source"], i["breaking"] = classify(i["title"], i["labels"])
        if i["author"] == "Dependabot":
            i["type"], i["scope"] = "chore", i["scope"] or "deps"
        for k in ("commit_date", "commit_author", "commit_title"):
            i.pop(k)

    out = {"repo": repo, "generated": today, "releases": rels, "items": items, "unmapped_commits": unmapped}
    (work / "collected.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    for r in rels:
        n = sum(1 for i in items if i["rel"] == r["tag"])
        print(f"{r['tag']:>12}  {r['prev']}...{r.get('head', r['tag'])}  {n} PRs  {len(r['upgrade'])} upgrade notes")
    odd = [i for i in items if i["state"] != "MERGED"]
    print(f"{len(items)} PRs, {len(odd)} not merged through GitHub or missing, {len(unmapped)} commits without a PR")
    print(f"wrote {work / 'collected.json'} and {len(list((work / 'bodies').iterdir()))} bodies")


if __name__ == "__main__":
    main()
