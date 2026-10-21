# The fridge: one-page spec

Approved by Caleb 2026-10-07 through multiple choice, with "whatever is most
aura" on the open calls. Everything here comes from his calls on 2026-10-06 and
10-07 (`docs/FRIDGE-NEXT.md`). Anything not on this page is out.

## The page

One rendered kitchen lit for the visitor's real time of day (morning, golden
hour, night). No nav, no logo, no buttons, no copy on the wall. The URL says
Amber. Visitors find the clickable things by looking.

## The rule for every object

The browser never draws anything physical. Every motion is a short clip rendered
in Cycles from the same scene and camera, so light, shadow and paper match the
still. Tap plays the clip forward, tap again plays it back.

Each object has one motion: it slides out from under its magnet, comes toward
the camera, turns over, and the back holds one line from the original homepage
essay in the hand that would have written it.

The held frame is a 3D object floating in the room, never a flat overlay
(Caleb, 2026-10-07, on the old draft's flipped card). Rendered in the scene:
angled a few degrees off square, real thickness and a slight bow, the window's
light and leaf shadows across its face, a soft cast shadow on the fridge behind
it, the room slightly out of focus, and true scale for its size.

Five objects, picked for restraint:

| Object        | Front                                                                                    | Back                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Freezer note  | Punched notebook sheet, hurried ballpoint: "Is there anything beyond the follow button?" | "Not sure if it's a like-minded friend or a well-made bot..."                                     |
| Polaroid      | Five friends                                                                             | "Finding the perfect group for that road trip you've been wanting to take." (silver marker)       |
| Business card | Halden & Rue, furniture makers                                                           | "Met at Maya's party. Needs a designer."                                                          |
| Resume        | Lucia Moreno's resume with a sticky note                                                 | "Introducing your little sister... to your friend's company because you know it'd be a good fit." |
| Prayer card   | Index card in pencil, who to pray for this week                                          | "Talk to God before you talk to anyone else today."                                               |

Cut from the door: greeting card, party plan, print, race bib.

## The room's living bits (ambient, not clickable)

- Wall clock, modelled in the scene, hands as rendered layers turned to the real time
- Steam off the mug in the morning, the lamp on at night
- Pencil height marks under the clock: "Maya 4", "Maya 6", "Theo 7, Aug '21", one crossed out and redone

## The journal on the counter

This is the waitlist. The open page is ruled in two columns, name and number,
like a real guest book. You sign your name with your finger or mouse, drawn in
pen. The number is typed, but it appears as pen ink on the line as you type,
with no visible box. Amber lives in iMessage, so the number is how it reaches
you. On the draft, entries go to a draft-only store, never production.

## The shelf

The encyclopedias become the house's own guest journals, one per year, 2019 to
2025, years in Sharpie on tape, a gap where this year's lies open on the counter.
Pull one and it falls open to a spread of that year's signatures with small
things tucked in (ticket stub, pressed flower, recipe card corner).

## On a phone

A second camera in the same scene, framed portrait on the fridge and counter,
rendered at its own resolution. The desktop render is never cropped.

## Out

Product screenshots, real people's faces, the old essay as paragraphs, the
fridge door opening, the buzzing phone, the seasonal tree, any web panel or side
sheet, any gradient button, visible form fields, sound, the flashlight cursor,
parallax.

## Before the team sees it

- The backs are the old homepage essay, which closely paraphrases Eigen's
  manifesto. Kept for this team draft; flag it when sending.
- Every state screenshotted at 1440 and 390 and read before Caleb sees it.
- Deploys only to the `amber-fridge-draft` Railway project. Never main.

## Before the journal takes real signups

The guestbook is a draft store. Before it collects anything for real it needs
an invisible bot check (Cloudflare Turnstile), an opt-in text the number must
answer before Amber writes to it again, and `TRUSTED_PROXY_HOPS` confirmed
against a logged request on the deployed host.
