#!/bin/bash
# The install summary's "where your prompts go" line, for the agents this Mac
# actually has. It used to say Anthropic to everyone, and a USC student on the
# free Codex (2026-10-13 USC week walk) was told their prompts go to Anthropic
# when they go to OpenAI.
names=()
vendors=()
command -v claude >/dev/null 2>&1 && { names+=("Claude Code"); vendors+=("Anthropic"); }
command -v codex >/dev/null 2>&1 && { names+=("Codex"); vendors+=("OpenAI"); }
command -v gemini >/dev/null 2>&1 && { names+=("Gemini CLI"); vendors+=("Google"); }
case ${#names[@]} in
  0) echo "Your prompts go to whoever runs the agent you type them into: Anthropic for Claude Code, OpenAI for Codex." ;;
  1) echo "Your prompts go to ${vendors[0]}, the same as any ${names[0]} session." ;;
  *) list=""
     for i in "${!names[@]}"; do list="$list${list:+, }${vendors[$i]} for ${names[$i]}"; done
     echo "Your prompts go to whoever runs the agent you type them into: $list." ;;
esac
