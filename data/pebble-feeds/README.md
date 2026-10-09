# Pebble feed list: not copied, license blocks it

Checked 2026-10-09 against github.com/goodnight000/Pebble (commit 3364a8d).

## Status

Pebble has no LICENSE file. Its README ends with "This is proprietary software.
All rights reserved." and `ai_news/pyproject.toml` says `UNLICENSED`. Every other
Charles Zheng repo with a license is MIT, so this is the exception, and the kit
copies nothing from it: no code, no `config_sources.yml`, no URL list.

The feed list is real and large, which is why this note exists. Facts about it:

- `ai_news/app/config_sources.yml` defines 1,011 sources (26 marked `enabled: false`).
- 870 are RSS, 127 are sitemaps, and 14 are single connectors: arxiv (3), twitter,
  semantic_scholar, reddit, nvd, mastodon, hn, hf_papers, github_trending, github,
  congress, bluesky.
- Each source carries `authority` (0.0 to 1.0), `always_scrape`, `priority_poll`
  and `enabled`. The authority number is the author's judgment, so it is part of
  what is protected.
- `docs/disabled-sources.md` there lists feeds that 403 non-browser user agents.
  That is useful as a warning that bot-blocked publishers need a browser UA.

## What to do instead

1. Ask Charles for permission to reuse the list (Caleb has the
   whole profile listed in docs/LINKS-FROM-CALEB.md). A one-line "MIT the feed
   list?" is enough. If he agrees, drop the URL list in this folder as
   `feeds.csv` (name, kind, url, category) and credit him here.
2. Or rebuild a smaller list from public sources the kit already trusts. The
   method in Pebble's `scripts/discover-feeds.py` and `validate-sources.py` is the
   part worth imitating: probe each publisher for `/feed`, `/rss`, `/atom.xml` and
   `<link rel="alternate">`, fetch each candidate with a real browser UA, and keep
   only feeds that actually parse. (Pebble's scripts probe common paths such as
   /feed, /rss.xml and /atom.xml; the freshness cutoff is the kit's own addition.)

Ideas (not code) worth keeping, paraphrased from `docs/algorithm-design.md`, are
recorded in [docs/mined/goodnight000-verdicts.md](../../docs/mined/goodnight000-verdicts.md).
Nothing here is a copy of Pebble material.
