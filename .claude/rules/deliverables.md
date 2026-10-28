# Deliverables: the smartest way to hand someone a file

Always on. Any file made for the user to use or pass on follows this.

## Where and what format

- **Downloads, plain name.** Save it to `~/Downloads` with a name a person would type, like `Karthik call prep.md`. A file left in a repo or a notes folder never gets opened.
- **They might edit it: `.md`.** Prep sheets, plans, drafts and notes for themselves. They paste it into Google Docs.
- **A team doc, or one he'll pull up on a call: Google Doc.** Create it in his Drive with the Drive connector (text/markdown upload, no emojis, they import as mojibake) and lead the reply with the link. A table goes in a Google Sheet. Caleb, 2026-10-13: "When it makes more sense just make a google doc for me." A team doc fits on one phone screen: a checklist of what to do and when, with the research and sources left in chat (2026-10-13, on a three-page TikTok playbook: "Bro no one wants to read that 3 page wall of text").
- **It goes to someone else: PDF.** Anything for a teammate, professor, client or investor.

- **Link it by absolute path.** In the reply, link the file as `/Users/<user>/Downloads/<name>` with spaces as `%20`. A link relative to the shell's cwd is dead, because the editor resolves it from the session root (2026-10-11: two `../../Downloads/...` links refused by link-guard on the Chewbacca one-pager).
- **A one-pager PDF has to be one page.** `chewbacca pdf` has no layout flags, so render from a copy with the blank lines between bullets removed, then read the page count it prints. Over one page means cut bullets, never shrink the type by hand (2026-10-11: 38 bullets spilled 8 lines, 33 fit).
- **A one-page Google Doc is checked in Google, not locally.** `chewbacca pdf` fits more on a page than a Doc does, so export the Doc as PDF through the Drive connector (`download_file_content`, `exportMimeType: application/pdf`) and count its pages before handing it over. On 2026-10-27 a partner agreement read 1 page in `chewbacca pdf` and Caleb opened the Doc and wrote "It's over a page".

## Shape follows how it gets used

- **Used live** (a call, a meeting, a demo, a pitch): number the sections in the order things happen, and write the lines as what to say or do at that moment. Open, ask, show, ask for the thing, close.
- **Prep someone else reads mid-call is plain English.** Full words (you, your, with, about), never u, ur, w, rn or abt, every insider term explained once (MSP = IT support company), and each step names who says it. One page per call, checked by exporting and counting pages. Caleb's texting voice is for chat with him only. Gavin, 2026-10-28: "I couldn't understand it on the fly... Send me call prep in English pls."
- **Every "we changed X on your site" line is checked against the live draft first.** On 2026-10-28 the Junto prep said a stat sat "at the top" when it was 5,350px down the page.
- **A negotiation prep carries the other side's best answer.** When the prep comes from an advisor's call (a split, terms, a price), keep the advisor's own hedges next to the ask and write the counterargument the other person will give, with a reply. On 2026-10-27 a Caleb/Gavin split prep pushed his dad's 55/45 story and dropped his dad's "I'm not saying you should be 55-45" and "maybe 50/50 is the clean, easy way." Gavin answered "why does there need to be an equity split" with a 3-person board vote, and Caleb had no reply ready.
- **A call two of ours are on**: build it for both people from the first draft. That means a timed run of show at the top, every line tagged with who says it ([C], [G]), a short background for each person, questions split between them, and Live notes at the bottom for whoever isn't talking. Make the Google Doc editable by anyone with the link (`gws drive permissions create`, type anyone, role writer), since the connector's share_file only takes an email. On 2026-10-27 a Holly prep written for one voice had to be redone ("Make the doc optimal for me and gav to both use during the meeting") and then reshared ("make it editable to anyone with the link").
- **A call prep Doc fits on one phone screen.** Lines of 3 to 10 words, no sentences of background, no talk track paragraphs. Their bio is 3 lines max. The page link, the questions and the asks are the whole doc. Set margins to about 0.6in with `updateDocumentStyle`, since a markdown import keeps the 1in default. Caleb, 2026-10-27, on the Medrano call doc: "Some parts are sill to text heavy bruh also fix the margins".
- **Used for reference** (a plan, a list, a report): group it by the question the reader will come in with.
- **One glance per line.** Short bullets, with a blank line between them. A dense block reads as a wall of text in Google Docs.
- **Evidence goes on the page when it's the point.** If the file has to win an argument, put the exact numbers and where they came from right next to the claim. Otherwise keep sourcing in the notes.
- **Check it as the reader would.** Read every line as the person holding it, mid-call or mid-email. A line that contradicts another line, or a "don't say X" with X in the opener, gets fixed before it's handed over.

## A how-to guide people will pass around

- **Written for the least technical reader.** Every account they make gets one line on what it's for. Every command gets one gray line on what it does and what will look scary (an invisible password, the lines Homebrew prints under Next steps). Every tool, account and page is a link.
- **One page, real hierarchy.** Upload styled HTML (`gws drive files update --upload x.html --upload-content-type text/html`), then set margins and `lineSpacing` with `gws docs documents batchUpdate`. Markdown imports flat. Use a big title, numbered section headers in one accent color, paste blocks indented under bold labels, and code in gray monospace. Export the doc to PDF and look at it before saying it's done, including the page count.
- **It reads like the user made it.** Open with two or three sentences in their voice: who put them on to it, what it gets you, "text me if you get stuck". Credit the friend by name. Sign it.
- **Install the way a stranger's Mac will.** Codex comes from `npm install -g @openai/codex`. The Homebrew cask is quarantined and macOS says "Apple could not verify codex". Never test an installer with a PATH that makes it `brew install` onto the user's own machine. On 2026-10-26 a test did, and the user got that popup.

Caleb, 2026-10-26, on the USC Codex guide: "Assume the user doesn't hv a github... NON dev", then "Make them make accounts and easily know what they are for", "Include all useful links on the doc!", "the doc is too long... fat wall of text... NO visual heirarchy", "Make it look like I actually wrote it and was intentional".

## Where this came from

On 2026-10-09 a call prep was handed over as full sentences in a notes folder. The user's fixes, in order: "save them to downloads", ".md if I might edit, PDF if it's for someone else", "it's a fat wall of text", "it just needed more spacing", and "go through the progression of what I should say in the call". Then he said "all chewb files should be given like this".
