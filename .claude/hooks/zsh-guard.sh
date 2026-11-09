#!/bin/bash
# hookd skips this guard for a Bash call with none of these: rule 1 needs
# `for` (for path in) or `path=`, rules 2 and 3 need a $ expansion. Not the
# bare word path: every hook payload carries "transcript_path", so it ran on
# every call (hook_bench, 2026-10-12). Proven by tools/hookd_replay.py: 0.087 s
# of CPU on every Bash call before.
# gate: $ path= path+= for
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init zsh-guard.sh 5
# PreToolUse: refuse the three zsh traps that each cost a full re-run on
# 2026-09-27, while rendering one demo video overnight. The agent's shell on
# this Mac is zsh, and the agent writes bash.
#
#   1. `for path in ...` rebinds $path, which zsh ties to $PATH. Every command
#      after it in the loop died with "command not found: sed", and the
#      design-gate run it was part of reported nothing at all.
#   2. `"...$G[v]"` is an array subscript in zsh, not "$G" followed by "[v]".
#      An ffmpeg filter string lost its output label and failed to open.
#   3. `F="-threads 2"; ffmpeg $F ...` passes ONE argument in zsh, because zsh
#      does not word-split an unquoted parameter. ffmpeg rejected the option.
#
# memory/feedback_measure_exit_codes_directly.md already recorded the third
# one on 2026-09-22. It happened again five days later, because a memory note
# does not fire. This does.
#
# Exit 2 blocks the call. Each refusal says the one-line fix.

set -uo pipefail

shell_name="${ZSH_GUARD_SHELL:-${SHELL##*/}}"
[ "$shell_name" = "zsh" ] || exit 0

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

# chewbacca-bashparse (crates/bashparse, tree-sitter-bash) blanks what zsh
# provably never parses as shell before the old checks below read the text:
# comments, quoted strings and heredocs handed to a program that isn't zsh,
# and, for rule 1 only, plain argument words. It never adds text, so each
# rule refuses a subset of what it did, plus the parse's own finds further
# down. No binary, a parse error, or anything decided at run time (eval,
# alias, a command name that expands): the raw command, exactly as before.
# Measured 2026-10-12 on 7 days of real refusals: `--match path=/graphql`
# (an argument, not an assignment) and `for path in` inside a python -c
# string spanning lines were 13 of zsh-guard's 19 refusals.
bp="${CHEWBACCA_BASHPARSE:-$HOME/.local/bin/chewbacca-bashparse}"
masked() {
  local out
  if [ -x "$bp" ] && out="$(printf '%s' "$cmd" | "$bp" --mask "$1" 2>/dev/null)"; then
    printf '%s' "$out"
  else
    printf '%s' "$cmd"
  fi
}

# A heredoc body is data: nothing in it runs in zsh, so a python script or a
# commit message that MENTIONS these traps must not trip them. Same stripping
# as load-guard.sh, which learned this on its first day.
strip_heredocs() {
  printf '%s\n' "$1" | awk '
  # A heredoc ends at ITS delimiter, never at the first all-letters line: an
  # empty line matches /^[A-Za-z_]*$/, so a blank line in a commit message
  # used to end the heredoc early and the rest was read as commands
  # (load-guard refused a commit message that mentioned a video tool,
  # 2026-09-27). The text before << is still a command and stays.
  !inh {
    if (match($0, "<<-?[ \t]*[\047\042]?[A-Za-z_][A-Za-z0-9_]*[\047\042]?") && substr($0, RSTART - 1, 1) != "<") {
      d = substr($0, RSTART, RLENGTH); gsub("<<-?[ \t]*|[\047\042]", "", d)
      print substr($0, 1, RSTART - 1); inh = 1; next
    }
    print; next
  }
  { t = $0; sub("^[ \t]+", "", t); if (t == d) inh = 0; next }
'
}
# Single-quoted text never expands in zsh, so awk programs and sed scripts
# that use $1[...] are not subscripts.
unsingle() { printf '%s' "$1" | sed "s/'[^']*'/''/g"; }
# Outside any quotes, for the word-splitting rule.
undouble() { printf '%s' "$1" | sed 's/"[^"]*"/""/g'; }

refuse() {
  printf 'zsh-guard: refusing. %s\n\n  %s\n\nThe shell here is zsh, and this is written as if it were bash.\n' "$1" "$2" >&2
  exit 2
}

