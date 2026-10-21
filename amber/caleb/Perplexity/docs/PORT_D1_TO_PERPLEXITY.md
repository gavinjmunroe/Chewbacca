# D1 Vibe Coding -> Perplexity Code Port Map

## Source -> Target mapping

- `.claude/commands/*` -> `.perplexity/commands/*`
- `.claude/rules/*` -> `.perplexity/rules/*`
- `.claude/hooks/*` -> `.perplexity/hooks/*`
- `CLAUDE.md` -> `PERPLEXITY.md`
- `~/.claude/settings.json` ideas -> `PERPLEXITY_HOOKS.json`
- `second-brain/*` -> `second-brain/d1-source/*`

## Porting priorities

1. Command pack import
2. Rules injection by file type
3. Hook translation into Perplexity hook config
4. GitHub resourcefulness
5. Second-brain loading into PERPLEXITY.md and workflow prompts
6. Design-system port from CLAUDE.md into PERPLEXITY.md

## Notes

- Keep Perplexity Code branding everywhere.
- Do not reference Claude, `.claude`, or Claude Code in runtime prompts.
- Use D1 as source material, not final runtime wording.
