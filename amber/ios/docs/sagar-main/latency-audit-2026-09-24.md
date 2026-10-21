# Amber latency audit — September 24, 2026

The largest measured remaining search cost was repeated normalization of every contact's context on every keystroke. Caching that work reduced a warmed search layout from **31.070 ms to 0.246 ms median** for 2,267 synthetic contacts.

## Measurements and limits

These are **Mac Node 22.14.0/V8 microbenchmarks**, not Hermes measurements, native frame rates, network latency, or tap-to-display timings. Each layout measurement used 10 warm-up runs and 60 timed runs. No real contact data was transmitted.

| Workload | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Nonempty search layout, warmed index | 31.070 / 31.851 ms | 0.246 / 0.411 ms |
| Empty-query layout | 0.225 / 0.416 ms | 0.140 / 0.335 ms |
| Viewport filtering | 0.017 / 0.022 ms | Unchanged |

Fixture: 2,267 `Person N` entries, subtitle `Designer hiking friend`, context `Family work school hiking memories ` repeated 20 times, query `hiking family`, viewport 390 × 520. The initial viewport renders 73 contacts.

A first synchronous index build cost **37.017 ms**. Index warming now runs after rendering in cancellable idle slices, with a 32-contact limit and 2 ms CPU target per slice. The measured warmup used **71 slices: p95 0.662 ms, maximum 1.075 ms CPU**. This excludes time waiting for idle callbacks. One unusually large contact can exceed the target because the budget is checked between contacts. Searching before warming completes can still incur remaining indexing work.

Reproduce the synthetic, network-free benchmark from `apps/mobile`:

```sh
/usr/local/bin/node scripts/benchmark-network.mjs
```

Results vary with runtime and machine load. The previously recorded September 23 simulator result of 679 → 20 ms measured a different, empty-query workload; it is not comparable with this V8 table.

## Changes made

- **Search:** parse query terms once, cache normalized fields with weak object keys, and invalidate on name, subtitle or context changes. Same-ID contacts from different accounts cannot reuse one another's text. Derived demo contact lists retain stable references. Idle work cancels when contacts change or the component unmounts; a guarded timer fallback supports clients without idle callbacks.
- **Globe:** cache static latitude/longitude coordinates. Stop rotation and gestures when the app is inactive or backgrounded; the host also pauses it behind recording, review, account sheets and the map. Visible rotation still uses JS/React updates every 40 ms. Pausing hidden work does not establish 60 fps performance.
- **Graph crash:** snapshot `width` and `height` before calling the functional state updater. React Native can release the layout event before that updater executes. Two regression tests run the actual callback, clear `nativeEvent`, then execute the deferred updater; they also verify hidden and unchanged viewports preserve state identity.
- **Recording:** remove the demo's 350 ms modal handoff and three artificial 650 ms processing stages. Recording and review now share a stable surface. Original audio is preserved before transcription. Missing historical originals no longer block saving new recordings; their saved text and metadata remain available with a per-note warning.
- **Engine:** demo and native validation configuration now specify **Hermes**. The previous `jsc` setting did not match React Native 0.81's removal of bundled JSC, and the community JSC dependency was absent. This corrects build configuration; no engine-to-engine performance comparison was measured.

Verification covered 33 search/layout tests, the two pooled-event regressions, and 13 local persistence tests. The journal subset had 21 passing tests including sync/retry checks. These are logic and storage-contract tests, not microphone quality or physical-device reliability tests. Full TypeScript passed in the fully local native staging checkout. Processing verification additionally exercised owner isolation and duplicate prevention in scratch PostgreSQL; it did not establish new microphone-to-production end-to-end performance.

## Development versus shipped performance

Desktop source files repeatedly became iCloud `compressed,dataless` placeholders. One first read of `DemoGlobe.tsx` took about 1.17 seconds; later typechecks stalled waiting for hydration. Those delays affect Metro, reloads and builds, not packaged-app network latency. Keep the running checkout and dependencies fully local. The native validation staging project at `/private/tmp/amber-sept24-ios` generated its iOS project offline from Expo's bundled template in 1.18 seconds.

The source code changes and microbenchmarks do **not** establish App Store readiness or a frame-rate claim. Release-build measurements on an actual iPhone remain necessary.

## Next profiling priorities

