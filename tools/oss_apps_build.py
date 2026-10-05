#!/usr/bin/env python3
"""Rebuild config/data/oss-apps/apps.json from the two public catalogs it is made of.

  python3 tools/oss_apps_build.py              fetch, enrich, write
  python3 tools/oss_apps_build.py --offline    reuse the cache, fetch nothing
  python3 tools/oss_apps_build.py --no-github  skip license and star lookups
  python3 tools/oss_apps_build.py --refresh    refetch the 816 tool pages too

Sources, both CC0-1.0:
  serhii-londar/open-source-mac-os-apps   README is the catalog of Mac apps
  piotrkulpinski/open-source-alternatives README lists OpenAlternative's tools;
      each tool's page on openalternative.co carries the repository URL and
      the proprietary apps it replaces, which the README does not.

Licenses come from GitHub's own SPDX detection (one GraphQL call per 50
repos), never from a guess. Where GitHub cannot classify a LICENSE file it
says NOASSERTION, and so does this file. config/data/oss-apps/curated.json carries
the hand-read exceptions and the Mac apps neither catalog maps to a
proprietary product.

Network fetches are cached under ~/.cache/chewbacca/oss-apps (OSS_APPS_CACHE)
so a rebuild after a parser fix costs nothing. A plain run refetches the
READMEs and GitHub facts; tool pages refetch only with --refresh.
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "config" / "data" / "oss-apps"
OUT = DATA / "apps.json"
CURATED = DATA / "curated.json"
CACHE = Path(os.environ.get("OSS_APPS_CACHE", Path.home() / ".cache" / "chewbacca" / "oss-apps"))

MACOS_SOURCE = {
    "id": "open-source-mac-os-apps",
    "repo": "https://github.com/serhii-londar/open-source-mac-os-apps",
    "raw": "https://raw.githubusercontent.com/serhii-londar/open-source-mac-os-apps/master/README.md",
    "license": "CC0-1.0",
}
ALTS_SOURCE = {
    "id": "open-source-alternatives",
    "repo": "https://github.com/piotrkulpinski/open-source-alternatives",
    "raw": "https://raw.githubusercontent.com/piotrkulpinski/open-source-alternatives/main/README.md",
    "license": "CC0-1.0",
}
USER_AGENT = "chewbacca-oss-apps/1 (+https://github.com/calebnewtonusc/Chewbacca)"

# Permissive means a new product can be built on the code and shipped under
# any license, keeping only the notice. MPL-2.0 is in because the brief that
# set this list named it: its copyleft stops at the file, so new files are
# yours and edited MPL files stay MPL, which remix_caveat says out loud.
PERMISSIVE = {
    "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear",
    "0BSD", "ISC", "Unlicense", "Zlib", "BSL-1.0", "CC0-1.0", "MPL-2.0", "WTFPL",
}

# GraphQL aliases per query. Guessed, never measured: 50 kept all 30 batches
# of the 2026-10-04 build under GitHub's limits on the first try.
GRAPHQL_BATCH = 50
# The 2026-10-04 build fetched 816 openalternative.co pages at six workers in
# about four minutes with no 429. Higher was never tried.
OA_WORKERS = 6
# Guessed, never measured: the slowest 50-repo GraphQL batch on 2026-10-04
# returned in seconds, so two minutes only fires on a hung gh.
GH_TIMEOUT = 120


def log(msg):
    print(msg, file=sys.stderr)


class BuildError(Exception):
    """The build must stop rather than write a registry that is quietly wrong."""


def gh(args):
    """Run gh with a timeout. A hang returns None instead of stalling the build."""
    try:
        return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=GH_TIMEOUT)
    except subprocess.TimeoutExpired:
        log(f"gh {args[0]} {args[1] if len(args) > 1 else ''} timed out after {GH_TIMEOUT}s")
        return None


def usable_batch(data, size):
    """True when a GraphQL batch resolved at least one repo. An all-null batch
    is a rate limit or an auth failure, never 50 deleted repos, so caching it
    would freeze the failure in place."""
    return isinstance(data, dict) and any(data.get(f"r{i}") for i in range(size))


SAFE_PART = re.compile(r"[A-Za-z0-9._-]+")


def cache_path(*parts):
    """A path under CACHE built from fetched names, which are untrusted: a slug
    or repo name of "../../etc/x" or "/etc/passwd" must land inside the cache.
    Each part keeps only [A-Za-z0-9._-]; a part that had to change gets a hash
    of the original so two different names never share a file."""
    clean = []
    for part in parts:
        part = str(part)
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", part).strip(".") or "_"
        if safe != part:
            safe = f"{safe[:80]}-{hashlib.sha256(part.encode()).hexdigest()[:12]}"
        clean.append(safe)
    root = CACHE.resolve()
    path = root.joinpath(*clean).resolve()
    if not path.is_relative_to(root):
        raise BuildError(f"cache path escapes {root}: {parts!r}")
    return path


def fetch(url, cache_parts, offline, headers=None):
    """cache_parts is a tuple of path components, never a joined string, so a
    fetched name is always exactly one file name and cannot become a directory."""
    path = cache_path(*cache_parts)
    if path.is_file():
        return path.read_text(encoding="utf-8")
    if offline:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            return text
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
            time.sleep(2 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead, ConnectionError):
            time.sleep(2 * (attempt + 1))
    return None


def github_key(url):
    """owner/repo, lowercased, for a github.com URL; None for anything else."""
    m = re.match(r"https?://(?:www\.)?github\.com/([^/\s#?]+)/([^/\s#?]+)", url or "")
    if not m:
        return None
    owner, name = m.group(1), re.sub(r"\.git$", "", m.group(2))
    # GitHub names are [A-Za-z0-9._-] and never "." or "..". Anything else is
    # not a repo, and it would reach `gh api repos/<key>/...` as a path.
    if not all(SAFE_PART.fullmatch(p) and p.strip(".") for p in (owner, name)):
        return None
    return f"{owner}/{name}".lower()


def clean_category(heading):
    text = re.sub(r"\(\d+\)\s*$", "", heading).strip()
    # Drop the leading emoji the macOS README puts on every heading.
    return re.sub(r"^[^A-Za-z0-9]+", "", text).strip()


def parse_macos(md):
    entries = []
    top = sub = None
    current = None
    in_apps = False
    for line in md.splitlines():
        if line.startswith("## "):
            in_apps = line.strip() == "## Applications"
            continue
        if not in_apps:
            continue
        if line.startswith("### "):
            top, sub = clean_category(line[4:]), None
            continue
        if line.startswith("#### "):
            sub = clean_category(line[5:])
            continue
        m = re.match(r"^- \[(.+?)\]\((https?://[^\s)]+)\)\s*-?\s*(.*)$", line)
        if m:
            current = {
                "name": m.group(1).strip(),
                "url": m.group(2).rstrip("/"),
                "description": m.group(3).strip(),
                "category": f"{top} / {sub}" if sub else top,
                "languages": [],
                "website": None,
            }
            entries.append(current)
            continue
        if current and "**Languages:**" in line:
            current["languages"] = re.findall(r"title='([^']+)'", line)
        elif current and "**Website:**" in line:
            w = re.search(r"\]\((https?://[^)]+)\)", line)
            current["website"] = w.group(1) if w else None
    return entries


def parse_alts(md):
    entries = []
    top = sub = None
    started = False
    for line in md.splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            if title in ("Contributing", "Footnotes"):
                break
            started = started or title not in ("Sponsors", "Contents")
            top, sub = title, None
            continue
        if line.startswith("### "):
            sub = line[4:].strip()
            continue
        if not started:
            continue
        m = re.match(r"^- \[(.+?)\]\(https://openalternative\.co/([A-Za-z0-9._-]+)/?\)\s*-\s*(.*)$", line)
        if not m:
            continue
        rest = m.group(3)
        ticks = re.findall(r"`([^`]+)`", rest)
        license_name = next((t for t in ticks if not t.startswith("⭐")), None)
        entries.append({
            "name": m.group(1).strip(),
            "slug": m.group(2).strip("/"),
            "description": re.sub(r"\s*`[^`]*`", "", rest).strip(),
            "category": f"{top} / {sub}" if sub else top,
            "license": license_name,
        })
    return entries


def parse_oa_tool(payload, slug):
    """The tool object out of an openalternative.co RSC payload."""
    decoder = json.JSONDecoder()
    for m in re.finditer(r'"tool":\{"id"', payload):
        try:
            obj, _ = decoder.raw_decode(payload, m.start() + len('"tool":'))
        except ValueError:
            continue
        if obj.get("slug") == slug:
            return obj
    return None


def oa_enrich(slugs, offline):
    def one(slug):
        payload = fetch(f"https://openalternative.co/{slug}", ("openalternative", f"{slug}.rsc"),
                        offline, headers={"RSC": "1"})
        if payload is None:
            return slug, None
        tool = parse_oa_tool(payload, slug)
        if tool is None:
            return slug, None
        return slug, {
            "repository": tool.get("repositoryUrl") or None,
            "website": tool.get("websiteUrl") or None,
            "replaces": [a["name"] for a in tool.get("alternatives") or [] if a.get("name")],
            "stacks": [(s.get("slug") or "", s.get("type") or "") for s in tool.get("stacks") or []],
            "license": (tool.get("license") or {}).get("name"),
            "self_hosted": bool(tool.get("isSelfHosted")),
        }
    with ThreadPoolExecutor(OA_WORKERS) as pool:
        return dict(pool.map(one, slugs))


GRAPHQL_FIELDS = (
    "nameWithOwner url stargazerCount pushedAt isArchived "
    "licenseInfo{spdxId name} primaryLanguage{name} "
    "repositoryTopics(first:20){nodes{topic{name}}}"
)


def github_enrich(keys, offline):
    """GitHub facts per owner/repo key, cached as one JSON file per batch."""
    found = {}
    keys = sorted(keys)
    if not offline and not shutil.which("gh"):
        log("gh is not installed: licenses fall back to OpenAlternative's labels")
        offline = True
    for start in range(0, len(keys), GRAPHQL_BATCH):
        batch = keys[start:start + GRAPHQL_BATCH]
        cache = cache_path("github", re.sub(r"[^a-z0-9]+", "_", batch[0])[:60] + f"_{len(batch)}.json")
        data = None
        if cache.is_file():
            cached = json.loads(cache.read_text(encoding="utf-8"))
            if cached.get("keys") == batch:
                data = cached["data"]
        if data is None and not offline:
            parts = []
            for i, key in enumerate(batch):
                owner, name = key.split("/", 1)
                parts.append(f'r{i}: repository(owner:{json.dumps(owner)}, name:{json.dumps(name)}){{{GRAPHQL_FIELDS}}}')
            query = "{" + " ".join(parts) + "}"
            proc = gh(["api", "graphql", "-f", f"query={query}"])
            # A batch with one deleted repo still returns data for the rest,
            # alongside an errors array and a non-zero exit.
            try:
                data = json.loads(proc.stdout).get("data") or {} if proc else None
            except ValueError:
                data = None
            if not usable_batch(data, len(batch)):
                raise BuildError(f"GitHub batch at {start} resolved no repos "
                                 f"({(proc.stderr.strip() if proc else 'timeout')[:200]}); nothing written")
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"keys": batch, "data": data}), encoding="utf-8")
        if data is None:
            continue
        for i, key in enumerate(batch):
            node = data.get(f"r{i}")
            found[key] = node if node else {"missing": True}
    return found


# Title lines, checked in this order because the AGPL text cites the GPL and
# the LGPL text cites the GPL. A file matching two families is reported as
# mixed, never resolved by picking one.
LICENSE_SIGNATURES = [
    ("AGPL-3.0", r"GNU AFFERO GENERAL PUBLIC LICENSE"),
    ("LGPL-3.0", r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3"),
    ("LGPL-2.1", r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1"),
    ("GPL-3.0", r"GNU GENERAL PUBLIC LICENSE\s+Version 3"),
    ("GPL-2.0", r"GNU GENERAL PUBLIC LICENSE\s+Version 2"),
    ("Apache-2.0", r"Apache License,?\s+Version 2\.0"),
    ("MPL-2.0", r"Mozilla Public License,?\s+(?:v\.|version)\s*2\.0"),
    ("BUSL-1.1", r"Business Source License"),
    ("Elastic-2.0", r"Elastic License 2\.0"),
    ("SSPL-1.0", r"Server Side Public License"),
    ("FSL-1.1", r"Functional Source License"),
    ("PolyForm", r"PolyForm"),
    ("Sustainable-Use", r"Sustainable Use License"),
    ("MIT", r"Permission is hereby granted, free of charge"),
    ("BSD", r"Redistribution and use in source and binary forms"),
]
CARVE_OUT = re.compile(r"Portions of this software|Enterprise Edition|\bee/|Commons Clause|"
                       r"commercial license|is licensed under the license defined in", re.I)


def classify_license_text(text):
    """(license, open_core) from a LICENSE file GitHub would not classify."""
    head = text[:6000]
    hits = []
    for spdx, pattern in LICENSE_SIGNATURES:
        if re.search(pattern, head, re.I):
            if spdx.startswith(("GPL", "LGPL")) and any(h.startswith(("AGPL", "LGPL")) for h in hits):
                continue
            if spdx == "BSD":
                spdx = "BSD-3-Clause" if re.search(r"Neither the name", head, re.I) else "BSD-2-Clause"
            hits.append(spdx)
    open_core = bool(CARVE_OUT.search(head))
    if not hits:
        return None, open_core
    if len(hits) == 1:
        return hits[0], open_core
    if set(hits) <= {"MIT", "Apache-2.0"}:
        return "MIT OR Apache-2.0", open_core
    return "mixed: " + " + ".join(hits), open_core


def license_texts(keys, offline):
    """Root LICENSE text for repos GitHub marked NOASSERTION, cached per repo."""
    def one(key):
        path = cache_path("license", key.replace("/", "__") + ".txt")
        if path.is_file():
            return key, path.read_text(encoding="utf-8")
        if offline:
            return key, None
        proc = gh(["api", f"repos/{key}/license", "--jq", ".content"])
        if proc is None or proc.returncode != 0:
            return key, None
        text = base64.b64decode(proc.stdout.strip() or "").decode("utf-8", errors="replace")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return key, text
    with ThreadPoolExecutor(OA_WORKERS) as pool:
        return dict(pool.map(one, sorted(keys)))


def derive_stack(topics, language, mac_languages, oa_stacks, self_hosted):
    slugs = {s for s, _ in oa_stacks} | set(topics)
    has = lambda *names: any(n in slugs for n in names)
    if has("tauri", "tauri-app", "tauri2", "tauri-v2"):
        return "Tauri", "topics"
    if has("electron", "electron-app", "electronjs"):
        return "Electron", "topics"
    if has("flutter") or language == "Dart":
        return "Flutter", "topics" if has("flutter") else "language"
    if has("react-native"):
        return "React Native", "topics"
    if has("qt", "qt5", "qt6", "pyqt", "pyside"):
        return "Qt", "topics"
    langs = [language] if language else list(mac_languages)
    if "Swift" in langs:
        return "Swift (native)", "language"
    if "Objective-C" in langs:
        return "Objective-C (native)", "language"
    if self_hosted and language in {"TypeScript", "JavaScript", "Python", "Go", "Ruby", "PHP",
                                    "Elixir", "Java", "Kotlin", "C#", "Rust", "Vue", "Svelte"}:
        return "Web (self-hosted)", "openalternative"
    if langs:
        return langs[0], "language"
    return "unknown", "none"


def check_override(key, spdx, override):
    if spdx in ("NOASSERTION", override["license"]):
        return
    raise BuildError(f"{key}: curated.json says {override['license']} but GitHub now reports "
                     f"{spdx}. Reread the LICENSE and update or drop the override.")


def check_missing_jump(previous, current):
    """Stop when far more repos go missing than last build. Nine were missing
    on 2026-10-04; a jump to dozens is an API failure, not a wave of deletions."""
    if previous is not None and current > max(previous * 2, previous + 20):
        raise BuildError(f"{current} repos missing on GitHub, up from {previous}; nothing written")


def license_verdict(spdx):
    if all(part in PERMISSIVE for part in spdx.split(" OR ")):
        if spdx == "MPL-2.0":
            return False, "edited MPL files stay MPL; new files are yours"
        return True, None
    return False, None


def build(offline=False, use_github=True, refresh=False):
    if refresh:
        shutil.rmtree(CACHE, ignore_errors=True)
    elif not offline:
        # The READMEs and GitHub facts are cheap to refetch and go stale
        # (stars, licenses, renames). The 816 tool pages are not, so they stay
        # cached until --refresh.
        for name in ("macos.md", "alternatives.md"):
            (CACHE / name).unlink(missing_ok=True)
        shutil.rmtree(CACHE / "github", ignore_errors=True)
        shutil.rmtree(CACHE / "license", ignore_errors=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    macos_md = fetch(MACOS_SOURCE["raw"], ("macos.md",), offline)
    alts_md = fetch(ALTS_SOURCE["raw"], ("alternatives.md",), offline)
    if macos_md is None or alts_md is None:
        raise SystemExit("could not fetch a source README; nothing written")
    curated = json.loads(CURATED.read_text(encoding="utf-8"))

    mac = parse_macos(macos_md)
    alts = parse_alts(alts_md)
    log(f"parsed {len(mac)} macOS entries, {len(alts)} OpenAlternative rows")
    oa = oa_enrich(sorted({a["slug"] for a in alts}), offline)
    unresolved = sorted(s for s, v in oa.items() if v is None)

    apps = {}

    def record(key, name, url):
        if key not in apps:
            apps[key] = {"name": name, "repo": url, "categories": [], "replaces": [],
                         "languages": [], "sources": [], "description": None,
                         "website": None, "oa_license": None, "oa_stacks": [],
                         "self_hosted": False}
        return apps[key]

    for e in mac:
        key = github_key(e["url"]) or e["url"].lower()
        a = record(key, e["name"], e["url"])
        a["categories"].append(e["category"])
        a["languages"] = a["languages"] or e["languages"]
        a["description"] = a["description"] or e["description"]
        a["website"] = a["website"] or e["website"]
        a["sources"].append(MACOS_SOURCE["id"])

    for e in alts:
        info = oa.get(e["slug"]) or {}
        url = (info.get("repository") or f"https://openalternative.co/{e['slug']}").rstrip("/")
        key = github_key(url) or url.lower()
        a = record(key, e["name"], url)
        a["categories"].append(e["category"])
        a["description"] = a["description"] or e["description"]
        a["website"] = a["website"] or info.get("website")
        a["replaces"] += info.get("replaces", [])
        a["oa_license"] = a["oa_license"] or info.get("license") or e["license"]
        a["oa_stacks"] = a["oa_stacks"] or info.get("stacks", [])
        a["self_hosted"] = a["self_hosted"] or info.get("self_hosted", False)
        a["oa_slug"] = e["slug"]
        a["sources"].append(ALTS_SOURCE["id"])

    for item in curated["must_include"]:
        url = f"https://github.com/{item['repo']}"
        key = github_key(url)
        if key is None:
            raise BuildError(f"curated.json must_include has a repo that is not owner/name: {item['repo']!r}")
        a = record(key, item["name"], url)
        a["categories"].append(item["category"])
        a["sources"].append("curated")

    curated_replaces_unmatched = []
    for repo, names in curated["replaces"].items():
        if repo.lower() in apps:
            apps[repo.lower()]["replaces"] += names
        else:
            curated_replaces_unmatched.append(repo)

    gh = github_enrich([k for k in apps if "/" in k and not k.startswith("http")], offline) if use_github else {}

    noassert = [k for k, g in gh.items() if ((g or {}).get("licenseInfo") or {}).get("spdxId") == "NOASSERTION"]
    texts = license_texts(noassert, offline) if use_github else {}
    out = []
    overrides = curated.get("license_overrides", {})
    gh_data = bool(gh)
    for key, a in apps.items():
        g = gh.get(key) or {}
        missing = bool(g.get("missing"))
        topics = [n["topic"]["name"] for n in ((g.get("repositoryTopics") or {}).get("nodes") or [])]
        language = (g.get("primaryLanguage") or {}).get("name")
        spdx = (g.get("licenseInfo") or {}).get("spdxId") if g and not missing else None
        open_core_flag, guess = False, None
        if key in overrides:
            o = overrides[key]
            if gh_data:
                check_override(key, spdx, o)
            license_id, license_source, note = o["license"], "curated", o["note"]
            remixable, caveat, open_core_flag = o["remixable"], o["note"], True
        elif spdx == "NOASSERTION":
            # Zed's root LICENSE reads as Apache-2.0 by title while the editor
            # itself is GPL-3.0, and open-webui's reads as BSD-3-Clause with a
            # branding clause added. So a title match is recorded as a guess
            # and never makes anything remixable on its own.
            guess, open_core_flag = classify_license_text(texts.get(key) or "")
            license_id, license_source = "NOASSERTION", "github"
            note = ("open core: the root LICENSE carves directories out of its main license"
                    if open_core_flag else
                    "GitHub could not classify the root LICENSE; license_guess is a title match, read the file")
            remixable, caveat = False, "needs a person to read the LICENSE and record it in curated.json"
        elif spdx:
            license_id, license_source, note = spdx, "github", None
            remixable, caveat = license_verdict(spdx)
        elif g and not missing and "/" in key and not key.startswith("http"):
            license_id, license_source = "none", "github"
            note = "no LICENSE file detected: all rights reserved by default"
            remixable, caveat = False, None
        elif a["oa_license"]:
            license_id, license_source, note = a["oa_license"], "openalternative", "not verified against the repository"
            remixable, caveat = False, "label from OpenAlternative only; confirm in the repository before reuse"
        else:
            license_id, license_source, note = "unknown", "none", None
            remixable, caveat = False, None
        stack, stack_source = derive_stack(topics, language, a["languages"], a["oa_stacks"], a["self_hosted"])
        seen = set()
        replaces = [r for r in a["replaces"] if not (r.lower() in seen or seen.add(r.lower()))]
        out.append({
            "id": key,
            "name": a["name"],
            "repo": g.get("url") or a["repo"],
            "description": a["description"],
            "website": a["website"],
            "categories": list(dict.fromkeys(a["categories"])),
            "replaces": replaces,
            "stack": stack,
            "stack_source": stack_source,
            "language": language or (a["languages"][0] if a["languages"] else None),
            "license": license_id,
            "license_source": license_source,
            "license_note": note,
            "license_guess": guess,
            "remixable": remixable,
            "remixable_with_caveat": bool(not remixable and caveat and (
                license_id == "MPL-2.0" or (key in overrides and overrides[key].get("with_caveat")))),
            "remix_caveat": caveat,
            "open_core": open_core_flag or None,
            "stars": g.get("stargazerCount"),
            "pushed_at": g.get("pushedAt"),
            "archived": g.get("isArchived"),
            "github_missing": missing or None,
            "sources": list(dict.fromkeys(a["sources"])),
        })
    out.sort(key=lambda r: (-(r["stars"] or 0), r["name"].lower()))
    meta = {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "tools/oss_apps_build.py",
        "sources": [MACOS_SOURCE, ALTS_SOURCE, {"id": "curated", "file": "config/data/oss-apps/curated.json"}],
        "counts": {
            "apps": len(out),
            "remixable": sum(r["remixable"] for r in out),
            "remixable_with_caveat": sum(r["remixable_with_caveat"] for r in out),
            "with_replaces": sum(bool(r["replaces"]) for r in out),
            "license_unknown": sum(r["license"] in ("unknown", "NOASSERTION") for r in out),
            "macos_rows": len(mac),
            "openalternative_rows": len(alts),
        },
        "gaps": {
            "openalternative_pages_unresolved": unresolved,
            "github_repos_missing": sorted(r["id"] for r in out if r["github_missing"]),
            "curated_replaces_unmatched": curated_replaces_unmatched,
        },
        "remixable_rule": "true only for permissive SPDX ids GitHub detected: "
                          + ", ".join(sorted(PERMISSIVE - {"MPL-2.0"}))
                          + ". MPL-2.0 and hand-read open-core repos are remixable_with_caveat instead.",
    }
    return {"meta": meta, "apps": out}


def render(result):
    """One app per line. Indented JSON came to 47,094 lines on 2026-10-04,
    which would have tripled the repo's line count in tools/counts.py and made
    every rebuild diff unreadable; one line per app diffs per app."""
    rows = ",\n".join(json.dumps(app, ensure_ascii=False, separators=(",", ":")) for app in result["apps"])
    meta = json.dumps(result["meta"], ensure_ascii=False, indent=1)
    return '{"meta":' + meta + ',\n"apps":[\n' + rows + "\n]}\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--offline", action="store_true", help="use the cache only")
    parser.add_argument("--no-github", action="store_true", help="skip GitHub license lookups")
    parser.add_argument("--refresh", action="store_true", help="also refetch every openalternative.co page")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args(argv)
    degraded = args.no_github or (not args.offline and not shutil.which("gh"))
    if degraded and args.out.resolve() == OUT.resolve():
        log("refusing to overwrite config/data/oss-apps/apps.json without GitHub licenses "
            "(--no-github, or gh not installed). Pass --out to write elsewhere.")
        return 2
    previous = None
    if OUT.is_file():
        try:
            previous = len(json.loads(OUT.read_text(encoding="utf-8"))["meta"]["gaps"]["github_repos_missing"])
        except (ValueError, KeyError):
            previous = None
    try:
        result = build(offline=args.offline, use_github=not args.no_github, refresh=args.refresh)
        if not args.no_github:
            check_missing_jump(previous, len(result["meta"]["gaps"]["github_repos_missing"]))
    except BuildError as err:
        log(f"oss-apps build: {err}")
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(result), encoding="utf-8")
    print(json.dumps(result["meta"]["counts"]))
    gaps = result["meta"]["gaps"]
    for name, items in gaps.items():
        if items:
            log(f"{name}: {len(items)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
