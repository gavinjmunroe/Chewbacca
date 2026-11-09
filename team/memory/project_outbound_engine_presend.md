---
name: project_outbound_engine_presend
description: The pre-send gate is engine code (chewbacca gtme presend) with one receipt per client, client config is checked by gtme config check, and a golden check in zeutara-gtme proves a move changed nothing (10/13)
metadata:
  type: project
---

The outbound engine's pre-send gate is `chewbacca gtme presend --client <name>` (tools/gtme_presend.py). Each client's refused senders and firm limits come from its entry in `~/.chewbacca/gtm/clients.json`, and a full pass writes that client's own receipt under `~/.chewbacca/state/send-gate-receipts/`. `gtme-grade --verify` (what `chewbacca clay` runs before a START or add-leads) reads only the receipt of the client that owns the campaign's workspace. Until 2026-10-13 one shared receipt served every client, so a second client's pass would have unlocked the first client's launch for 12 hours. zeutara-gtme `scripts/pre_send_gate.py` is now a shim over it with the same command line.

`chewbacca gtme config check --client <name>` checks an entry against the contract (`gtme config fields`). The engine has no built-in Clay workspace: grade, ready and add-leads resolve it from the named client or `$CLAY_WORKSPACE_ID` and refuse otherwise.

**How to apply:** before landing a change to zeutara-gtme scripts or the kit's gtme tools, run `python3 scripts/golden_check.py --kit <your chewbacca checkout>` in zeutara-gtme. It replays the 10-12 week from frozen inputs offline and must read 0 of 44. A new client needs a full clients.json entry (including `sender_company` when the brand differs from the client name, and `client_slack`, which `gtme ready` requires). The weekly wave is still Zeutara-only (move 6 of ~/.chewbacca/overnight/d1013/REPORT-one-engine.md). Measured: a synthetic client went from config to READY in 2 min 52 s with no code edits, list by hand.
