# Form

Compiled from research/06 (Baymard, NN/g, GOV.UK, NIST, CXL) and research/07
(WCAG, ARIA).

## The shape

**One column.** CXL, 702 participants: single-column mean completion **102.3s**
vs multi-column **117.8s**, a 13% gap at **p = 0.004**. The only study on the
question with a defensible sample.

**One question per page** by default. Group only when research says so, and the
named exception is an internal tool with trained, repeating users.

**Cut to 8 fields.** The average checkout is 11.3. Every field needs an answer
to: who needs this, and what happens without it. If you cannot answer both,
delete the field.

## Labels

**Above the field, static, always visible.** Top-aligned needs a single eye
fixation, about **50ms** from label to field, against 170-240ms right-aligned
and ~500ms left-aligned.

**Do not bold them.** Bolding pushes that saccade from ~50ms to ~80ms, a 60%
increase.

**Never a placeholder as a label.** Seven independent failures: it strains
short-term memory, the user cannot verify before submitting, error recovery
requires deleting content to re-read the question, keyboard users never pause
long enough, fields containing text get skipped, it reads as a pre-filled
default, and some implementations require manual deletion.

**Never a floating label either.** The two that decide it: long labels truncate,
and error messages get pushed below the input **where the on-screen keyboard and
the autocomplete dropdown cover them.**

Mark **both** required and optional. Only 14% of sites do, and 6% on mobile.

## Validation: reward early, punish late

| Transition | Validate |
|---|---|
| empty to valid | **on submit only** |
| valid to invalid | **on blur** |
| invalid to valid | **on every keystroke** |

Measured baseline for inline vs on-submit: **+22% success, -22% errors, +31%
satisfaction, -42% completion time, -47% eye fixations.** On-blur beat
real-time by seven to ten seconds per form.

**Never validate a field the user only focused and never typed in.**
Participants described it as the form *"yelling at me."*

**Clear the error the instant input becomes valid.** A stale error after a
correction made users doubt correct input and abandon.

**Also trigger on reaching expected length** for ZIP, phone and card number.

## Error copy

**Above the input, below label and hint**, so the keyboard cannot cover it.
Describe what happened **and** how to fix it. Match the wording to the field
label exactly, and to the error summary word for word.

**Banned:** forbidden, illegal, prohibited, "you forgot", valid, invalid, "form
post error", "An error occurred", "This field is required". No apologies, no
humour.

Pair red with an **icon**, so colourblind users get a non-colour signal.

### The error summary

Top of `<main>`, above the `<h1>`, `role="alert"`, **focus moved to it on page
load**, shown even for a single error, each entry linking to the real input id.
For a multi-part input like a date, link to the **first errored sub-field**.

Prefix the page `<title>` with "Error: ".

## Fields

**Password.** NIST reversed a generation of advice and it is normative:
**15 character minimum** (8 within MFA), permit **64**, **no composition
rules**, **no periodic rotation**, blocklist against breached passwords,
**permit paste**. `autocomplete="new-password"` on sign-up (this is what
triggers browser generation), `current-password` on sign-in. **Never
`autocomplete="off"` on a password field**: browsers ignore it to protect
password managers, so the only effect is signalling an intent WCAG 3.3.8 treats
as a failure.

**Name.** One "Full name" field. **42% of users typed their full name into a
"First Name" box**; only 4% hesitated at a single field. No length cap under
~70, full Unicode, no case normalization, no character-class regex, no
profanity filter.

**Address.** Ship automatic lookup, **keep the manual fields visible as a
fallback** (69% of participants fell back to them), rank suggestions by
proximity not alphabetically. **Hide Address Line 2 behind a link**: 30% of
users came to a halt there. Auto-detect city and state from ZIP, rendering them
**below** the ZIP field, triggering on the final digit.

**Card.** Auto-format with spaces matching the printed card, because a 16-digit
unbroken string is much harder to proofread than four chunks. Expiry as
**MM/YY**, two open text inputs rather than dropdowns so a keyboard user can tab
through. Accept "03", "3" and "0429" equivalently.

**Date.** Three text inputs in a `<fieldset>` with a `<legend>`, not a picker,
whenever the user knows the date. **Accept month names**: GOV.UK found hundreds
typing "january", and accepting them dropped errors sharply and specifically
helps users with dyscalculia.

**Never `type="number"`** for phone, ZIP or card. It increments on scroll. Use
`type="text" inputmode="numeric"`.

## Mobile

**Build targets to 48x48 with 8px separation** and every standard is satisfied
at once. 24px is the WCAG 2.5.8 legal floor, not a design target. **66% of
mobile sites place targets too close together.**

| Field | type | inputmode |
|---|---|---|
| Email | `email` | `email` |
| Phone | `tel` | `tel` |
| Card, CVV, ZIP, OTP | `text` | `numeric` |
| Price | `text` | `decimal` |

**Turn off autocorrect and autocapitalize on address and payment fields.**

The on-screen keyboard takes ~50% of the screen in portrait and **70-80% in
landscape**. That is why below-input errors get covered.

## Accessibility

Every control gets a programmatic label. Every group (radios, checkboxes,
dates, name parts) goes in `<fieldset>` with a `<legend>`. On error set
`aria-invalid="true"` and point `aria-describedby` at the message id, with a
visually hidden "Error:" prefix inside it.

**`autocomplete` on every field collecting information about the user.** WCAG
1.3.5 requires it at AA, and Chrome users who autofill complete checkout about
30% faster.

## Never

**Never emit a pre-checked box** for marketing consent, an add-on, insurance, a
donation or a subscription. **DSA Article 25 has been directly applicable
EU-wide since 17 February 2024.** Never write a decline option that disparages
the user. **Show the full price including shipping, tax and fees before asking
for any personal data**, which is the #1 abandonment cause at 48%.

**Never wipe a form on validation failure.** WCAG 3.3.7 Redundant Entry is
Level **A**.

## The failure mode

**A form that validates beautifully and loses the user's work**, because a
server error re-rendered it empty. Persist input before you validate it.
