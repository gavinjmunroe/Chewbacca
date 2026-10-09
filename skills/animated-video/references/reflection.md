# Reflection protocol

When the user asks for a reflection after an animated-video session, review the work and
propose updates to this skill. Present findings and proposed changes, and apply edits only
after the user approves them. A standing approval recorded in the user's profile counts.

1. Read the session's corrections, the final render, the review scores and the open issues.
   Compare completion claims with what was actually checked, and label missing evidence.
2. Separate explicit preferences, observed failures and their fixes, and untested experiments.
3. Generalize before you promote. Anything that goes into this skill must hold for a different
   brief, style and subject: a process step, a failure pattern, a check, or a tool gotcha. The
   project's creative choices (palette, fonts, proportions, gags, shot list) and the user's
   personal preferences stay in the project or in `~/.animated-video/profile.md`. When the
   user was only partly satisfied, record the direction they endorsed and what they disliked,
   not the output as a model.
4. Put each lesson in its one home:
   - workflow steps → `../SKILL.md`
   - pipeline commands and gotchas → `remotion-pipeline.md`
   - rig lessons → `character-rig.md`
   - graphics lessons → `motion-graphics.md`
   - review and stop rules → `review-loop.md`
   - reusable, style-neutral code → `../templates/`
   Keep SKILL.md under about 150 lines.
5. Prune stale or duplicate rules. Keep transcripts, credentials, personal project history and
   machine-specific paths out of the skill.
