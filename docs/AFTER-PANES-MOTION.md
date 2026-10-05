# After panes: motion and material

This is the motion and material layer for the design in [AFTER-PANES.md](AFTER-PANES.md). Read that first. It settles what the OS is (an empty center, a three-slot strip, one card on one graph node, an edge rim, a still trail, at most one center surface), and this doc settles how each of those moves.

It's mined from three sites the team built: the Lemma replica, the T Combinator site and the TTS site (usctts.com). All three were read from source and git history, not from screenshots. Fifty-one ideas came out of that. Three critics judged them separately against AFTER-PANES, Caleb's standing lessons, and the question of whether a stranger on a corporate Mac would want it on in week two.

For Caleb, Gavin, Jake and Semyon.

## The one finding

All three sites do the same thing underneath. **One number drives the whole scene, a follower chases it, and every element is a pure function of where the follower is.** Nothing has its own tween. That's why the scenes never come apart, why they play backward for free, and why Caleb said the old TTS pipeline "wasn't just going from thing to thing." The same matter changes state instead of being replaced.

For the HUD the number is the walk, not scroll position. Everything below sits on that.

The critics also agreed on what doesn't carry over. Most of what makes these sites look good is a full-screen field of points with the data drawn as the picture. AFTER-PANES rules that out ("We never draw the graph itself"), a stranger can't read rank from brightness, and a field that never stops drawing can't park the renderer, which is the whole battery answer. The HUD takes the follower, the windows, the morphs and the ordering, and leaves the point fields on the websites.

## What each site does that's worth stealing

Paths are relative to each repo. Lemma is `~/code/work/lemma-replica` at 77b756b. T Combinator is `~/code/work/tcombinator-site` at 6309623. TTS is `~/code/work/TTS-Dev` at 4d70fea.

### Lemma replica

- **One progress value with a follower.** `src/sections/hero-scene.js:35-39, 712-713, 944-986`. Scroll sets a target in 0..1, and `cur += (target-cur)*0.2` chases it, stopping below 8e-5. `render(N)` is the only writer. It works because nothing can desync, the lag gives a flick some weight, and scrolling back reverses everything exactly.
- **Phase windows that sum to one.** `hero-scene.js:41-51, 140-148`, plus the asserted invariant in git `f13a85d` (`presence()`, W = 0.15). Neighbouring states crossfade over a 0.3 band and the code samples 401 points and throws if the opacities don't sum to 1 within 0.01. It was written after two scenes painted over each other in a screenshot Caleb sent. Each state gets a stretch where it's fully legible, and nothing ever shows at half strength.
- **Beats inside a phase, and the corner morph.** `hero-scene.js:742-857`. Bricks go solid to outline, widen, darken, narrow to squares, then lerp their four corners into isometric diamonds. You never see an element replaced, only changed. A shape becoming a shape reads as one thing. A fade between two shapes reads as two.
- **Digit reels.** `hero-scene.js:276-308`, and the odometer in `af983a8^:src/sections/counter.js`. Each digit is its own reel of 11 cells at its own speed. Six speeds read as machinery, and one blur over the whole number reads as a fade.
- **Two clocks.** `src/sections/hero-intro.js:12-123`. Arrival is a 2200 ms timed clock that never reverses. Departure is scroll-driven and reversible. Arrival plays like a performance, and departure stays under your control.
- **Banked clocks.** `src/sections/mesh-gradient.js:282-363`, `app.js:607-671`. Every loop runs only while visible and saves its elapsed time, so coming back resumes it mid-motion. Things that kept their place feel like objects. Things that restart feel like slides.
- **Reserved space and segmented strips.** `src/sections/waterfall.js:240-306`. A spacer holds the height for rows that haven't arrived, so nothing jumps. The current stage fills a 3 px segment only while it's running.
- **dt-based motion with a capped delta.** `src/sections/lower.js:43-62`, `testimonials.js:56-77`. Speed is per millisecond, so 120 Hz doesn't run twice as fast, and the delta caps at 50 ms so a hidden tab doesn't lurch on return.

### T Combinator

