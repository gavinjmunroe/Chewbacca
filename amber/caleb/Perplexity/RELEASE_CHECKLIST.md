# Public Alpha Release Checklist

- [ ] Rotate any exposed API keys
- [ ] Confirm `perplexity --version` works
- [ ] Confirm `/help`, `/hooks`, `/memory`, `/mode`, `/plan` work
- [ ] Run `./scripts/release_alpha.sh`
- [ ] Copy `PERPLEXITY.md.example` to `PERPLEXITY.md` if needed
- [ ] Copy `PERPLEXITY_HOOKS.json.example` to `PERPLEXITY_HOOKS.json` if needed
- [ ] Validate install flow:
  - [ ] `./install.sh`
  - [ ] `./scripts/pipx_install_local.sh`
- [ ] Review `tool_activity.log` behavior
- [ ] Share README + install instructions with alpha users
