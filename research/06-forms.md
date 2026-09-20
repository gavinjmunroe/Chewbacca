# Forms, inputs, validation and checkout

Researched 2026-09-20 across Baymard, NN/g, GOV.UK, W3C, WHATWG, NIST, Luke
Wroblewski, Adam Silver, CXL, the FTC and EU instruments.

**Read section 0 first.** Three of the most-cited rules in this field are
genuinely disputed by good researchers, and a generator that silently picks
one will be wrong for half its users.

## 0. Where the authorities disagree

| Question | NN/g | Baymard | Adam Silver / GOV.UK |
|---|---|---|---|
| Mark required or optional? | mark **required** with `*` | mark **both**; only 14% of sites do | mark **optional** only, or delete the field |
| When to validate? | on blur | on blur, or on reaching expected length | **on submit only.** No live validation |
| Label alignment | (Penzo's eye-tracking favoured **right**-aligned) | **above** the field | **above**, always static |

**Default: mark both, validate on blur with reward-early/punish-late, top-align
labels.** That combination loses the fewest arguments and has the largest
supporting samples behind it.

## 1. Field count and abandonment

**Cut checkout to 8 fields.** Baymard's 2024 benchmark: the average US checkout
is **11.3 fields across 5.1 steps**; their stated ideal is **8**. Counting
checkboxes, selects and radios, the average shows **23.48 form elements**
against an ideal of **12**. A **20 to 60% reduction** is typically available.

**Baseline cart abandonment is 70.22%**, averaged over 50 studies.

### Why people leave, ranked

| Reason | Share |
|---|---|
| **Extra costs too high** (shipping, tax, fees) | **48%** |
| Site wanted me to create an account | 24% |
| Delivery too slow | 22% |
| Didn't trust the site with card info | 18% |
| Checkout too long or complicated | 17% |
| Couldn't see total cost up front | 16% |
| Site had errors or crashed | 13% |
| Unsatisfactory returns policy | 12% |
| Not enough payment methods | 9% |

"Just browsing" is excluded. **The top cause is a pricing disclosure problem,
not a form problem**, and it is also an FTC material-terms requirement.

Baymard's research base: **200,000+ hours**, 272 moderated think-aloud
sessions, 9 quantitative rounds with 11,777 participants, 344 benchmarked
sites. Average achievable lift from checkout redesign alone: **35.26%**,
against an average of **39 usability issues** per checkout.

**Offer guest checkout and make it prominent.** 24% abandon over forced
accounts, **44% of sites** hide the guest option, and **60% of mobile test
subjects** struggled to find it. **84% of sites** fail to offer account
creation *after* the order instead of before.

**One column.** CXL, 702 desktop participants: single-column mean completion
**102.3s** vs multi-column **117.8s**. A 13% gap at **p = 0.004**. This is the
only study on the question with a defensible sample.

## 2. Labels

**Above the field, static, always visible.** Penzo's eye-tracking measured a
label-to-field saccade of about **50ms** for top-aligned, against 170-240ms
right-aligned and ~500ms left-aligned. Sample size unpublished, so treat the
ranking as directional.

**Do not bold labels above fields.** Penzo measured bolding pushing that
saccade from ~50ms to ~80ms, a **60% increase**.

**Left-align only when you want users to slow down** on unfamiliar data.

### Never use a placeholder as a label

NN/g's seven independent failures: it **strains short-term memory**; users
cannot **verify** their answer before submitting; **error recovery** requires
deleting the content to re-read the question; **keyboard users** never pause
long enough to read it; eye-tracking shows fields containing text get
**skipped**; users mistake it for a **pre-filled default**; and some
implementations require manual deletion.

On top of that, placeholder contrast usually fails WCAG and screen readers may
not announce it at all. If one ships anyway:
`::placeholder { color: #767676; opacity: 1; }`.

### Do not use floating labels either

Eight documented failures. The two that decide it: **the label truncates when
long**, and **error messages get pushed below the input where the on-screen
keyboard and the autocomplete dropdown cover them.** At a legible size it also
saves no vertical space.

### Hint text

One short sentence, no full stop, between label and input, wired with
`aria-describedby`. **Never put a link in a hint**: screen readers give no
indication it is clickable. Put format requirements **in the label** where
short enough. Put instructions **before the `<form>` element**, because screen
readers switch into Forms Mode at the boundary and can skip text after it.

## 3. Validation

**The measured baseline.** Wroblewski/Etre, 22 participants, six variants.
Inline validation against on-submit: **+22% success, -22% errors, +31%
satisfaction, -42% completion time, -47% eye fixations.**

**Fire on blur, not on keystroke.** On-blur beat real-time by **seven to ten
seconds** per form. A participant on before-and-while validation: *"It's
frustrating that you don't get the chance to put anything in before it's
flashing red."*

**Exception: validate while typing for genuinely uncertain fields**, such as
username availability and password rules.

### Reward early, punish late

The most implementable rule in the domain.

| Transition | Validate |
|---|---|
| empty to valid | on submit only |
| valid to invalid | **on blur** (punish late) |
| invalid to valid | **on every keystroke** (reward early) |

No controlled study backs the state machine directly; it is a synthesis of the
on-blur evidence.

**Clear an error the instant input becomes valid.** Baymard watched users doubt
correct input and abandon when a stale error persisted after correction.

**Also trigger on reaching expected length** for ZIP, phone and card number.

**Never validate a field the user only focused and never typed in.**
Participants described this as the form *"yelling at me."* **31% of ecommerce
sites** have no inline validation and 4% implement it wrongly.

**Never reject legitimate input.** Accept spaces, dashes, mixed case and
punctuation, then normalize server-side. Over-strict validators rejecting real
addresses, names and cards are a named abandonment cause.

### Error copy

Put the message **above the input, below label and hint**, so the keyboard and
autocomplete dropdown cannot cover it. Describe what happened **and how to fix
it**. Match the wording to the field label exactly, and match inline text to
the summary word for word.

**Banned words:** forbidden, illegal, prohibited, "you forgot", valid, invalid,
"form post error", "unspecified error", "An error occurred", "This field is
required". No apologies, no humour.

**Pair red with an icon**, so colourblind users get a non-colour signal.

## 4. Field types

### Password: NIST reversed a generation of advice

SP 800-63B-4 §3.1.1 is normative. Encode exactly:

| Rule | Strength |
|---|---|
| **15 characters** minimum, single-factor | SHALL |
| 8 characters minimum within MFA | SHALL |
| Permit at least **64** | SHOULD |
| **No composition rules.** No "must contain a symbol" | **SHALL NOT** |
| **No periodic rotation.** Force change only on evidence of compromise | **SHALL NOT** |
| Compare against a breached-password blocklist | SHALL |
| **Permit paste** | SHOULD |
| Offer show-password | SHOULD |
| **No password hints. No security questions** | SHALL NOT |

`autocomplete="new-password"` on sign-up (this is what triggers browser
generation), `current-password` on sign-in, `one-time-code` on 2FA.

**Never `autocomplete="off"` on a password field.** Browsers ignore it there to
protect password managers, so the only effect is signalling an intent that
WCAG 3.3.8 treats as a failure.

### Names: use one "Full name" field

**42% of users typed their full name into a "First Name" box.** Only **4%
hesitated** at a single full-name field. **89% of sites** do not offer one.

McKenzie's falsehoods, the load-bearing ones: people have exactly N names;
names fit a defined space; names do not change; names are ASCII; names are
case sensitive / case insensitive; names contain no numbers; first and last
names are necessarily different; everyone has a family name; a bad-word
dictionary contains no real names.

**Encoding: one field, no length cap under ~70, full Unicode, no case
normalization, no character-class regex, no profanity filter.**

### Address

**Ship automatic address lookup. 55% of sites lack it**, and without it **9% of
manually entered addresses contain typos.** Three rules: match on fuzzy input,
**keep the manual fields visible as a fallback** (69% of participants fell back
to them), and rank suggestions by geographic proximity rather than
alphabetically.

**Hide "Address Line 2" behind a link. 30% of users came to a halt there**,
several second-guessing whether Line 1 was right. Only 20% of sites hide it.

**Auto-detect city and state from ZIP.** Render them *below* the ZIP field,
trigger on the final digit rather than on blur, always allow override.

### Credit card

**Auto-format with spaces matching the printed card. 51% of sites do not and
15% actively forbid spaces.** The reason is proofreading: a 16-digit unbroken
string is much harder to check than four chunks matching the physical card.

**Expiry as MM/YY. 72% of sites fail to match the card face.** Prefer two open
text inputs to dropdowns so a keyboard user can tab straight through. Accept
"03", "3" and "0429" equivalently.

**Size fields to their content.** A 14-character CVV box or a 50-character
email box made subjects question whether they had misread the label. Baymard
rated the effect on overall form usability "surprisingly big."

### Date

**Three separate text inputs in a `<fieldset>` with a `<legend>`, not a date
picker**, whenever the user knows the date. **Accept month names**: GOV.UK
found hundreds of users typing "january" or "jan", and accepting them dropped
error rates sharply and specifically helps users with dyscalculia.

**Show only the highest-priority error**, in order: missing, then impossible,
then failed business rule. Highlight only the sub-field in error.

### Field width

1. Fixed-length input gets **exact width** (year = 4, CVV = 4).
2. Variable input with a standard average gets one consistent default. The
   normal boundary is **18 to 33 characters**.
3. Variable input with an unusual average gets a custom width.

**Never `type="number"`** for phone, ZIP or card: it increments on scroll. Use
`type="text" inputmode="numeric"`.

## 5. Autofill

**Set `autocomplete` on every field collecting information about the user.**
Chrome users who autofill successfully complete checkout **about 30% faster**,
and **WCAG 1.3.5 (AA) requires it.**

Grammar: `[section-* ] [shipping|billing] [home|work|mobile] <field-name>`

Most-used tokens: `name`, `given-name`, `family-name`, `username`,
`new-password`, `current-password`, `one-time-code`, `street-address`,
`address-line1/2`, `address-level1` (state), `address-level2` (city),
`postal-code`, `country`, `cc-name`, `cc-number`, `cc-exp`, `cc-exp-month`,
`cc-exp-year`, `cc-csc`, `bday`, `bday-day`, `bday-month`, `bday-year`, `tel`,
`email`, `url`, `organization`.

**Do not rely on `name` or `id` to drive autofill.** Prefix with `shipping` or
`billing` when a page has both. **Reserve `autocomplete="off"` for one-time
codes and honeypots.** Style the filled state with `:autofill` rather than
fighting the browser's yellow.

## 6. One thing per page

**Default to one question per page.** GOV.UK's stated benefits: users
understand what is asked, focus on one answer, navigate unfamiliar processes,
use it on mobile, and recover from errors. Provider side: automatic per-page
saving, per-question analytics, branching and loops.

**Group only when research says so.** The named exception is an internal
service with trained, repeating users.

**Ask eligibility questions first**, so an ineligible user is turned away
before filling anything in.

**Apply a question protocol:** for every field, name who needs the answer and
what happens without it. If you cannot answer both, delete the field.

**Label the submit button with a verb.** "Continue", "Pay now". Never "Submit".

## 7. Multi-step and progress

**Do not add a step-count progress indicator by default.** GOV.UK's Carer's
Allowance team removed a **12-step indicator with no negative effect**.
**[UNVERIFIED: the original post is 404 and no figures were published]**

**Determinate bars only when the denominator is real.** Users shown a moving
progress bar waited **3x longer** before giving up than users shown nothing.
Spinner for 2-9 seconds, percent-done for 10 seconds and over.

**End every multi-step form with a check-answers page.** It carries a title
naming the action, grouped sections showing only the branches taken, a
statement that the transaction is not complete, and per-row "Change" links with
visually hidden text that return to the check page rather than restarting.

**This is also how you satisfy WCAG 3.3.4 (AA)** for legal and financial
commitments.

**WCAG 3.3.7 Redundant Entry is Level A**, which makes "billing address same as
shipping" an obligation rather than a nicety, and **makes wiping a form on
validation failure a conformance failure.**

## 8. Mobile

| Standard | Minimum | Spacing |
|---|---|---|
| **WCAG 2.5.8** (AA) | **24x24 CSS px** | or 24px circles on centres must not intersect |
| WCAG 2.5.5 (AAA) | 44x44 CSS px | |
| Apple HIG | 44x44 pt | **[UNVERIFIED, page is JS-rendered]** |
| Material / Android | **48x48 dp** | 8dp separation |

**Build to 48x48 with 8px separation** and all four rows are satisfied at once.
24px is a legal floor, not a design target.

**66% of mobile sites place tappable elements too close together; 32% have
elements that are too small.**

**Set the right keyboard. 61% of mobile sites do not.**

| Field | type | inputmode |
|---|---|---|
| Email | `email` | `email` |
| Phone | `tel` | `tel` |
| Card, CVV, ZIP, OTP | `text` | `numeric` |
| Price | `text` | `decimal` |
| Search | `search` | `search` |

**Turn off autocorrect and autocapitalize on address and payment fields.**

**The on-screen keyboard takes ~50% of the screen in portrait and 70-80% in
landscape.** That is why below-input error messages get covered.

## 9. Dark patterns, now illegal in the EU

**DSA Article 25 has been directly applicable EU-wide since 17 February 2024:**
providers "shall not design, organise or operate their online interfaces in a
way that deceives or manipulates."

Prevalence: **over 10% of 11,000 ecommerce sites** and **95% of 240 trending
free Google Play apps**, over half averaging **7 patterns per app**.

**The FTC's Click-to-Cancel rule** requires a cancellation mechanism as simple
as sign-up. **[UNVERIFIED: litigated since announcement, check current status]**

### Generator rules

1. **Never emit a pre-checked box** for marketing consent, a paid add-on,
   insurance, a donation or a subscription.
2. **Never write a decline option that disparages the user.** "No thanks".
3. **Cancel path gets the same number of steps as sign-up.**
4. **Show the full price including shipping, tax and fees before asking for any
   personal data.** This is the #1 abandonment cause at 48% and an FTC
   requirement.
5. **Equal visual weight** on decline and accept. No ghost-button decline
   against a filled accept.
6. **Never add anything to a cart the user did not choose.**

## What could not be verified

Apple's 44x44pt (JS-rendered page); the Carer's Allowance figures (404);
GOV.UK's save-and-resume pattern (404); several Baymard article bodies
(paywall interstitial, findings via search summaries of their own pages); the
FTC dark-patterns PDF; and the current enforceability of Click-to-Cancel.