- **One persistent point set, morphed by state.** `components/field/engine.ts:704-975`, `formations.ts:1-24`. 6,245 points, one per company, become every scene. Nothing is created or destroyed. The eye never loses an object. The HUD takes the principle and not the points.
- **The 0.2 follower and clamped beat windows.** `components/field/Scene.tsx:46, 420-428`, `engine.ts:66-99`. The same mechanism as Lemma's, with a second, slower 0.08 follower for the camera.
- **Never teleport.** `components/tc/Glide.tsx:1-82`. A move under 2.5 screens is one eased tween. A longer move drifts, fades under a veil, jumps, and settles the last 0.6 screen. Any input cancels it. The threshold comes from a measured 1.85 screens moved in one frame. This is feedback_no_sudden_jumps with a number attached.
- **Five caption grammars chosen by meaning.** `Scene.tsx:21-53, 290-345`. Captions wipe, type, rise word by word, blur or lift depending on what the points are doing. It came from Caleb's note that "the text has the same exact slide in slide out."
- **Fly-to search inside the field.** `engine.ts:977-1008`, and the removed Cmd-K at `8a90382^:components/tc/CommandK.tsx`. Typing lit matches behind the dialog instead of listing them. The HUD keeps "Enter grows the hit into the thing" and drops the field.
- **Line that draws, then stays.** `components/tc/Constellation.tsx:1-27`, and the removed Thread at `7f0f5c7^`. A connection is drawn while you watch and then stays visible. Even if you missed the animation, the line still shows the path.
- **Road with stops that light as a head passes.** `components/tc/sections.tsx:46-127`, `app/site.css:3020-3083`. Each fact on the road shows up when the head reaches it.
- **Rare per-node change on its own clock.** `engine.ts:262-266`. About one floor in seven re-rolls on its own slow beat. When something does live at rest, this is the shape it should take: rare, local, independent. Never a global breathe.

### TTS

- **One store, one follower, frame-rate independent.** `components/tts/grid/store.ts:35-58`, `engine.ts:38-49, 699-764`. The page writes plain numbers, and the engine chases each one with `k = 1-exp(-dt*rate)`, zoom in log space and yaw on the shortest arc. Any input becomes a target the scene leans toward, so a re-aim mid-flight bends instead of restarting.
- **Render on demand.** `engine.ts:42-43, 786-790, 818-823`. A frame draws only while something is still converging. At rest it costs nothing, and that's what allows a full-screen layer to sit behind everything.
- **OKLab colour through a saturated waypoint.** `components/tts/grid/palette.ts:24-160`. A straight navy-to-sky mix measured as #40556c grey mud, so the ground passes through a VIA colour. Text flips at WCAG luminance 0.179, read from the colour actually painted under it.
- **Seams: the object you were looking at becomes the next thing.** `5b9ee5a`, `8596401^:components/tts/home/Seams.tsx:1-125`. A card grows from a 0x0 seed at a projected point, through a centred mid size, onto the real panel's rect, then hands off. This is the grow-in-place the AFTER-PANES judges said the renderer can't do yet, already solved once.
- **X-ray line.** `components/tts/v4/Xray.tsx:13-137`, `Week.tsx:219-330`. A draggable split uncovers how the thing was built. It's an ARIA slider with 5% arrow steps, and it parks on Esc. Someone who never touches it sees nothing different.
- **Spreadsheet rows morph into cards.** `components/tts/v4/Week.tsx:454-480`. Each row interpolates its own rect with a 0.01 stagger. The removed cube field (`2af8262 world.ts:109-160`) added lift, cross and drop lanes so nothing tangles. You can track every item through the regroup.
- **Ordered updates from one loop.** `components/tts/v4/choreo.ts:22-259`. Every target is a pure function of P. It was written after "two paths from input to pixel produced six alignment bugs in one morning."
- **Wavefront along graph distance.** `components/tts/grid/wave.ts:40-158`, `shaders.ts:33-47`. A state change starts where it happened and travels outward along the network. The HUD keeps the ordering and drops the shader.
- **Readouts where every value is computed.** `components/tts/v4/Readouts.tsx:18-158`. Monospace is used only for machine-written values and never as a kicker, which also keeps it clear of feedback_tasteful_editorial_is_the_new_slop.
- **Load clock, inner first.** `components/tts/grid/shaders.ts:100-151`, `components/tts/v4/choreo.ts:279-301`. The scene assembles from its own material from the centre outward, once.

## What already exists in the HUD

There's more here than the judges assumed. `hud/Sources/KyberKit/PresenceField.swift:221` already has `Chase`, an exp(-dt/tau) follower, `Motion.swift` has the named springs, `Morph.swift:17` has `AnimatableVector`, and `Launcher.swift:63` has the one `matchedGeometryEffect`. `FieldPipeline.swift:70` compiles the Metal field at launch with `makeLibrary(source:)`, and there's no `.metal` file in the package on purpose.

That last point decides a lot of what got cut. SwiftUI's `.layerEffect` and `.colorEffect` need a compiled `.metallib`, which needs full Xcode, which the HUD avoids. Any idea that needed a SwiftUI shader on text or a card (vertical reel blur, dot-lattice dissolve, evaporating glyphs) has to either live in the existing MTKView field or go.

