# Empty state

Compiled from research/02 (NN/g, Shopify Polaris), research/12 (subtraction),
research/13 (prototypicality).

## Say which of the three it is

**Loading, error, or genuinely no data.** They look identical and mean
opposite things, and getting it wrong sends the user to support for a problem
that would have resolved in 800ms.

| | Say | Offer |
|---|---|---|
| **Loading** | nothing under 2s, then a skeleton | nothing |
| **Error** | what failed, in human language | retry, and a way out |
| **No data yet** | what this will hold | the action that creates the first one |
| **No results** | what was searched and how many filters are on | **clear the filters**, and a broader query |

**The last two are different states and most implementations ship one.** "No
invoices yet" and "No invoices match 'acme' with 3 filters" need different
copy and different buttons.

## Copy

**Forward-looking heading.** "Create your first invoice", never "You haven't
added any invoices yet." The second describes a deficiency; the first
describes an action.

**No jokes.** NN/g's research on no-results pages found humour *"reads as
mockery to someone who is already stuck."*

**Lead the button with a strong verb.** Write subtitles conversationally,
articles included.

## Layout, the only published pixel values in the field

From Shopify Polaris:

| | |
|---|---|
| Text container | `max-width: 450px` |
| Illustration | `200 x 200px` maximum |
| Whitespace above, when nested | `40px` |
| Actions | one primary, optional secondaries |

## Teach something

NN/g calls empty states **"pull revelations"**: they appear when the user
engages, which makes them more memorable than a forced tutorial. The empty
state is the best onboarding surface you have, and it costs nothing because
the space is already blank.

**But keep it to one idea.** research/13: prototypicality's benefit is
destroyed by clutter, `d = 1.96` at low complexity falling to `d = 0.24` at
high. A busy empty state buys nothing.

## The one everyone ships broken

**Rendering the empty state before data arrives**, which flashes "No results"
for the length of the fetch. Raycast names it as their single most common
extension bug. **Check the loading flag first, always.**

## The failure mode

**An empty state that is beautiful on the first run and useless on the
hundredth**, because it still says "Create your first invoice" to someone who
has 400 and filtered them all out. Branch on no-data versus no-results.
