---
name: ff-video-in-outbound-2026-10-19
description: "Firm Foundation's hero video goes in cold email 2 as one link to firmfoundation.tech/watch; contact-sheet every render before linking it, since v21 still showed template placeholder text"
metadata:
  node_type: memory
  type: feedback
---

On 2026-10-19 Caleb asked for the hero video (video/renders/ff-hero-v21.mp4, 49 MB) in the church emails.

- It lives on the site at /watch (site/app/watch/page.tsx), served from the site itself because the CSP allows media from 'self' only. Web encode: H.264 CRF 26 faststart, 11.7 MB, poster from 2 s, preload="metadata".
- It goes in email 2 as one plain link. Email 1 keeps one ask (the free fix list). Email 2 with the link graded 89 to 92 on gtme_jev. The old breakup email 3 graded 54 because it offered nothing, and offering the list again took it to 90.
- Before linking any render, pull a contact sheet (ffmpeg, one frame every 4 s) and read it. v21 had a full-screen card at about 26 s reading "(photo of people together outside, the hero shot (cut the people out so the word sits behind them))". A church would have seen it.
- firmfoundation.tech is Gavin's Vercel project and deploys only his commits (SITE.md). A page pushed by Caleb isn't live until Gavin redeploys. Curl the link for a 200 before ok-ing a batch that carries it. The preview at firm-foundation.up.railway.app deploys with `railway up --service firm-foundation` from site/.

Logo, same night: Caleb asked to update the logo "per texts w gav and that photo I had sent". The photo (firm_foundation_logo.png, cross over a bar over two back-to-back F's) was not final. Gavin's replies in the thread were the spec: "Maybe we get rid of the cross", "Dude that logo is insane without the cross". The first build used the photo as is and Caleb corrected it. Read the teammate's replies around an attachment before treating the attachment as the decision. The mark now lives in site/components/Wordmark.tsx (MARK), app/icon.svg and app/apple-icon.png.

Handoff, same night: Caleb wanted the outbound "super easy for gav to go through" inside the repo. The entry point is ops/START-HERE.md (one page: the week, a real email, Gav's Monday steps, what Chewbacca does per step, where each number comes from, a file map) plus ops/THIS-WEEK.csv (one row per church that week with day, contact, first line, fix count and the audit file). ops/README.md points to both first. Regenerate THIS-WEEK.csv from leads.csv and lines.json whenever a new week's batches are planned, so it never shows last week.