1. Measure p50/p95 for tap → feedback, tap → recording started, stop → durable local save, stop → transcript, and stop → proposed actions. Record stage names, durations, byte counts and status codes only; exclude audio, transcripts, names and credentials.
2. Test cold-start typing before indexing finishes with a large real-sized address book. Defer expensive result updates if needed while keeping text entry immediate.
3. Profile visible globe interaction with native frame tools. The baseline pure projection cost was 0.482 ms median / 0.645 ms p95 for 1,917 points and 31 SVG paths, excluding React/native drawing. Move projection/rendering to UI-thread or Skia work only if measured dropped frames justify it; increasing the JS timer rate alone adds work.
4. Virtualize long memo history and lazily load audio players. The current feed maps its cards inside a ScrollView, which will scale poorly to hundreds of recordings. Avoid rewriting or revalidating an entire archive for every small edit.
5. Separate upload, transcription-provider, fallback and action-preparation timings. An increased timeout improves reliability, not speed. Validate cancellation, offline recovery, backgrounding, interruptions and rapid double taps. Never hide provider latency with a fake completed state or speculative duplicate writes.

Suggested acceptance targets—not measurements—are visible press feedback within 100 ms and stable 60 fps interaction on supported devices. Test the full recording/relaunch/playback path and confirmed contact/calendar writes separately from visual smoothness.


## Calendar and Community iteration — October 3, 2026

The Calendar now uses a full month grid, a civil-date year progress divider, and a virtualized chronological event/recording feed. Today, previous/next month, selected dates, existing event details, and Google event creation remain available. The existing Google connection supplied real events in the simulator. No new event was created during this iteration.

Calendar device events, Amber events/reminders, recordings and shared notes publish independently. A slow feed no longer holds up the agenda. A bounded, component-local cache retains up to 14 viewed days (including partial responses), uses a 60-second freshness window, and revalidates after writes or explicit refresh. Abort signals cancel obsolete server requests; late results cannot populate the next day. Failed sources retain their cached section. Contact cards likewise publish facts, rank and details independently instead of waiting for all four requests. Membership filtering uses a Set.

Community has direct All/six-category/Nearby controls and a virtualized searchable member picker. Manual contact creation uses authenticated POST /v1/me/contacts/create with no owner or handle supplied, requires a name plus phone/email, does not automatically retry the write, and refreshes the canonical server card. Membership saves ignore inbound circles. Draft selections survive opening and cancelling the new-contact form.

The center capture control is outside the native GlassView hit region. Tap opens the existing voice/text/file capture surface; upward drag is implemented with UI-thread feedback and an explicit voice target. The accessible record action opens recording directly. File capture retains the existing supported formats and review-before-write behavior (one attachment per capture). No personal circle membership, contacts or capture results were written during UI verification.

Measured production Railway HTTP logs from the preceding 30 minutes (small observational sample, not a before/after benchmark): contacts returned 1,333,710 bytes for 2,927 rows, 339–1,808 ms across four requests; contact-ranks returned 307,825 bytes, 320–1,773 ms across four requests; agenda was 299 and 1,063 ms; shared feed was 310 and 1,060 ms. These are server/edge request durations, not tap-to-render measurements. Next backend performance work should reduce the full contact/rank payloads and profile their queries; do not claim this UI pass changed server latency.

Verification: TypeScript and 535 mobile tests passed, including independent load completion, failed refresh preservation, stale-date suppression, leap-year/year-end counts, deliberate voice-drop boundaries, and authenticated manual-create success/failure. Simulator checks covered real event display, date selection, creation-sheet opening, tap-to-capture, category selection, member search and selection, new-contact form, and preserved draft selection after cancellation. Automated mouse drags did not reliably exercise a continuous touch gesture; the upward voice drag still needs physical-device acceptance before release. A temporary development reload stall was sampled; by the sample the main and JavaScript threads were idle, so its cause was not established. This is not evidence of a fixed CPU bottleneck.

This iteration has not been uploaded to TestFlight. Previously uploaded 1.0.1 (2) does not contain these changes.

A follow-up rendering fix replaced the large native border-radius ring views with animated SVG circles drawn into a viewport-sized SVG surface. The complete network remains navigable; no contacts were removed or limited. A fresh simulator run with this change measured 268.1 MB physical footprint / 291.7 MB peak, versus 405.6 MB / 1.8 GB peak in the earlier session. This is an observational comparison across different session histories, not a controlled memory benchmark. Family-to-All switching and all 2,927 contacts rendered after the change. TypeScript and all 535 tests still pass. The direct accessible record action also opened the recorder and was cancelled without saving or processing.
