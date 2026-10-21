"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { WaitlistForm } from "@/components/WaitlistForm";

// Four distinct amber specimens around a geode centre. The centre entry is the
// hero: it is only a grid spacer (see [data-centre]), but the fullscreen clip
// layer MUST be this same image, since the whole illusion is that one becomes
// the other and a mismatch shows as a seam at the end of the morph.
const SLIDES = [
  "gem-1.jpg",
  "gem-2.jpg",
  "hero-painting.jpg",
  "gem-3.jpg",
  "gem-4.jpg",
];
const CENTRE = 2;
const HERO = SLIDES[CENTRE];

const TITLE = "amber";

// Stagger, in units of scroll progress, applied per step away from the centre.
const SLIDE_STAGGER = 0.08;
const CHAR_STAGGER = 0.06;

/**
 * THREE ACTS ACROSS ONE SCRUB, AND THEY OVERLAP.
 *
 *   0.00 - 0.44  the hero morphs into the specimen row
 *   0.32 - 0.56  the essay card rises over the row
 *   0.68 - 1.00  the waitlist sheet rises over the card
 *
 * THE CARD STARTS BEFORE THE MORPH FINISHES, at 0.32 of a morph that runs to
 * 0.44 -- so it is already on its way up while the wordmark is still
 * collapsing, rather than waiting for an empty row to finish forming. Acts
 * that butt up against each other read as a list of things; acts that overlap
 * read as one movement.
 *
 * The morph itself is nearly half again as long as it was. At 60svh it landed
 * so abruptly it was unpleasant -- the whole hero snapped away inside half a
 * flick. The distance is the fix, not the easing.
 *
 * What got shorter is the wait AFTER the card: 24svh of hold before the sheet
 * starts, down from 36.
 *
 * THE FIRST VERSION PUT A LONG PAUSE WHERE NOTHING HAPPENED. The morph ran to
 * 0.40 of a 560svh scrub -- over two screens of scrolling -- and the card did
 * not start until 0.46, so the finished row of specimens just sat there while
 * you kept scrolling at nothing. The wordmark's last letter collapses exactly
 * at the end of the morph, so that is the moment the next thing has to arrive.
 * It now starts two hundredths later, which at this scrub length is about a
 * fifth of a screen: one scroll.
 *
 * The rest between the card landing and the sheet starting is the one pause
 * worth keeping -- it is where the essay is actually read. The card stays put
 * once up; the sheet rises OVER it, which is why its edge is still visible
 * behind the waitlist.
 */
const MORPH_RANGE = 0.44;
const CARD_START = 0.32;
const CARD_END = 0.56;
const SHEET_START = 0.68;

/**
 * THE ESSAY IS FITTED, NOT GUESSED.
 *
 * The card must never scroll, which means the type has to be whatever size
 * makes 350 words fit the card on this screen. That number depends on the
 * viewport in both directions at once, on how many lines the title wraps to,
 * and on the font actually in use -- three breakpoints guessed by hand got it
 * wrong on a 1440x900 laptop twice. So the component measures instead: eight
 * halvings between the bounds below, which is exact and costs one layout pass
 * on mount and on resize.
 *
 * ESSAY_MIN is a floor, not a target. If the essay will not fit even at 11px
 * -- which happens on a phone held sideways, where the honest answer is about
 * 8px -- the card is allowed to scroll rather than ship type nobody can read.
 */
const ESSAY_MIN = 11;
/**
 * 27, up from 18. The card is wider now and the title is a third of the size
 * it was, which between them freed enough of the box that 18 became a ceiling
 * the fitter was hitting rather than a bound it was searching inside -- a
 * 1728-wide laptop was pinned at 18 with room for 26.
 */
const ESSAY_MAX = 21;
/**
 * NO SLACK TERM HERE, AND IT IS NOT AN OVERSIGHT.
 *
 * Fitting to `clientHeight - 14` so the last line never lands flush looks
 * obvious and cannot work, because the card's height is auto. Below the cap
 * the card hugs its content, so clientHeight and scrollHeight are the same
 * number and `scrollHeight <= clientHeight - 14` is false at every size; at
 * the cap the content by definition fills it, so it is false there too. The
 * test never passes, the bisection chases a target that moves with the font
 * it is setting, and the essay collapses -- measured at 14.8px on a 1440
 * laptop that should read 22.
 *
 * The air under the last line is padding, in the stylesheet, where it is a
 * fixed number rather than a feedback loop.
 */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * power2.inOut rather than the power4 the original GSAP timeline used.
 *
 * Quart is very slow at both ends and very fast through the middle, which on a
 * scrub reads as the image sitting still and then lunging. Cubic covers the
 * same distance with less of a whip in the middle -- the same choreography,
 * less startling.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// The sheet is a physical object being pushed up: decelerate, never overshoot
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Progress for an element that starts `delay` into the timeline
function staggered(progress: number, delay: number): number {
  if (delay >= 1) return 0;
  return clamp01((progress - delay) / (1 - delay));
}

