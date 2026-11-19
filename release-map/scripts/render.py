"""Validate collected.json plus optional editorial files and render one self-contained release-map HTML page.

Usage: render.py <workdir>/collected.json [--editorial FILE ...] [--out release-map.html]
Exits non-zero, without writing the page, when a check fails. Warnings are printed but do not block.
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "template.html"
CITE = re.compile(r"#(\d+)")
CODE = re.compile(r"`([^`]+)`")
DOTTED = re.compile(r"\b[a-z][a-z0-9_]*(?:\.[a-z0-9_*]+)+\b")


def looks_like_key(tok):
    """A dotted token worth checking: every segment is a word, not prose such as e.g or a version like v0.51."""
    parts = tok.split(".")
    return all(len(p) > 1 and not p.isdigit() and not p[0].isdigit() for p in parts) and not re.match(r"v\d", tok)
TYPES = {"feat", "fix", "perf", "refactor", "docs", "chore"}


def squash(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def merge_editorial(files):
    ed = {"themes": {}, "items": {}, "upgrade": {}, "lede": None}
    for f in files:
        try:
            d = json.loads(Path(f).read_text())
        except (OSError, json.JSONDecodeError) as e:
            sys.exit(f"{f}: cannot read editorial JSON ({e})")
        if not isinstance(d, dict) or not all(isinstance(it, dict) and isinstance(it.get("pr"), int)
                                               for it in d.get("items") or []):
            sys.exit(f"{f}: expected an object whose items each have an integer pr")
        ed["themes"].update(d.get("themes") or {})
        ed["upgrade"].update(d.get("upgrade") or {})
        ed["lede"] = d.get("lede") or ed["lede"]
        for it in d.get("items") or []:
            if it["pr"] in ed["items"]:
                sys.exit(f"#{it['pr']} appears in more than one editorial entry")
            ed["items"][it["pr"]] = it
    return ed


def fmt(d):
    d = datetime.date.fromisoformat(d)
    return f"{d.day} {d:%b %Y}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("collected")
    ap.add_argument("--editorial", nargs="*", default=[])
    ap.add_argument("--out", default="release-map.html")
    a = ap.parse_args()
    col = json.loads(Path(a.collected).read_text())
    bodies = Path(a.collected).parent / "bodies"
    ed = merge_editorial(a.editorial)
    errors, warnings = [], []
    rels = {r["tag"]: r for r in col["releases"]}
    items = {}

    for i in col["items"]:
        if i["pr"] in items:
            errors.append(f"#{i['pr']} is listed twice")
        items[i["pr"]] = i
        r = rels.get(i["rel"])
        if not r:
            errors.append(f"#{i['pr']} belongs to unknown release {i['rel']}")
        elif not (r["from"] <= i["date"] <= r["to"]):
            warnings.append(f"#{i['pr']} merged {i['date']}, outside {i['rel']} ({r['from']} to {r['to']})")
        if i["type"] not in TYPES:
            errors.append(f"#{i['pr']} has unknown type {i['type']}")
    unmapped = col.get("unmapped_commits", [])
    if unmapped:
        shown = "; ".join(f"{c['sha'][:9]} {c['title'][:50]}" for c in unmapped[:5])
        warnings.append(f"{len(unmapped)} commit(s) carry no PR number and are not listed, e.g. {shown}")

    def text_of(pr):
        p = bodies / f"{pr}.md"
        return squash((p.read_text() if p.exists() else "") + " " + items[pr]["title"])

    for pr, e in ed["items"].items():
        if pr not in items:
            errors.append(f"editorial #{pr} is not in any compared range")
            continue
        if ed["themes"] and e.get("theme") and e["theme"] not in ed["themes"]:
            errors.append(f"#{pr} uses theme {e['theme']!r}, which is not in themes")
        prose = " ".join(str(e.get(k) or "") for k in ("h", "why", "cfg"))
        if "—" in prose:
            errors.append(f"#{pr} note contains an em-dash")
        if e.get("why") and not e.get("h"):
            errors.append(f"#{pr} has a why but no headline")
        body = text_of(pr)
        if items[pr]["state"] == "MISSING":
            if e.get("h"):
                warnings.append(f"#{pr} has no PR body to check its note against")
            continue
        for tok in set(CODE.findall(prose)) | {t for t in DOTTED.findall(prose) if looks_like_key(t)}:
            if squash(tok) not in body and not tok.startswith("pr-agent"):
                errors.append(f"#{pr} note names {tok!r}, which is not in the PR title or description")
        if e.get("evidence") and squash(e["evidence"]) not in body:
            errors.append(f"#{pr} evidence is not a verbatim sentence of the PR description")

    for tag, r in rels.items():
        lines = ed["upgrade"].get(tag, r.get("upgrade") or [])
        r["upgrade"] = lines
        r["upgradeSource"] = "editorial" if tag in ed["upgrade"] else "release notes"
        for ln in lines:
            if "—" in ln and tag in ed["upgrade"]:
                errors.append(f"{tag} upgrade line contains an em-dash: {ln[:60]}")
            cited = [int(n) for n in CITE.findall(ln)]
            if not cited:  # editorial lines must cite a PR; a release's own notes are taken as published
                (errors if tag in ed["upgrade"] else warnings).append(f"{tag} upgrade line cites no PR: {ln[:80]}")
            for n in cited:
                if n not in items:
                    warnings.append(f"{tag} upgrade line cites #{n}, which is outside the compared ranges")

    for w in warnings:
        print("warning:", w)
    if errors:
        for e in errors:
            print("error:", e)
        sys.exit(f"{len(errors)} check(s) failed; the page was not written")

    out_items = []
    for pr, i in items.items():
        e = ed["items"].get(pr, {})
        o = {k: i[k] for k in ("pr", "rel", "date", "author", "type", "scope", "title")}
        o["theme"] = e.get("theme") or ""
        if e.get("h"):
            o["note"] = {"h": e["h"], "why": e.get("why", ""), "cfg": e.get("cfg", "")}
        if i["state"] == "MISSING":
            o["missing"], o["sha"] = True, i["sha"]
        if i.get("flag"):
            o["flag"] = i["flag"]
        out_items.append(o)

    latest = next(r for r in col["releases"] if not r["unreleased"])
    xs = [i for i in out_items if i["rel"] == latest["tag"]]
    lede = ed["lede"] or (
        f"{latest['tag']} shipped {fmt(latest['to'])} with {len(xs)} changes from "
        f"{len({i['author'] for i in xs})} contributors, {sum(i['type'] == 'feat' for i in xs)} of them features.")
    pending = [r for r in col["releases"] if r["unreleased"]]
    if pending and not ed["lede"]:
        n = sum(i["rel"] == "Unreleased" for i in out_items)
        lede += f" The default branch has {n} more changes since then that are not in a release yet."
    odd = sum(1 for i in col["items"] if i["state"] != "MERGED")
    meta = {
        "repo": col["repo"], "checked": col["generated"], "lede": lede, "themes": ed["themes"],
        "releases": [{k: r.get(k) for k in ("tag", "prev", "head", "from", "to", "unreleased", "upgrade",
                                            "upgradeSource")} for r in col["releases"]],
        "method": "One item per pull request merged in each compare range; release version-bump commits are left out. "
                  "Types come from the conventional-commit prefix of the title (ci, test, build and dependency changes "
                  "count as chore; titles without a prefix take a leading verb or a label). Themes and headlines are "
                  "an editorial grouping. Dates are UTC merge dates; shipped dates are release publication dates. "
                  "Draft and pre-releases are not counted."
                  + (f" {odd} item(s) were not merged through GitHub or no longer exist, and use commit data."
                     if odd else "")
                  + (f" {len(unmapped)} commit(s) without a PR number (branch commits of merged PRs, or direct "
                     "pushes) are not listed." if unmapped else ""),
    }
    # One pass, so text inside a PR title can never be taken for the other placeholder; escaping every "<"
    # keeps titles from closing the script element or opening a comment.
    payloads = {k: json.dumps(v, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
                for k, v in (("ITEMS", out_items), ("META", meta))}
    page = re.sub(r"/\*(ITEMS|META)\*/(?:\[\]|\{\})", lambda m: payloads[m.group(1)], TEMPLATE.read_text(), count=2)
    Path(a.out).write_text(page)
    notes = sum("note" in i for i in out_items)
    print(f"wrote {a.out}: {len(out_items)} changes, {notes} headlines, {len(warnings)} warning(s)")


if __name__ == "__main__":
    main()
