---
name: project_product_sync_2026_10_28
description: Shared files between Chewbacca and its products (anchored, usc-os) sync through tools/product_sync.py and chewbacca products, w a personal-data firewall; fix a shared file in Chewbacca, never only in the product
metadata:
  type: project
---

Chewbacca is the playground and is never sold. The products built out of it ship to other people: Anchored (churches) and USC OS (students). Since 2026-10-28 (d60d0671) every file two of them share lives once in Chewbacca, and each product keeps a copy in step through `tools/product_sync.py` (its own `sync.json` and `sync.lock.json`). `chewbacca products` shows who's behind, and `chewbacca products pull` pushes a product's main only when its tests pass. The registry is `config/products.json`, and the builders' names and accounts the firewall blocks are in `config/product-firewall.json`. How it works: docs/reference/PRODUCTS.md.

**Why:** Caleb, 2026-10-28: "they all stay up to date as something changes it needs to be a fire system since USCOS and Anchored are going to be for other ppl." The same day, anchored's copies of slop-check and code-slop had drifted 70+ lines from Chewbacca's, partly bc someone hand-scrubbed names out of the anchored copy while Chewbacca's still quoted people.

**How to apply:** Fix a shared file in Chewbacca, or `push` it from the product, never only in the product. A shared file has to be clean at the source: no names, accounts, home paths or phone numbers, even in comments, or the firewall holds it out of every product. A new product gets a `config/products.json` entry w a real test command, since that command is the only gate on auto-pushes. usc-os still runs its older `tools/sync`. The engine reads its manifest as-is, and moving it over is the USC OS tab's call.
