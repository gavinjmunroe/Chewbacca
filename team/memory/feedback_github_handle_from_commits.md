---
name: feedback_github_handle_from_commits
description: A teammate's GitHub login is in the noreply author emails of a repo they committed to; Drive auth dead means a private release asset
metadata:
  type: feedback
---

To give a teammate repo access, find their GitHub login in the noreply author
email of any local clone they committed to:
`git log --all --format='%an|%ae' | sort | uniq -c`. The form is
`<id>+<login>@users.noreply.github.com`, and `gh api users/<login>` must return
the same id. A name search is not enough: on 2026-10-20 "Maggie Chen" matched
three unrelated accounts, and her real one (`maggiexqc`) appeared only in
work/bma/togari-platform. Inviting the wrong match would have handed a stranger
a private repo of investor emails.

To hand over a file too big for email (prometheus.db, 320MB) when gws and gog
Drive tokens are both expired, zip it and attach it as a release asset on the
private repo the person was just invited to (`gh release create`). The asset
stays behind the same access. Check `.private` on the repo first.

**Why:** a teammate's login is one log query away, cheaper than asking or guessing.
**How to apply:** for any "share X with <teammate>" ask, check the commits first,
then `people` and texts.
