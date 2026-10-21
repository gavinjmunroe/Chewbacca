# domains/messaging

Local macOS iMessage stack for Medha / ClearOut.

| Subdir | Source | Role |
| ------ | ------ | ---- |
| `messages2/` | `amber-organization/messages2@59be9b4` (`v0.2.0`) | Electron reference client |
| `messages2kit/` | `amber-organization/messages2kit@c2d2a74` (`v0.1.0`) | Swift `MessagesProvider` library |

Consumer of the kit: [`domains/clearout`](../clearout/) (AI inbox). iMessage
channel in ClearOut is still “coming soon” — Kit is the intended provider.


See `.provenance.json` and repo-root `docs/DOMAIN_MAP.md`.

## Extract priority

1. **messages2kit** — SPM package is the extractable surface
2. **messages2** — keep as reference; port SQL/UX lessons into Kit when needed

```bash
# Kit (macOS)
cd messages2kit && swift test && swift build

# Electron ref (macOS)
cd messages2 && npm install && npm run dev
```
