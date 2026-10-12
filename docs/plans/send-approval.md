# Send approval as a type: only a press can make one

Written 2026-10-11 overnight. Inventory, what landed, and the migration order.

## The rule

Nothing reaches another person unless it carries an Approval, and the only
code that can mint an Approval is the code that receives a person's press: a
HUD button, a key typed at a real terminal, or the six-digit code read off the
person's own screen (bin/lib/mcp-writes.js, already live). An agent can draft
anything. It can never hold an Approval it did not get from a press, so
"send" in its own output, a `--yes` it passes itself, or text injected into
it has nothing to send with.

In Rust terms: `fn send(draft: Draft, approval: Approval)`, where `Approval`
has no public constructor and is bound to the draft's hash, recipient and
channel. In this kit's mix of Python, Node and shell, the same shape is a
file-backed token: minted by the press handler into an owner-only directory,
named by the draft hash, single use, 15-minute life, and checked by every
sink before it sends.

## Inventory, origin/main, 2026-10-11

22 send paths. `tests/test_send_paths.py` now lists each one and fails when a
file that sends appears without being listed.

A person's press already required:

- `kit_confirm` (bin/lib/mcp-writes.js): draft id plus a six-digit code shown
  only on the person's screen, 3 tries, recipient rechecked.
- WhatsApp and walks surfaces: a HUD button press over hud.sock.
- Clay writes other than `reply` (bin/chewbacca-clay): the op name typed at
  /dev/tty, or a chat ok under 2 hours old.

No press, an agent can send from a shell (worst first):

1. `mac/lib/run_plan.py`: `--yes` approves confirm-gated sends, and the agent
   can pass it. An `app_data` query could run any AppleScript, a send included.
2. `mac/lib/email_reader.py` (`mac mail send`): `--dry-run` only.
3. `bin/chewbacca-clay` op `reply`: self-approved, `--allow-writes`.
4. `tools/gtme_solo.py` `gtme send` and inbox auto-answer: batch id, cap,
   suppression, NO_SEND. Auto-answer is automatic by design.
5. `bin/lib/people/send.js` (`people send`, `people texts drafts send`):
   NO_SEND, quiet hours (`--after-hours` overrides), `--to` repeat from a
   dry run. Reached by `kyber-surfaces home --send` too.
6. `bin/mac-db messages send`, `mac/lib/gmail.py`, `mac/lib/slack.py`,
   `mac/lib/matrix.py`: NO_SEND and `--dry-run` only.
7. `bin/kyber-sessions send/new`: prompts another Claude session in your
   permission mode.

## Landed tonight

- A plan's `send_text` and `send_email`, and `mac mail send`, now honor
  CHEWBACCA_NO_SEND. Before, a session that set it to stay safe could still
  send through them.
- A plan's `app_data` query refuses an AppleScript that sends.
- `tests/test_send_paths.py`: the inventory as a test.

## Migration order

1. One module per runtime, `send_approval.py` and `send-approval.js`, with
   `mint(draft_hash, channel, to)` callable only from the press handlers
   (HUD action handler, the TTY prompt, kit_confirm) and `take(draft_hash,
channel, to)` that every sink calls. `take` consumes the token or raises.
2. people send.js first: it carries texts, WhatsApp, Matrix, Gmail and Slack
   for people, and `kyber-surfaces home --send` routes through it. The HUD
   Send button mints; `people send` with no token prints a draft and the
   code prompt, like kit_confirm.
3. run_plan: `--yes` stops approving sends. A plan with a send step pauses at
   that step and asks for the press.
4. `mac mail send`, `mac-db messages send`, gmail.py, slack.py, matrix.py.
5. Clay `reply`: drop it from SELF_APPROVED.
6. gtme: the batch the person approved mints one token per message at
   approval time; auto-answer stays automatic only for the client inboxes
   Caleb named, logged per send.
7. The test flips from "listed" to "every listed sink calls take()".

## What would prove this wrong

- A send the person wanted that had no press surface available (HUD down,
  no terminal). Then the code goes to a macOS notification, as kit_confirm
  already does, and the agent waits.
- An agent that can read the screen reads the code. kit_confirm's code is
  drawn on the HUD and in a notification title today. The fix is a press
  that is an action, a button, not a number to read back.
