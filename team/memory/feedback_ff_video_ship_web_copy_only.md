---
name: feedback_ff_video_ship_web_copy_only
description: Ship FF hero video changes as the web copy plus sources; a 51 MB master render in the commit failed the push to calebnewtonusc/firm-foundation
metadata:
  type: feedback
---

On 2026-10-29 the v26 push to calebnewtonusc/firm-foundation failed with "unable to open large-object storage file" because the commit carried the 51 MB master render (video/renders/ff-hero-v26.mp4). Dropping the render and pushing only `site/public/media/video/ff-hero.mp4` (11.8 MB, from `video/tools/web.sh`), the poster and the changed `video/` sources went through, and Railway served it within a minute.

**Why:** the site only needs the web copy. Masters over 50 MB trip GitHub, and the earlier renders already bloat the repo.

**How to apply:** keep masters local in video/renders. After a push, check `curl -sI https://firm-foundation.up.railway.app/media/video/ff-hero.mp4` shows the new content-length (see [[feedback_ff_deploy_push_is_not_live]]). Pictures Caleb sends mid-turn only show as previews and never land on disk, so ask him to resend a picture as its own message when it has to go into a render.
