# Togari, inside Chewbacca

Every piece of Togari lives here so Chewbacca clients never depend on a Togari
repo. Karthik cleared taking the code. Each folder is a plain copy of a repo's
newest tree, with no git history, `.env` files or `node_modules`.

`platform/` is the live one. It's the backend behind `togari-bma-prod` on
Railway (the Togari MCP, Smartlead replies, Slack assistant, ICP lists), and
everything else is older or a side branch of the same work.

| Folder          | Came from                                    | Newest commit       |
| --------------- | -------------------------------------------- | ------------------- |
| `platform/`     | bluemodernadvisory/togari-platform, main     | cb67af6, 2026-10-18 |
| `search/`       | amberintelligence/amber-search (PeopleRank)  | d87e3bd + 802a83e   |
| `sandbox/`      | bluemodernadvisory/togari-sandbox (monorepo) | adace00, 2026-08-03 |
| `dedup/`        | calebnewtonusc/togari-dedup                  | 6507ad3, 2026-05-26 |
| `gtm-os/`       | calebnewtonusc/togari-gtm-os                 | 147458b, 2026-03-30 |
| `frontend/`     | amber-organization/togari-frontend           | d99c6b9, 2026-05-11 |
| `mcp-v1/`       | karthikBMA/TogariMCP                         | ae6e2af, 2026-03-19 |
| `monorepo-feb/` | calebnewtonusc/togari                        | 4d53abb, 2026-02-12 |

What was left out on purpose:

- `mcp-v1/.env.example`. It held a live Anthropic key and a live Structify key.
  Both need rotating, since they've sat in that repo since March.
- `frontend/mocks/fixtures/company_contacts.json` is now `[]`. It held 119 real
  48North prospects with cell numbers, and 14 people can read this repo.
- Branches. Only each repo's main came over. The old repos still hold the rest.

`_unmerged/platform-local-edits-2026-10-15.patch` is uncommitted work from the
local togari-platform checkout. It conflicts with the 61 commits that landed
after it, and most of its functions already exist on main, so check it before
applying anything from it.

---

All glory to God! ✝️❤️