# judge NOHD NOSINGLE BARE BARE_ASSIGN: the old three rules on these texts.
# Prints "<reason>\t<fix>" for the first trap found, nothing when clean.
judge() {
  local nohd="$1" nosingle="$2" bare="$3" bare_assign="$4" hit var name
  # 1. $path, $fpath, $cdpath and $manpath are arrays tied to their upper-case
  #    scalars. Looping or assigning over one of them replaces the search path.
  if printf '%s' "$bare_assign" | grep -qE '(^|[;&|[:space:]])for[[:space:]]+(path|fpath|cdpath|manpath|module_path)[[:space:]]+in([[:space:]]|$)'; then
    printf '%s\t%s\n' 'Looping with a variable named path rebinds $PATH in zsh, and every command after it becomes "command not found".' \
           'Rename it: for route in ...; or for p in ...'
    return
  fi
  if printf '%s' "$bare_assign" | grep -qE '(^|[;&|[:space:]])(path|fpath|cdpath|manpath)=[^(=]'; then
    printf '%s\t%s\n' 'Assigning to path replaces $PATH in zsh.' 'Pick another name, like target= or route='
    return
  fi
  # 2. $NAME[ inside double quotes (or bare) is a subscript in zsh.
  if printf '%s' "$nosingle" | grep -qE '(^|[^\\{$])\$[A-Za-z_][A-Za-z0-9_]*\['; then
    hit="$(printf '%s' "$nosingle" | grep -oE '\$[A-Za-z_][A-Za-z0-9_]*\[' | head -1)"
    var="${hit#\$}"; var="${var%\[}"
    printf '%s\t%s\n' "${hit} is an array subscript in zsh, not the variable followed by a bracket." \
           "Brace it when you mean a literal bracket: \${${var}}[ and write \${${var}[1]} when you mean an element."
    return
  fi
  # 3. A variable holding several flags, expanded unquoted, stays one argument.
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if printf '%s' "$bare" | grep -qE "(^|[^\"'A-Za-z0-9_])\\\$(\\{)?${name}(\\})?([^A-Za-z0-9_]|\$)"; then
      printf '%s\t%s\n' "\$${name} holds several flags, and zsh passes an unquoted parameter as ONE argument, so the program sees '-flag value' as a single unknown option." \
             "Inline the flags, or use an array: ${name}=(-threads 2) and then \"\${${name}[@]}\""
      return
    fi
  done < <(printf '%s' "$nohd" | grep -oE '(^|[;&[:space:]])[A-Za-z_][A-Za-z0-9_]*=["'"'"']-[^"'"'"']*[[:space:]][^"'"'"']*["'"'"']' | sed -E 's/^[;&[:space:]]*//; s/=.*//')
}

# The old reading first, on the raw text. Only when it finds a trap does the
# parse get a say, so the half of all Bash calls this guard's gate lets in
# pay nothing for it (0.092 s CPU a call either way, 2026-10-12; running the
# parser on every call made it 0.145 s).
nohd="$(strip_heredocs "$cmd")"
nosingle="$(unsingle "$nohd")"
bare="$(undouble "$nosingle")"
verdict="$(judge "$nohd" "$nosingle" "$bare" "$bare")"
if [ -n "$verdict" ] && [ -x "$bp" ]; then
  nohd="$(strip_heredocs "$(masked zsh-code)")"
  nosingle="$(unsingle "$nohd")"
  bare="$(undouble "$(unsingle "$(strip_heredocs "$(masked zsh-bare)")")")"
  bare_assign="$(undouble "$(unsingle "$(strip_heredocs "$(masked zsh-assign)")")")"
  verdict="$(judge "$nohd" "$nosingle" "$bare" "$bare_assign")"
fi
[ -n "$verdict" ] && refuse "${verdict%%$'\t'*}" "${verdict#*$'\t'}"

# What the parse adds: a loop or a scalar assignment the text can't see,
# inside a `zsh -c` or `eval` string (`eval 'for path in a; do ...'`).
# Only a command naming one of the tied arrays is parsed for it.
if [ -x "$bp" ] && command -v jq >/dev/null 2>&1 && printf '%s' "$cmd" | grep -qE 'path'; then
  facts="$(printf '%s' "$cmd" | "$bp" 2>/dev/null)" || facts=""
  if [ -n "$facts" ]; then
    hit="$(printf '%s' "$facts" | jq -r '
      [.for_vars[] | select(.via == null or .via == "zsh -c" or .via == "eval") | "for \(.name)"] +
      [.assigns[] | select((.via == null or .via == "zsh -c" or .via == "eval") and .value != null) | "set \(.name)"]
      | map(select(test("^(for|set) (path|fpath|cdpath|manpath|module_path)$"))) | .[0] // empty' 2>/dev/null)"
    case "$hit" in
      for\ *) refuse 'Looping with a variable named path rebinds $PATH in zsh, and every command after it becomes "command not found".' \
                     'Rename it: for route in ...; or for p in ...' ;;
      set\ *) refuse 'Assigning to path replaces $PATH in zsh.' 'Pick another name, like target= or route=' ;;
    esac
  fi
fi

exit 0