## The ideas that survived all three critics

Every one of these names the technique it comes from. Merges are listed so nothing gets rebuilt twice.

**1. The token becomes the card, on one clock.** Pressing "Gavin · 1" doesn't open anything. The strip token is the object that grows into the card, and resolving shrinks it back into a JUST HAPPENED token reading "Sent 9:41, read back." So "did it send?" is answered by where it went, and no toast is needed. Build it as one borderless panel spanning the strip and the card zone, so the morph stays in one SwiftUI tree and needs no cross-panel `matchedGeometryEffect`. The outline is a Shape whose animatable data is four corners (AnimatableVector), interpolated seed to mid to target. Text fades in only after the clock passes 0.7, so words never ride a half-formed shape. One `@Observable DocketClock { target, shown }` is the only writer, and card rect, strip, trail and the field's dim uniform are all pure functions of `shown`. Tests: the partition-of-unity check, and the card rect is continuous in N over 400 samples. From TTS seams, Lemma's corner morph and beats, and the one-follower rule all three sites share. It merges The Mote, Hung from the notch, both "light gathering/dispersing" ideas and Done becomes light. Kept as a solid outline morph, with the particles dropped.

**2. Counts roll, and that's the only idle motion.** "Gavin · 1" rolls to "Gavin · 2". It replaces dock badges and banners and costs nothing at rest. Ship `.contentTransition(.numericText())` first, coalesce to one roll per token per second, and add custom reels only if a recording looks dead. From Lemma's digit reels.

**3. Back and Undo play the clock in reverse.** Because everything is a function of `shown`, Esc and "Undo <verb>" set the target back and the walk replays backward, so you always see what's being undone. The real inverse still comes from `~/.bob/docket-undo.jsonl`, and the motion only shows it. One Esc press is exactly one hop. Outbound acts are excluded, and the card says so. The trail is three still nodes at fixed receding slots (scale 0.8/0.64/0.5, alpha 0.7/0.45/0.25) joined by the segments actually walked, so a missed animation still shows the path. From Lemma's reversible follower and Lemma's partition test, the TTS ordered loop, and T Combinator's drawn Thread. Merges the four trail and rewind ideas, with the comet, braking physics and pulse cut.

