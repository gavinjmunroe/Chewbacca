# The systems

`64` machine-readable design systems extracted from real products, indexed so a
generator can pick one without reading 40,000 lines. Source corpus is
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(MIT), vendored under `systems/`.

**Read this file, pick a row, then read only that row's `DESIGN.md`.** Loading
more than one full system is how a page ends up looking like an average of all
of them, which is the generated look.

**The `forbids` column is the one that matters.** A brand is recognizable
because of what it refuses. Bugatti has no accent colour, no radius between 0
and a pill, and no display weight above 400, and those three refusals are most
of what makes a page read as Bugatti instead of as every other generated page.
Rows are sorted by how much they refuse.

| system | mode | canvas | accent | radius | max weight | refuses |
|---|---|---|---|---|---|---|
| [bugatti](systems/bugatti/DESIGN.md) | dark | `#000000` | **none** | sharp | 400 | no accent color, monochrome only; no rounded corners, 0px or pill only; display type never bolder than 400; wide display tracking up to 6px |
| [claude](systems/claude/DESIGN.md) | light | `#faf9f5` | `#cc785c` | soft | 500 | no gradients; display type never bolder than 500 |
| [wired](systems/wired/DESIGN.md) | light | `#ffffff` | **none** | sharp | 700 | no accent color, monochrome only; no rounded corners, 0px or pill only |
| [airbnb](systems/airbnb/DESIGN.md) | light | `#ffffff` | `#ff385c` | round | 700 | no gradients |
| [bmw](systems/bmw/DESIGN.md) | light | `#ffffff` | `#1c69d4` | soft | 700 | no gradients |
| [cal](systems/cal/DESIGN.md) | light | `#ffffff` | `#3b82f6` | soft | 600 | no gradients |
| [cohere](systems/cohere/DESIGN.md) | light | `#ffffff` | `#003c33` | round | 500 | display type never bolder than 500 |
| [coinbase](systems/coinbase/DESIGN.md) | light | `#ffffff` | `#0052ff` | round | 700 | no gradients |
| [cursor](systems/cursor/DESIGN.md) | light | `#f7f7f4` | `#f54e00` | soft | 600 | no gradients |
| [dell-1996](systems/dell-1996/DESIGN.md) | light | `#ffffff` | `#e91d2a` | sharp | 900 | no rounded corners, 0px or pill only |
| [hp](systems/hp/DESIGN.md) | light | `#ffffff` | `#024ad8` | soft | 700 | no gradients |
| [intercom](systems/intercom/DESIGN.md) | light | `#f5f1ec` | `#0007cb` | round | 500 | display type never bolder than 500 |
| [meta](systems/meta/DESIGN.md) | light | `#ffffff` | `#0064e0` | round | 700 | no gradients |
| [miro](systems/miro/DESIGN.md) | light | `#ffffff` | `#fbd4d4` | round | 600 | no gradients |
| [nike](systems/nike/DESIGN.md) | light | `#ffffff` | `#0a7281` | round | 500 | display type never bolder than 500 |
| [notion](systems/notion/DESIGN.md) | light | `#ffffff` | `#5645d4` | round | 600 | no gradients |
| [pinterest](systems/pinterest/DESIGN.md) | light | `#ffffff` | `#e60023` | round | 700 | no gradients |
| [sentry](systems/sentry/DESIGN.md) | ? | `?` | `#150f23` | round | 700 | no gradients |
| [shopify](systems/shopify/DESIGN.md) | ? | `?` | `#c1fbd4` | round | 550 | wide display tracking up to 2.4px |
| [stripe](systems/stripe/DESIGN.md) | light | `#ffffff` | `#533afd` | soft | 400 | display type never bolder than 400 |
| [supabase](systems/supabase/DESIGN.md) | light | `#ffffff` | `#3ecf8e` | soft | 500 | display type never bolder than 500 |
| [together.ai](systems/together.ai/DESIGN.md) | light | `#ffffff` | `#c8f6f9` | tight | 500 | display type never bolder than 500 |
| [uber](systems/uber/DESIGN.md) | light | `#ffffff` | **none** | round | 700 | no accent color, monochrome only |
| [voltagent](systems/voltagent/DESIGN.md) | dark | `#101010` | `#00d992` | tight | 700 | wide display tracking up to 2.52px |
| [warp](systems/warp/DESIGN.md) | dark | `#2b2622` | `#f7f5f0` | tight | 500 | display type never bolder than 500 |
| [webflow](systems/webflow/DESIGN.md) | light | `#ffffff` | `#ee1d36` | tight | 600 | no gradients |
| [wise](systems/wise/DESIGN.md) | light | `#ffffff` | `#9fe870` | round | 900 | no gradients |
| [x.ai](systems/x.ai/DESIGN.md) | dark | `#0a0a0a` | `#7c3aed` | tight | 400 | display type never bolder than 400 |
| [zapier](systems/zapier/DESIGN.md) | light | `#fffefb` | `#ff4f00` | soft | 700 | no gradients |
| [airtable](systems/airtable/DESIGN.md) | light | `#ffffff` | `#0d1218` | soft | 600 | (nothing distinctive) |
| [apple](systems/apple/DESIGN.md) | light | `#ffffff` | `#0066cc` | round | 600 | (nothing distinctive) |
| [binance](systems/binance/DESIGN.md) | ? | `?` | `#fcd535` | soft | 700 | (nothing distinctive) |
| [bmw-m](systems/bmw-m/DESIGN.md) | dark | `#000000` | `#0066b1` | tight | 700 | (nothing distinctive) |
| [clay](systems/clay/DESIGN.md) | light | `#fffaf0` | `#1a3a3a` | round | 600 | (nothing distinctive) |
| [clickhouse](systems/clickhouse/DESIGN.md) | dark | `#0a0a0a` | `#faff69` | soft | 700 | (nothing distinctive) |
| [composio](systems/composio/DESIGN.md) | dark | `#0f0f0f` | `#0007cd` | soft | 600 | (nothing distinctive) |
| [elevenlabs](systems/elevenlabs/DESIGN.md) | light | `#f5f5f5` | `#f4c5a8` | round | 600 | (nothing distinctive) |
| [expo](systems/expo/DESIGN.md) | light | `#ffffff` | `#8145b5` | round | 600 | (nothing distinctive) |
| [ferrari](systems/ferrari/DESIGN.md) | dark | `#181818` | `#da291c` | soft | 700 | (nothing distinctive) |
| [figma](systems/figma/DESIGN.md) | light | `#ffffff` | `#ff3d8b` | round | 700 | (nothing distinctive) |
| [framer](systems/framer/DESIGN.md) | dark | `#090909` | `#0099ff` | round | 700 | (nothing distinctive) |
| [hashicorp](systems/hashicorp/DESIGN.md) | dark | `#000000` | `#2b89ff` | round | 700 | (nothing distinctive) |
| [ibm](systems/ibm/DESIGN.md) | light | `#ffffff` | `#0f62fe` | tight | 600 | (nothing distinctive) |
| [linear.app](systems/linear.app/DESIGN.md) | dark | `#010102` | `#5e6ad2` | round | 600 | (nothing distinctive) |
| [minimax](systems/minimax/DESIGN.md) | light | `#ffffff` | `#1456f0` | round | 700 | (nothing distinctive) |
| [mintlify](systems/mintlify/DESIGN.md) | light | `#ffffff` | `#3772cf` | round | 600 | (nothing distinctive) |
| [mistral.ai](systems/mistral.ai/DESIGN.md) | light | `#ffffff` | `#fa520f` | round | 600 | (nothing distinctive) |
| [mongodb](systems/mongodb/DESIGN.md) | light | `#ffffff` | `#00ed64` | round | 600 | (nothing distinctive) |
| [nintendo-2001](systems/nintendo-2001/DESIGN.md) | light | `#7a8aba` | `#e60012` | soft | 900 | (nothing distinctive) |
| [nvidia](systems/nvidia/DESIGN.md) | light | `#ffffff` | `#76b900` | tight | 700 | (nothing distinctive) |
| [ollama](systems/ollama/DESIGN.md) | light | `#ffffff` | `#ff5f56` | soft | 600 | (nothing distinctive) |
| [opencode.ai](systems/opencode.ai/DESIGN.md) | light | `#fdfcfc` | `#007aff` | tight | 700 | (nothing distinctive) |
| [playstation](systems/playstation/DESIGN.md) | ? | `?` | `#0070d1` | soft | 700 | (nothing distinctive) |
| [posthog](systems/posthog/DESIGN.md) | light | `#eeefe9` | `#f7a501` | tight | 800 | (nothing distinctive) |
| [raycast](systems/raycast/DESIGN.md) | dark | `#07080a` | `#ff6161` | soft | 600 | (nothing distinctive) |
| [renault](systems/renault/DESIGN.md) | light | `#ffffff` | `#ffed00` | round | 700 | (nothing distinctive) |
| [replicate](systems/replicate/DESIGN.md) | light | `#f9f7f3` | `#ea2804` | soft | 700 | (nothing distinctive) |
| [resend](systems/resend/DESIGN.md) | dark | `#000000` | `#fcfdff` | soft | 600 | (nothing distinctive) |
| [revolut](systems/revolut/DESIGN.md) | ? | `?` | `#494fdf` | round | 700 | (nothing distinctive) |
| [slack](systems/slack/DESIGN.md) | light | `#ffffff` | `#4a154b` | round | 700 | (nothing distinctive) |
| [spacex](systems/spacex/DESIGN.md) | ? | `?` | `#f0f0fa` | round | 700 | (nothing distinctive) |
| [superhuman](systems/superhuman/DESIGN.md) | light | `#ffffff` | `#1b1938` | soft | 700 | (nothing distinctive) |
| [vercel](systems/vercel/DESIGN.md) | light | `#ffffff` | `#eb367f` | round | 600 | (nothing distinctive) |
| [vodafone](systems/vodafone/DESIGN.md) | light | `#ffffff` | `#e60000` | round | 800 | (nothing distinctive) |

## Fast picks

**No accent colour at all** (3): `bugatti`, `wired`, `uber`

**Sharp corners, 0px or pill only** (3): `bugatti`, `wired`, `dell-1996`

**Dark canvas** (13): `bugatti`, `voltagent`, `warp`, `x.ai`, `bmw-m`, `clickhouse`, `composio`, `ferrari`, `framer`, `hashicorp`, `linear.app`, `raycast`, `resend`

## Prose only, not indexed

These ship a written analysis with no token frontmatter, so nothing above
was derived for them and no constraint should be inferred. Read the file
directly if you want one of these.

[kraken](systems/kraken/DESIGN.md), [lamborghini](systems/lamborghini/DESIGN.md), [lovable](systems/lovable/DESIGN.md), [mastercard](systems/mastercard/DESIGN.md), [runwayml](systems/runwayml/DESIGN.md), [sanity](systems/sanity/DESIGN.md), [spotify](systems/spotify/DESIGN.md), [starbucks](systems/starbucks/DESIGN.md), [tesla](systems/tesla/DESIGN.md), [theverge](systems/theverge/DESIGN.md)
