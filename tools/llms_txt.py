#!/usr/bin/env python3
"""Make a site readable by AI agents: llms.txt plus a markdown twin of every page.

    llms-txt build <site_dir> --name NAME --summary TEXT [--base https://x.com] [--section dir=Title ...]
    llms-txt check <site_dir>

AI agency sites now ship /llms.txt and per-page markdown so ChatGPT, Claude and Perplexity
quote them correctly (aurapathai.com does, read 2026-11-03). `seo-check` already reports
whether a live site has one. This writes it from a built static site (any folder of .html
files, such as a Next.js `out/` export): llms.txt grouped by section, and `<page>.md` next to
each page holding its title, description and main text. `check` fails when a link in
llms.txt points at a file that isn't there or a page has no description, so the file can
never drift from the site the way a hand-written one does.
"""
import argparse
import html
import os
import re
import sys
from html.parser import HTMLParser

SKIP_DIRS = {"_next", "node_modules", ".git", "assets", "static"}
SKIP_PAGES = re.compile(r"(^|/)(404|500|_error|_not-found)(/index)?\.html$")


class _Page(HTMLParser):
    BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "tr", "section", "article", "br", "div"}
    DROP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "template"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.desc, self.out, self.drop, self.in_title = "", "", [], 0, False
        self.heading = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self.in_title = True
        elif tag == "meta" and (a.get("name") or a.get("property") or "").lower() in ("description", "og:description"):
            self.desc = self.desc or (a.get("content") or "").strip()
        if tag in self.DROP:
            self.drop += 1
        elif not self.drop and tag in self.BLOCK:
            self.out.append("\n")
            if tag in ("h1", "h2", "h3"):
                self.out.append("#" * int(tag[1]) + " ")
            elif tag == "li":
                self.out.append("- ")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.DROP and self.drop:
            self.drop -= 1

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.drop:
            self.out.append(data)

    def text(self):
        t = re.sub(r"[ \t]+", " ", "".join(self.out))
        lines = [ln.strip() for ln in t.split("\n")]
        lines = [ln for ln in lines if ln and ln not in ("-", "#", "##", "###")]
        return "\n\n".join(lines)


def read_page(path):
    p = _Page()
    with open(path, encoding="utf-8", errors="ignore") as f:
        p.feed(f.read())
    return {"title": html.unescape(p.title.strip()), "desc": html.unescape(p.desc), "body": p.text()}


def pages(site):
    for root, dirs, files in os.walk(site):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for f in sorted(files):
            if f.endswith(".html"):
                rel = os.path.relpath(os.path.join(root, f), site).replace(os.sep, "/")
                if not SKIP_PAGES.search(rel):
                    yield rel


def md_path(rel):
    """index.html -> index.md, about/index.html -> about/index.md, about.html -> about.md."""
    return rel[:-5] + ".md"


def url_for(rel, base):
    path = rel[:-len("index.html")] if rel.endswith("index.html") else rel[:-5]
    return (base.rstrip("/") + "/" + path).rstrip("/") or "/"


def build(site, name, summary, base="", sections=None):
    sections = sections or {}
    groups, missing_desc = {}, []
    for rel in pages(site):
        info = read_page(os.path.join(site, rel))
        md = md_path(rel)
        with open(os.path.join(site, md), "w") as f:
            head = f"# {info['title'] or rel}\n\n" + (f"> {info['desc']}\n\n" if info["desc"] else "")
            f.write(head + info["body"] + "\n")
        if not info["desc"]:
            missing_desc.append(rel)
        top = rel.split("/")[0] if "/" in rel else ""
        group = sections.get(top, top.replace("-", " ").capitalize() if top else "Pages")
        link = (base.rstrip("/") + "/" + md) if base else md
        label = re.split(r"\s+[|:]\s+", info["title"])[0] if info["title"] else rel
        groups.setdefault(group, []).append(f"- [{label}]({link})" + (f": {info['desc']}" if info["desc"] else ""))
    if not groups:
        print(f"llms-txt: no .html pages under {site}", file=sys.stderr)
        sys.exit(2)
    order = ["Pages"] + sorted(g for g in groups if g != "Pages")
    out = [f"# {name}", "", f"> {summary}", ""]
    for g in order:
        if g in groups:
            out += [f"## {g}", ""] + groups[g] + [""]
    with open(os.path.join(site, "llms.txt"), "w") as f:
        f.write("\n".join(out))
    return {"pages": sum(len(v) for v in groups.values()), "missing_description": missing_desc}


def check(site):
    path = os.path.join(site, "llms.txt")
    if not os.path.exists(path):
        return ["no llms.txt"]
    problems = []
    with open(path) as f:
        text = f.read()
    if not text.startswith("# "):
        problems.append("llms.txt must start with '# <name>'")
    for link in re.findall(r"\]\(([^)]+)\)", text):
        local = re.sub(r"^https?://[^/]+/", "", link)
        if not os.path.exists(os.path.join(site, local)):
            problems.append(f"broken link: {link}")
    for rel in pages(site):
        if not os.path.exists(os.path.join(site, md_path(rel))):
            problems.append(f"no markdown twin: {rel}")
        elif not read_page(os.path.join(site, rel))["desc"]:
            problems.append(f"no meta description: {rel}")
    return problems


def main(argv=None):
    p = argparse.ArgumentParser(prog="llms-txt", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("site"); b.add_argument("--name", required=True)
    b.add_argument("--summary", required=True); b.add_argument("--base", default="")
    b.add_argument("--section", action="append", default=[], help="dir=Title")
    c = sub.add_parser("check"); c.add_argument("site")
    a = p.parse_args(argv)
    if not os.path.isdir(a.site):
        print(f"llms-txt: {a.site} is not a folder", file=sys.stderr); return 2
    if a.cmd == "build":
        secs = dict(s.split("=", 1) for s in a.section if "=" in s)
        r = build(a.site, a.name, a.summary, a.base, secs)
        print(f"llms.txt: {r['pages']} pages, each with a .md twin")
        for m in r["missing_description"]:
            print(f"no meta description: {m}")
        return 0
    bad = check(a.site)
    for line in bad:
        print(line)
    if not bad:
        print("llms.txt ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
