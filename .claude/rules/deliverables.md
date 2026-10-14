# Deliverables: the smartest way to hand someone a file

Always on. Any file made for the user to use or pass on follows this.

## Where and what format

- **Downloads, plain name.** Save it to `~/Downloads` with a name a person would type, like `Karthik call prep.md`. A file left in a repo or a notes folder never gets opened.
- **They might edit it: `.md`.** Prep sheets, plans, drafts and notes for themselves. They paste it into Google Docs.
- **A team doc, or one he'll pull up on a call: Google Doc.** Create it in his Drive with the Drive connector (text/markdown upload, no emojis, they import as mojibake) and lead the reply with the link. A table goes in a Google Sheet. Caleb, 2026-10-13: "When it makes more sense just make a google doc for me." A team doc fits on one phone screen: a checklist of what to do and when, with the research and sources left in chat (2026-10-13, on a three-page TikTok playbook: "Bro no one wants to read that 3 page wall of text").
- **It goes to someone else: PDF.** Anything for a teammate, professor, client or investor.

- **Link it by absolute path.** In the reply, link the file as `/Users/<user>/Downloads/<name>` with spaces as `%20`. A link relative to the shell's cwd is dead, because the editor resolves it from the session root (2026-10-11: two `../../Downloads/...` links refused by link-guard on the Chewbacca one-pager).
- **A one-pager PDF has to be one page.** `chewbacca pdf` has no layout flags, so render from a copy with the blank lines between bullets removed, then read the page count it prints. Over one page means cut bullets, never shrink the type by hand (2026-10-11: 38 bullets spilled 8 lines, 33 fit).

## Shape follows how it gets used

- **Used live** (a call, a meeting, a demo, a pitch): number the sections in the order things happen, and write the lines as what to say or do at that moment. Open, ask, show, ask for the thing, close.
- **Used for reference** (a plan, a list, a report): group it by the question the reader will come in with.
- **One glance per line.** Short bullets, with a blank line between them. A dense block reads as a wall of text in Google Docs.
- **Evidence goes on the page when it's the point.** If the file has to win an argument, put the exact numbers and where they came from right next to the claim. Otherwise keep sourcing in the notes.
- **Check it as the reader would.** Read every line as the person holding it, mid-call or mid-email. A line that contradicts another line, or a "don't say X" with X in the opener, gets fixed before it's handed over.

## Where this came from

On 2026-10-09 a call prep was handed over as full sentences in a notes folder. The user's fixes, in order: "save them to downloads", ".md if I might edit, PDF if it's for someone else", "it's a fat wall of text", "it just needed more spacing", and "go through the progression of what I should say in the call". Then he said "all chewb files should be given like this".
