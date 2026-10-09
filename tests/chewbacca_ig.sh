#!/usr/bin/env bash
# chewbacca ig shapes a post node from Instagram's posts query. Offline.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT/bin/chewbacca-ig" <<'PY'
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("ci", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("ci", l)); l.exec_module(m)
reel = m.shape({"code": "DaEK0", "taken_at": 1782511474, "caption": {"text": "GPT 5.6"}, "like_count": 1568,
                "media_type": 2, "product_type": "clips", "play_count": 40000})
photo = m.shape({"code": "Abc12", "caption": None, "media_type": 1})
ok = (reel["url"] == "https://www.instagram.com/p/DaEK0/" and reel["is_video"] and reel["views"] == 40000
      and reel["caption"] == "GPT 5.6" and not photo["is_video"] and photo["caption"] is None)
print("chewbacca ig ok" if ok else f"FAIL {reel} {photo}"); sys.exit(0 if ok else 1)
PY
