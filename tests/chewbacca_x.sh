#!/usr/bin/env bash
# chewbacca x reads posts and the paging cursor out of an X timeline page.
# Offline: a trimmed real page shape, no account, no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT/bin/chewbacca-x" <<'PY'
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("cx", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("cx", l)); l.exec_module(m)
page = {"data": {"user": {"result": {"timeline": {"timeline": {"instructions": [{"entries": [
  {"content": {"itemContent": {"tweet_results": {"result": {"rest_id": "2", "views": {"count": "9"},
     "legacy": {"full_text": "short", "created_at": "Sat Sep 26", "favorite_count": 3},
     "note_tweet": {"note_tweet_results": {"result": {"text": "the long version"}}}}}}}},
  {"content": {"itemContent": {"tweet_results": {"result": {"rest_id": "1",
     "legacy": {"full_text": "older", "favorite_count": 1}}}}}},
  {"content": {"cursorType": "Bottom", "value": "CUR"}}]}]}}}}}}
found = {}
cur = m.walk(page, found)
ok = cur == "CUR" and found["2"]["text"] == "the long version" and found["1"]["text"] == "older" and found["2"]["views"] == "9"
empty = {}
ok = ok and m.walk({"data": {"instructions": [{"type": "TimelineClearCache"}]}}, empty) is None and not empty
print("chewbacca x ok" if ok else f"FAIL cursor={cur} found={found}"); sys.exit(0 if ok else 1)
PY
