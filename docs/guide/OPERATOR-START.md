# Start here: a client's outbound from your own Mac

For an operator running one client's outbound with Chewbacca, local on their
own Mac. You get from a clean Mac to a graded draft without the account
owner on a call. The machine steps took about a minute when this path was
rehearsed from a clean home folder on 2026-10-13. The rest of the time goes to
your own sign-ins and the hand-off below.

Nothing here sends an email, launches or enrolls a campaign, or spends a
credit. A grade never authorizes a send. A campaign START needs a passing
grade, a fresh pre-send gate receipt, and your OK, all checked in code.

## Before you start, from the account owner

- GitHub access to `calebnewtonusc/Chewbacca` and to the client's repo.
- The client file. They make it with
  `chewbacca gtme config export --client <Client> --out <client>.client.json`,
  which writes every path as `~/...` so it works on your Mac.
- The client's data folder (lists, verification, suppression, senders). It holds
  real contact data, so it travels outside git.
- Your own login to the client's Clay workspace. Never theirs.

## 1. Get the kit (about 2 minutes)

```sh
gh auth login            # once, if git can't reach the private repo yet
git clone https://github.com/calebnewtonusc/Chewbacca ~/Chewbacca
```

## 2. Set it up (under 10 seconds, asks nothing)

```sh
bash ~/Chewbacca/setup.sh --every-agent
```

It wires every coding agent it finds (Claude Code, Codex, Cursor, Gemini CLI,
VS Code), backs up each file before touching it, and links `chewbacca` into
`~/.local/bin`. Open a new terminal so `chewbacca` is on your PATH. The last
lines print the one command that undoes all of it.

## 3. Sign in to Clay, then name the workspace

Clay's own CLI comes with Clay's Claude Code plugin: ask Claude Code to "set up
Clay" and its setup skill installs it. Then sign in once in your browser:

```sh
clay login
clay whoami              # exit 0 means you're signed in
chewbacca gtme setup
```

It finds your workspaces and asks one question per workspace: who it's for.
Answer with the client's name exactly as the client file spells it.

## 4. Put the client's repo and data where the file expects them

```sh
chewbacca gtme config import ~/Downloads/<client>.client.json
```

It backs up `~/.chewbacca/gtm/clients.json`, adds the client, and checks the
entry. Every `error` line names a path that isn't on this Mac yet, usually
the client repo (`rulings_path`, offer `context` files) or the data folder
(`data_dir`, `ready.*`). Clone or copy each one to the path it prints, then:

```sh
chewbacca gtme config check --client <Client>     # OK means you're set
```

## 5. Grade a draft

A draft still on your Mac, as a copy file (steps split by `---`):

```sh
chewbacca gtme-grade --client <Client> --copy draft.txt --leads leads.csv --review review.json
```

`--client` fills the verification, suppression and sender files, the warmup
date, the ICP titles and the field map from the client file. `review.json`
records that someone read the emails as the recipient would. Every line comes
back PASS, FAIL or NOT CHECKED with the rule behind it, and NOT CHECKED
counts as a fail.

Drafts already in Clay, the whole week at once:

```sh
chewbacca gtme ready --client <Client> --drafts <week folder>/drafts.json
```

## Every day after

- `chewbacca gtme brief`: replies to answer, alarms, credits, the top three moves.
- `chewbacca gtme next`: each campaign's to-do list with its command and its gate.
- `chewbacca gtme report --client <Client> --week`: the weekly numbers, from the API.

## When something looks wrong

- `chewbacca doctor`: what the install is missing.
- `chewbacca gtme config check --client <Client>`: what the client file points at that isn't here.
- `chewbacca gtme explain <word>`: one plain sentence for a term.

Built with Chewbacca
