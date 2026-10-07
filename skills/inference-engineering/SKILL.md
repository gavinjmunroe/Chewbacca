---
name: inference-engineering
description: "Pick, measure and ship the model call inside a product: which model (or no model), where it runs, how fast it must be, and how you know it is right. Use when adding a classifier, router, gate, scorer, judge, embedding lookup or any model call to a hook, CLI, HUD or pipeline; when someone reaches for an LLM to answer a yes/no or pick-one question; when a model call is slow, costly, flaky or sends private text off the machine; when choosing a threshold or cutoff; or when asked to 'inference engineer' something. Also fires on: classifier, probe, embedding, logistic regression, threshold, cutoff, latency budget, p95, local model, Ollama, quantize, float16, which model should I use, too slow, too expensive, prompt hook calls an API."
---

# Inference engineering

The model is one node in a product, so it is chosen like any other part: by a
measured result on real data, inside a latency and privacy budget, with the
cheapest thing that clears the bar. Graph engineering decides where the call
sits in the task graph; this decides what the call is.

## The case this skill is built from

2026-10-06, Chewbacca's big-work gate (`.claude/hooks/skill-route.sh`) had to
answer one question on every prompt Caleb types: is this big enough to ask
"should I graph engineer?" Four versions shipped in one night:

| version                               | sealed result (12 big, 36 small) | latency           | why it died or won                                                                                                           |
| ------------------------------------- | -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| hand-written verb list                | 7/12 caught, 3/36 false          | 0ms               | the user called it out; data agreed                                                                                          |
| Jev, remote API                       | 12/15 on a self-labeled set      | 300ms             | sent every prompt, pasted texts and health notes included, to a third party from a prompt hook; a security review flagged it |
| llama3.1:8b yes/no                    | 8/12, 4/36, AUC 0.92             | 290ms             | slower and worse than a linear probe                                                                                         |
| logistic regression on embeddinggemma | 9/12, 2/36, AUC 0.94             | ~15ms, hook 0.22s | shipped: local, already-loaded model, 2KB of weights                                                                         |

Every wrong turn was fixed by a measurement, never by an argument. The lessons
below are what those measurements said.

## The order of work

1. **Write the question as a label.** One sentence a person could apply to a
   real input without asking you what you meant. "Multi-step build work, as
   opposed to a question, a complaint, chat or a one-line edit."
2. **Label real inputs before any model sees them.** Pull them from logs and
   transcripts, never invent them. Filter machine traffic out first: on the
   case above, a third of the "prompts" were contact matchers, security
   reviewers and eval harnesses. 100 to 150 labels is enough to choose between
   approaches. Drop the ones you cannot label honestly instead of guessing.
3. **Seal a test split, then work only on dev.** Stratify by label, hold out
   about a third, and score it exactly once, at the end, with every choice
   (model, prompt, C, cutoff) frozen from dev. Self-scored numbers on data you
   tuned against are not measurements (`feedback_seal_the_test_set`: 80% on
   the author's queries, 68% blind).
4. **Try the cheap ladder in order, and stop at the first rung that clears
   the bar.**
   - exact rules, only for a closed vocabulary
   - a linear probe on embeddings from a model that is already loaded
   - a small local LLM with a yes/no prompt, read through logprobs, not text
   - a larger local LLM
   - a remote model, only where the input is not private and the budget allows
     Run at least two rungs on the same dev split. The answer is often lower on
     the ladder than intuition says: the probe beat both LLMs here.
5. **Score with a threshold-free number, then pick the cutoff.** AUC compares
   approaches; the cutoff is a product decision. Sweep it under repeated
   cross-validation and take the knee, stating the cost of each error
   direction. Here a false hit cost one refused tool call and a miss had a
   second net, so the cutoff sat where false hits stopped halving.
6. **Measure latency inside the real caller.** Time the whole hook or
   request, warm and cold, not the model call alone. A cold cache in a scratch
   home made two of four live probes time out, which the warm number hid.
7. **Ship with a parity test and a fallback.** Exported weights must match the
   training framework on every labeled input (float16 here: max diff 2e-5, zero
   flipped decisions). Decide what happens when the model is down: fail open
   with a second net, or fail closed, but on purpose.
8. **Keep a retrain path.** The trainer and labels stay runnable
   (`tools/train_bigwork_probe.py`), private labels stay out of shared repos,
   and the shadow log records each live score so misses become new labels.

## Rules that cost something to learn

- **A hook that sees every prompt never calls a remote model.** Prompts carry
  other people's messages. Local or nothing.
- **Logprobs, not text.** A one-token yes/no read as P(yes)/(P(yes)+P(no))
  gives a score you can threshold and an AUC you can compare. Parsing "BIG" out
  of generated text gives a coin you cannot tune.
- **Reuse the model that is already resident.** The router already kept
  embeddinggemma loaded; a probe on it added 15ms and zero memory. A second
  model adds load time on every cold start.
- **Embedding prefixes are part of the model.** "task: classification" beat
  the router's "task: search result" prefix by 0.03 AUC on the same vectors.
  The trainer and the caller must use the same string, and a test must fail
  when they drift.
- **Ensembles are not free wins.** Averaging the 8B into the probe lowered AUC
  on dev. Measure the blend like any other candidate.
- **A test fake must exercise the real weights.** The suite serves the shipped
  weight vector through a fake Ollama, so a broken export fails CI without a
  model on the box.
- **A test that refuses on purpose isolates its logs.** Run outside the
  runner, the gate's own test wrote 96 refusals into the real hook log and
  turned doctor red.

## Before and after, as a checklist

```
[ ] question written as a label a stranger could apply
[ ] real inputs, machine traffic removed, labeled before any model ran
[ ] sealed test split, scored once, choices frozen from dev
[ ] at least two rungs of the ladder compared on the same split
[ ] AUC for the comparison, cutoff from a repeated-CV sweep with error costs stated
[ ] latency timed in the real caller, warm and cold
[ ] private input never leaves the machine
[ ] parity test between training and shipped inference
[ ] failure mode chosen on purpose, with a second net if it fails open
[ ] retrain command and label location written next to the constants
```

## Related

- `graph-engineering`: where the call sits in the task graph, fan-out, verifiers
- `jev`: typed decisions over text that is NOT private user input
- `.claude/hooks/skill-route.sh` and `tools/train_bigwork_probe.py`: the worked example in code