export function ScrollClipStage() {
  const scrubRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrubRef.current || !stageRef.current) return;

    // Bound after the guard so the closures below see non-nullable elements
    const scrub: HTMLDivElement = scrubRef.current;
    const stage: HTMLDivElement = stageRef.current;

    const slides = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-slide]"),
    );
    const chars = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-char]"),
    );

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Reduced motion: land on the end state and never listen to scroll
    if (reduce.matches) {
      apply(1);
      fitEssay();
      return;
    }

    /**
     * Find the largest type that fits the card, by bisection.
     *
     * clientHeight is the card's height after its max-height cap; scrollHeight
     * is what the content wants. When the second exceeds the first the essay
     * would have to scroll, which is the thing being designed out.
     */
    function fitEssay() {
      const inner = stage.querySelector<HTMLElement>(".stage-card-inner");
      const body = stage.querySelector<HTMLElement>(".stage-card-body");
      if (!inner || !body) return;

      let lo = ESSAY_MIN;
      let hi = ESSAY_MAX;
      let best = ESSAY_MIN;
      // Nine halvings, not eight: the range is 16 points wide now rather than
      // 7, and eight of them would leave the answer a good third of a point out.
      for (let i = 0; i < 9; i += 1) {
        const mid = (lo + hi) / 2;
        body.style.fontSize = `${mid.toFixed(2)}px`;
        if (inner.scrollHeight <= inner.clientHeight) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      body.style.fontSize = `${best.toFixed(2)}px`;
      // Did even the floor fail? Then let it scroll. See ESSAY_MIN.
      inner.dataset.overflows = String(inner.scrollHeight > inner.clientHeight + 1);
    }

    let frame = 0;
    let queued = false;

    // `full` is 0..1 across the whole scrub: the morph over the first
    // MORPH_RANGE, the essay card between CARD_START and CARD_END, the sheet
    // over the tail after SHEET_START.
    function apply(full: number) {
      const p = easeInOutCubic(clamp01(full / MORPH_RANGE));
      const card = easeOutCubic(
        clamp01((full - CARD_START) / (CARD_END - CARD_START)),
      );
      const sheet = easeOutCubic(
        clamp01((full - SHEET_START) / (1 - SHEET_START)),
      );

      stage.style.setProperty("--p", p.toFixed(4));
      stage.style.setProperty("--card", card.toFixed(4));
      stage.style.setProperty("--sheet", sheet.toFixed(4));
      // Only take pointer events once each surface is essentially in place
      stage.dataset.card = card > 0.9 ? "open" : "closed";
      stage.dataset.sheet = sheet > 0.9 ? "open" : "closed";

      slides.forEach((slide, i) => {
        const delay = Math.abs(i - CENTRE) * SLIDE_STAGGER;
        slide.style.setProperty("--sp", staggered(p, delay).toFixed(4));
      });

      chars.forEach((char, i) => {
        const delay = Math.abs(i - (chars.length - 1) / 2) * CHAR_STAGGER;
        char.style.setProperty("--cp", staggered(p, delay).toFixed(4));
      });
    }

    function read() {
      queued = false;
      // Rect is read once per frame so the scrub survives any layout change
      const rect = scrub.getBoundingClientRect();
      const distance = rect.height - window.innerHeight;
      if (distance <= 0) return apply(0);
      apply(clamp01(-rect.top / distance));
    }

    function onScroll() {
      if (queued) return;
      queued = true;
      frame = requestAnimationFrame(read);
    }

    // will-change only while the stage is on screen: leaving clip-path
    // promoted permanently costs memory for no gain
    const io = new IntersectionObserver(
      ([entry]) => {
        stage.dataset.active = String(entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(scrub);

    fitEssay();
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    /**
     * ResizeObserver rather than the resize event alone: the card's box also
     * changes when the URL bar on a phone slides away, which resizes the
     * visual viewport without firing a window resize in every browser.
     */
    const ro = new ResizeObserver(() => fitEssay());
    const cardEl = stage.querySelector(".stage-card");
    if (cardEl) ro.observe(cardEl);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div className="scrub" ref={scrubRef}>
      <div className="stage" ref={stageRef}>
        {/* the real row, revealed underneath */}
        <div className="stage-slides">
          {SLIDES.map((src, i) => (
            <div
              className="stage-slide"
              data-slide
              data-centre={i === CENTRE ? "" : undefined}
              key={src}
            >
              <div
                className="stage-slide-img"
                style={{ backgroundImage: `url(/images/scroll/${src})` }}
              />
            </div>
          ))}
        </div>

        {/* the fullscreen copy whose window closes onto the centre slide */}
        <div className="stage-clip">
          <div
            className="stage-clip-img"
            style={{ backgroundImage: `url(/images/scroll/${HERO})` }}
          />
        </div>

        <div className="stage-cover">
          {/* The hero's own wordmark, top left. Plain type rather than the egg
              lockup below: over a full-bleed painting a second illustrated mark
              is a second thing to look at. It hands over to the egg lockup as
              the hero shrinks, so the corner is never empty and never doubled. */}
          <span className="stage-brand" aria-hidden="true">
            Amber
          </span>

          <div className="stage-cover-centre">
            <h1 className="stage-title" aria-label={TITLE}>
              {TITLE.split("").map((char, i) => (
                <span className="stage-char" data-char key={`${char}-${i}`}>
                  {char}
                </span>
              ))}
            </h1>
            <p className="stage-eyebrow">Intelligence · Preservation · Context</p>
          </div>

          <p className="stage-hint">
            <span>Scroll to explore</span>
            <svg
              className="stage-hint-arrow"
              viewBox="0 0 12 22"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 1v19M1 15l5 5 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </p>
        </div>

        {/* Site mark. Deliberately absent at the top: the fullscreen geode is
            the identity there, and a corner logo over it would be a second
            claim on the same job. It arrives as the hero shrinks away and
            leaves as the sheet, which carries its own mark, rises. Named alt=""
            because the h1 above already announces the brand. */}
        <div className="stage-mark" aria-hidden="true">
          <Image
            src="/amber-mark.png"
            alt=""
            width={88}
            height={86}
            className="stage-mark-img"
          />
          <span className="stage-mark-word">{TITLE}</span>
        </div>

        {/* Dims the row as the card rises over it */}
        <div className="stage-card-scrim" aria-hidden="true" />

        {/**
          * THE PAGE DOES NOT LOOK FINISHED HERE, AND IT IS NOT.
          *
          * With the card up and filling the screen there is nothing to suggest
          * anything follows it, so somebody reads the essay and leaves --
          * without ever seeing the form the whole page exists for. The hero
          * says "scroll to explore" for the same reason; this is the same
          * promise kept a second time, naming what is actually next.
          *
          * It sits in the gap under the card rather than on top of it, fades
          * in with the card and out as the sheet takes over, and is outside
          * .stage-card on purpose: inside, it would be measured by the essay
          * fitter and would shrink the type to make room for itself.
          */}
        <p className="stage-card-hint" aria-hidden="true">
          <span>Scroll to join the waitlist</span>
          <svg viewBox="0 0 12 22" aria-hidden="true" focusable="false">
            <path
              d="M6 1v19M1 15l5 5 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </p>

        {/* THE ESSAY. Rises over the finished row on the same mechanic as the
            waitlist sheet below -- one motion language for the whole page
            rather than a second kind of entrance in the middle of it. The row
            stays visible down both edges, which is what keeps this reading as
            a card over a scene and not as a new page. */}
        <section className="stage-card" aria-label="Why Amber exists">
          <div className="stage-card-inner">
            <h2 className="stage-card-title">
              <span className="stage-card-title-lean">
                The Relationships that Stick : Your Mutual Agent
              </span>
            </h2>
            <div className="stage-card-body">
              <p>
                Is there anything beyond the &ldquo;follow&rdquo; button?
                There&rsquo;s no depth to the profile you&rsquo;re looking at.
                Not sure if it&rsquo;s a like-minded &ldquo;friend&rdquo; or a
                well-made bot. You&rsquo;re just hoping to raise a number to
                feel more connected. Can social networking be any different?
              </p>
              <p>
                Humans are at their best when they see patterns and make
                real-life connections. Seeing a friend who is down and
                recognizing what has made you feel better in those same
                situations. Coming up with a plan for an event and thinking of
                the perfect people to help execute it. Introducing your little
                sister, who&rsquo;s looking for an internship, to your
                friend&rsquo;s company because you know it&rsquo;d be a good
                fit.
              </p>
              <p>
                What if our technology stopped acting like an empty follow button
                and started being the shared connection we needed all along?
                Pushing us to reach out to someone for something we
                wouldn&rsquo;t otherwise have thought to do. Turning the
                connection you never knew you had into your next client.
                Meeting that friend of a friend who is selling the exact art
                you wanted. Finding the perfect group for that road trip
                you&rsquo;ve been wanting to take.
              </p>
              <p>
                AI shouldn&rsquo;t be a cold, static world. It should be the
                tool that allows us to be our most human selves, and do what
                humans do best: find patterns and make connections.
              </p>
            </div>
          </div>
        </section>

        {/* Dims the card as the sheet rises over it */}
        <div className="stage-scrim" aria-hidden="true" />

        <section className="stage-sheet" aria-label="Join the waitlist">
          <div className="stage-sheet-inner">
            <div className="stage-sheet-intro">
              <Image
                src="/amber-mark.png"
                alt=""
                width={68}
                height={66}
                className="stage-sheet-mark"
              />
              <span className="stage-sheet-word">amber</span>
              <p className="stage-sheet-eyebrow">Waitlist</p>
              <h2 className="stage-sheet-title">Get on the list.</h2>
            </div>

            <div className="stage-sheet-form">
              <WaitlistForm />
            </div>
          </div>

          {/* Anchors the bottom of a tall sheet so the space reads as composed
              rather than empty */}
          <footer className="stage-sheet-foot">
            <span className="stage-sheet-beats">speak. kept. found.</span>
            <span>&copy; 2026 Amber Intelligence</span>
          </footer>
        </section>
      </div>
    </div>
  );
}