**4. The card steps off your caret.** This answers the third AFTER-PANES judge, whose objection to the Docket was the strongest one: a center card over VS Code all day is wrong. Read the caret rect through AX (`kAXBoundsForRangeParameterizedAttribute`, falling back to the focused element's frame), off the main actor with a timeout, polled every 250 ms only while a card is open. Place the card away from it. Move only past 20% overlap, never while typing or while the pointer is on the card, as one Motion.smooth glide that any input cancels. The 35% dim gets a soft hole around the caret, computed in the existing field shader as a falloff (feedback_field_not_geometry), so the line you're writing never darkens. From TTS's dim uniform and pointer falloff, and Lemma's fixed-distance moves on one curve.

**5. Irreversible acts run on a road only real events advance.** A send shows four stops inside the card: Draft, "To Gavin Munroe · iMessage", Go, Read back. The head moves only when a real event lands: draft written, handle re-read, exit code 0, chat.db row found. Go fires on release. Ship uses the same component: Changed, Diff read, /ship sent, CI. CI shows elapsed time as text, never a fill guessed from a median, and on red the same object becomes the BLOCKED card. The Zeutara road ends at "A person sends it, in Clay, as Jonah" and stops there. Drafts stream at arrival speed, Esc stops and keeps what's there, and the status ends "Draft ready. A person sends it." The one overshoot spring is saved for the read-back landing. Test: the head can't reach Read back without a chat.db row. From T Combinator's road with lit stops and Lemma's single reserved overshoot. Merges road, conduit and conveyor.

**6. Search grows the card out of the hyper bar.** The first frame reads "Type a name, a class, or what's due" and names sources that are off. Typing, or voice partials from Voice.swift, runs a local label index with no model (under 16 ms, by test). Matches replace the strip tokens in place, the head match takes the accent, and Enter grows it into the card with idea 1. Every lit thing carries its label. From T Combinator's Cmd-K that lit matches instead of listing them, minus the field and the camera.

**7. Not now lands at a place in time.** The card shrinks into a token that glides to its return time on a small NEXT rail ("tonight 9:00") and grows back the same way when that time comes. Each snooze adds a notch, and the third swaps in Close it and Hand to someone. Positions are recomputed once a minute and chased, so the rail is still at rest. From TTS's readout rail and Lemma's segmented strip for real clocks only.

**8. Provenance under the card.** A visible "Why" verb, with Option-drag and arrow keys as shortcuts, slides a split across the card. Underneath: source text, edge type and confidence, the chat.db row or MailItem text, and the undo entry. Cards on a guess below the 90% bar open with the split already parked at about 12%. This is where the 10-05 "Interested" reply shows up as a Hustle Fund form redirect from an unverified sender. Guessed tokens are a hairline ring, verified ones a solid dot. From the TTS x-ray and T Combinator's instant-then-late readout. Blur and chromatic split on text are cut because they read as a render bug and hurt low vision.

**9. Waiting has a shape.** "lemma · waiting" carries a thin arc on a fixed log scale: a quarter at 5 minutes, half at 15, full at 60. It steps once a minute with a 300 ms ease, then holds still, so the field stays parked. At 15 minutes the item moves to BLOCKED. `WAIT_ESCALATE_MIN = 15` is commented "guessed, never measured." The card still says "Approve it in the session. Kyber never grants permissions." A SurfaceMotionTests case asserts zero frames drawn across 5 s with no new events. From Lemma's real-clock-only segments and T Combinator's rare own-clock change.

**10. Compare grows out of the card.** Open diff slides the real Diff out of the ship card's side. "Compare" regroups two to four tokens into columns with `matchedGeometryEffect` keyed by node id, inside idea 1's panel, and folds them back in order, all under 450 ms. A test keeps Compare the only path to more than one content surface. From TTS's row-to-card morph and the cube field's lanes.

**11. First light, once per install.** On a fresh Mac the strip assembles centre-out in about 2 s. Each ungranted source is a named "Messages not connected" token that is itself the grant button. Persist `~/.bob/first-light-done`. Any input skips it, and Reduce Motion lands the final frame. Build it after Gavin's grants flow exists, and note that Full Disk Access needs a relaunch, so it can't run as one continuous take across that grant. From T Combinator's layered load wipe and TTS's inner-first load clock. This is the 10% novelty AFTER-PANES allows.

**12. An intention is visible on the strip and band.** "WRIT 150 until 11" scopes the queue, silences the other tokens, and shows the scope name plus one rolling minutes-left digit. The band takes that Space's one accent through OKLab with a waypoint, never grey, updated once a minute. The digit carries the information, and the tint stays barely visible. From TTS's OKLab palette and T Combinator's dusk scalar. The aperture that dims everything outside a cluster is cut because it would dim the app where the essay is being written.

**13. Ask about the thing under your cursor.** Hold the talk key with the cursor on a VS Code window, a PR tab or a Messages thread and say "ship this" or "who's waiting on this". `Pointing.element(at:)` resolves it to a node, and the card seeds its morph from that element's AX frame. Its first line names what was resolved ("chewbacca · main · from VS Code window"). Anything it can't resolve says so instead of guessing. Kyber still never runs git. The camera pointing gesture is optional and never the default. From TTS seams (grow from a projected point).

## Kept by two of three

**14. One action, one ordered update.** Kept by critics one and two. When one verb changes several visible values, they update staggered by graph hop from the acted-on node, about 0.12 s per hop, all done in under 0.6 s. "Clear 6 FYI" reads as one event and undoes as one step. It's a BFS in osgraph and a delay per bound value, with no shader. From the TTS wavefront and Lemma's growth by distance. Critic three cut it, because a staggered update adds latency to counts that should just be right and the reel already marks the change. Build it last and keep it only if a recording shows it reads as cause and effect.

**15. Share-safe glass.** Kept by critics one and three. When a share is suspected, every message body and name fades out in 200 ms, tokens drop to counts ("Zeutara · 1"), and a token reads "Hidden while sharing." Critic two cut it, and their reason is a fact. `Overlay.swift:50` records that `sharingType = .none` is ignored by ScreenCaptureKit, and macOS has no public "screen is being shared" API, so detection is a heuristic. So never claim automatic hiding. The guarantee stays the manual hide (Option-Command-Space), and tokens never show bodies anyway. From T Combinator's text sampling and TTS's static echo, with all of the flourish removed.

## How it fits the Docket

AFTER-PANES decides the nouns. This layer decides two things only: how they move and what they're made of.

**Motion.** One DocketClock drives everything. The walk sets its target, `Chase` steps it inside the MTKView draw callback with real dt, and every surface reads clamped windows of it through one `bump()` helper. Moves run on bounce-0 springs at 300 to 500 ms, and exits are shorter than entrances. Far jumps use the Glide rule: past three hops, veil, re-address one hop short, then walk the last edge. Arrival on summon is timed and departure is driven by the clock, so departure stays reversible. Reduce Motion snaps `shown` to `target` and crossfades.

**Rest.** Nothing moves at idle except a digit rolling. The field renders on demand and parks when every Chase settles. That's TTS's render-on-demand, and it's the battery answer.

**Material.** Content sits on the thick, near-opaque material AFTER-PANES already specifies. The field lives in the existing MTKView: the dim uniform, its caret hole, the band's accent and the waiting glow. Colour mixes in OKLab through a waypoint. Text contrast reads the painted ground through `Backdrop.ground(under:)`, never the target state. Every outline uses one dotted stroke style so the line art matches. There's no mesh-gradient weather behind text, no per-type palettes, and the accent has one meaning: Enter or Go goes here.

## Build order

This assumes the AFTER-PANES week-one prototype lands first, because these ideas animate the surfaces that week builds.

| Step | Idea | Effort | Why here |
| --- | --- | --- | --- |
| 1 | DocketClock as the only writer, plus the partition and continuity tests | days | every other idea reads it |
| 2 | Reel counts on `numericText`, coalesced to one roll a second | days | nearly free, already AFTER-PANES day 3 |
| 3 | Token becomes card in one spanning panel, corner morph, dim uniform | a week | the hard Swift, where the 10-04 chunky-loading bug lived, so judge it from a recording of the painted pixels |
| 4 | Esc and Undo in reverse, with the still trail | days | falls out of steps 1 and 3 |
| 5 | Not now on the NEXT rail | days | reuses the step 3 morph |
| 6 | Outbound road for send, ship and Zeutara | a week | mostly wiring real events to the stops |
| 7 | Provenance split with the Why verb | days | the trust guard for the 8 of 12 edge |
| 8 | Waiting arc | days | one Shape, one minute timer |
| 9 | Search grows the card | a week | includes the label index and its 16 ms test |
| 10 | Card steps off the caret | a week | AX reliability across Electron apps and terminals is the real work |
| 11 | Intention on the strip and band | days | needs the OKLab mix in the field |
| 12 | Compare grows out of the card | a week | last of the morphs, highest risk of jank |
| 13 | First light | days | waits for Gavin's grants flow |
| 14 | Share-safe fade | days | a fallback, never claimed as a guarantee |
| 15 | Ask about the thing under the cursor | weeks | resolution logic per app |
| 16 | Ordered update | days | kept only if the recording shows it reads as cause and effect |

## What was cut and why

- Brightness is the queue: it draws the graph, a stranger can't rank by brightness, and the field never parks.
- The Dolly, a camera across a graph plane: it's a zoomable UI, which is the Bederson and Prezi failure.
- Edges with infinite width: the Dock, hot corners and menu bar already own the edges.
- The perimeter is a clock: nobody outside the team can read it.
- Deadlines on a horizon: permanent chrome where the Dock lives.
- Day Scrubber, Time Lens, Undo by scrubbing: demo features, and a scrub release commits by accident.
- Overnight replay on wake: a 1.8 s show before every morning glance gets old in a week.
- The count made of what it counts: a numeral built from points is harder to read than a numeral.
- Weather, not chrome: gradients behind text cost contrast and give colour too many meanings.
- An intention as an aperture, and diving through the card: they dim the real work and cause Prezi motion sickness.
- Agent trails while a session works, and a light that drives to you: motion all day for anyone who runs sessions all day.
- Reply pipeline of light: a dashboard pane under another name, and it only matters for one client.
- Human-pace typing of drafts: artificial latency on real output.
- Things with mass, the card leaning toward the cursor: it moves the text you're reading.
- Head-coupled depth, lean in, distance sets density: they keep the camera light on, which no corporate user accepts.
- Fling it to an edge: hidden gestures that misfire on trackpads.
- Particle bursts, dot-lattice dissolves, words into stars: they need a SwiftUI layerEffect and a compiled metallib the HUD avoids, and they're a demo reel by day three.
- Full-screen wavefront shaders: the nodes they'd reach aren't drawn anywhere.

## The test that shows the motion is decoration

Run the five jobs from AFTER-PANES (reply to Gavin, the WRIT essay, a waiting session, a Zeutara reply, ship to main) twice. Once is the plain Docket with crossfades. The other is this layer. Two strangers who aren't Caleb do each, timed from the recording, plus Caleb across a normal week.

If the strangers finish the five jobs no faster, and make no fewer wrong presses, with the motion on, it's decoration. It's also decoration if Caleb turns it off, sets Reduce Motion, or asks for it quieter within the week. Either result means we cut back to the crossfades and keep only ideas 2, 5 and 8, which carry information rather than movement.
