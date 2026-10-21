# Provenance

Folded sources and policy for keeping history honest.

## Fold snapshot (2026-08-02)

| Domain path | Source GitHub repo | SHA | Tag / note |
| ----------- | ------------------ | --- | ---------- |
| `ventures/` | `amber-organization/amber-ventures` (pre-fold tree) | from `main` @ fold | Lifted earlier from `medha-platform@fdff212` |
| `domains/peoplerank/` | `amber-organization/peoplerank-sandbox` | `ddb3117` | Algorithm + DNC |
| `domains/messaging/messages2/` | `amber-organization/messages2` | `59be9b4` | tag `v0.2.0` |
| `domains/messaging/messages2kit/` | `amber-organization/messages2kit` | `c2d2a74` | tag `v0.1.0` |
| `domains/tizzy/` | `amber-organization/tizzy` | `b8e19c5` | IPA excluded |
| `domains/clearout/` | this repo history `social/clearout` | `04d361b` | restored 2026-08-03; no standalone GitHub repo |

Machine-readable copies live at:

- `domains/peoplerank/.provenance.json`
- `domains/messaging/.provenance.json`
- `domains/tizzy/.provenance.json`
- `domains/clearout/.provenance.json`
- `ventures/.provenance.json`

## Fold policy

1. **Copy, don't submodule** — sandbox must build/test without nested remotes.
2. **Exclude junk** — `.git`, `node_modules`, `.build`, `.next`, `*.ipa`,
   embedding caches, venvs.
3. **Sibling repos remain** — folding does not delete
   peoplerank-sandbox / messages2 / messages2kit / tizzy. Those remotes can
   stay as thin remotes or be archived later by humans.
4. **Future updates** — prefer developing *in* `domains/` going forward. If a
   sibling still receives commits, re-sync deliberately and bump `.provenance.json`.

## Exclusions

| Path | Why excluded |
| ---- | ------------ |
| `tizzy/mobile-app/Tizzy.ipa` | 17MB binary; rebuild via EAS |
| `peoplerank/.embeddings_cache` | Regenerable; API-key dependent |
| `clearout/supabase/.temp/` | Local Supabase CLI cache |
| All `node_modules` / `.next` / `.build` | Install locally per domain |

## Extraction log

Record promotions here when they happen:

| Date | From | To | Sandbox SHA | Notes |
| ---- | ---- | -- | ----------- | ----- |
| — | — | — | — | none yet |
