# The script format

One markdown file is the whole talk. `chewbacca present` turns it into the
talk window, the presenter window and the trainer.

```markdown
# How CRISPR-Cas9 works | Caleb Newton

## problem: The problem

### hemoglobin carries the oxygen

A red blood cell carries oxygen using a protein called **hemoglobin**.

> A round red cell, hemoglobin units loose inside it.

- ~270 million hemoglobin per red cell
- Four subunits, each holds one oxygen

### codon 6, GAG becomes GTG

In sickle cell, codon six reads **GTG** instead of GAG.

> The strand flips to GTG and the label changes.

- Codon = 3 DNA letters = 1 amino acid
- A missense substitution
```

What each line does:

- `#` the title and your name. Becomes the cover.
- `##` a scene. `key: Label` where the key matches a drawing in `lib/scenes.tsx`.
  A scene with no drawing still works, it just shows text.
- `###` a beat, which is one click. The short line here is the **cue**, which
  the room sees.
- a plain paragraph is the **sentence** you say on this beat. `**bold**` and
  `*italic*` carry through.
- `>` is what is **on screen** right now. You are narrating a drawing you are
  not looking at, so this is the line that stops you guessing.
- `-` bullets are **spare material** you can build sentences from if you are
  running short.

## Question prep

A section called `## Q&A` turns into the question panel on the last stop. One
question per `###`, with the answer underneath.

```markdown
## Q&A

### Why not just fix the mutation?

HDR needs a template and is rare in stem cells. NHEJ is easy.
```

## Aid level

`--level` decides what the presenter window leads with, and it should match
how much you have rehearsed **out loud**, not what feels cooler:

- `script` (default) if you learned it today
- `sentence` if you have run it once
- `bullets` only if you own the connections

Asking for a lower level than your rehearsal supports gets you both anyway,
with the sentence one tap away. `skills/presenting/SKILL.md` says why.
