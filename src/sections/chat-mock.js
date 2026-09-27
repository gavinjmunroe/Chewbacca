/* Section E, the chat notification mock.
 *
 * The one measured fact this section exists to reproduce: the reference ships a
 * typing keyframe running `1.2s ease-in-out infinite`
 * (docs/spec/SECTIONS.md section E, and item 6 of "Sections, in page order" in
 * ux-engine/research/REFERENCE-SPEC.md). A looping typing indicator is
 * therefore part of the section and its period is not ours to choose.
 *
 * Everything else here is a choice, and the choices say so.
 *
 * Copy, product name, app identity and people are ours. No real person and no
 * other company's product messages appear. Avatars are drawn from initials, so
 * nothing is fetched.
 */

export const MOUNT = "#chat-mock";

/* One full period of the reference's 1.2s typing keyframe. Holding the
 * indicator for exactly one period means the loop is never cut mid-cycle, so
 * the dots always leave the screen from the same phase they entered it. A
 * shorter hold shows a truncated bounce, which is the tell that a mock is
 * faking the wait. */
const TYPING_MS = 1200;

/* Reading pause between the alert and the human answering it. 600ms is one of
 * the six most common durations on the reference (220, 450, 400, 600, 200,
 * 150ms, counted across its stylesheets), so the section keeps to the page's
 * own vocabulary rather than introducing a seventh number. */
const REPLY_GAP_MS = 600;

/* Gap between the human's question and the app starting to answer it. 200ms,
 * also from that measured set. Our choice of which one. */
const REACT_MS = 200;

/* The resulting schedule. Derived, not typed in, so the numbers above are the
 * only things to change. Messages are revealed at these marks; the typing
 * indicator runs in the windows, and every window is exactly TYPING_MS long. */
const TYPING_WINDOWS = [
  [0, TYPING_MS],
  [TYPING_MS + REPLY_GAP_MS + REACT_MS, TYPING_MS + REPLY_GAP_MS + REACT_MS + TYPING_MS],
];
const MESSAGE_AT = [
  TYPING_WINDOWS[0][1],                          // 1200: the alert
  TYPING_WINDOWS[0][1] + REPLY_GAP_MS,           // 1800: the human reply
  TYPING_WINDOWS[1][1],                          // 3200: the app answer
];
const SETTLE_MS = MESSAGE_AT[MESSAGE_AT.length - 1];

/* Our product is Bellwether, an agent monitoring service. It posts as an app
 * into a team channel. "Wren" is an invented on-call handle, not a person. */
const CHANNEL = {
  name: "agent-health",
  topic: "Production agents. Paging goes here.",
  members: "14",
};

const THREAD = [
  {
    from: "app",
    author: "Bellwether",
    initials: "BW",
    time: "2:09 PM",
    /* A chat client genuinely bolds the first line of a bot alert, which is the
     * one place weight is allowed inside this mock. The page itself stays at
     * 400 everywhere. */
    lead: "refund-resolver is closing tickets without moving the money",
    body:
      "34 of the last 312 runs finished clean and never called the payout tool. " +
      "No error raised, no retry attempted. The customer reads a confirmation " +
      "for a refund that never happened.",
  },
  {
    from: "human",
    author: "Wren",
    initials: "W",
    time: "2:11 PM",
    body: "is that every currency or just the EUR ones",
  },
  {
    from: "app",
    author: "Bellwether",
    initials: "BW",
    time: "2:11 PM",
    body: "EUR only, and three things line up on it:",
    bullets: [
      "all 34 runs carry a EUR amount, none carry USD",
      "the payout call is skipped immediately after the eligibility step",
      "the first one lands 6 minutes after deploy a41c9e2",
    ],
    action: "Open the failing trace",
  },
];

function avatar(message) {
  return `<span class="cm-avatar cm-avatar-${message.from}" aria-hidden="true">${message.initials}</span>`;
}

function messageHtml(message, index) {
  const badge = message.from === "app" ? `<span class="cm-badge">APP</span>` : "";
  const lead = message.lead ? `<p class="cm-lead">${message.lead}</p>` : "";
  const bullets = message.bullets
    ? `<ul class="cm-bullets">${message.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`
    : "";
  const action = message.action
    ? `<button class="cm-action" type="button">${message.action}</button>`
    : "";
  return `
    <li class="cm-msg" data-cm-msg="${index}" style="order:${(index + 1) * 10}">
      ${avatar(message)}
      <div class="cm-body">
        <p class="cm-meta">
          <span class="cm-author">${message.author}</span>${badge}
          <time class="cm-time">${message.time}</time>
        </p>
        ${lead}
        <p class="cm-text">${message.body}</p>
        ${bullets}
        ${action}
      </div>
    </li>`;
}

export function render() {
  return `
  <section class="cm" aria-labelledby="cm-heading">
    <div class="cm-grid">

      <div class="cm-copy">
        <p class="cm-label">Alerts</p>
        <h2 class="cm-heading" id="cm-heading">Hear about it in the channel you already have open.</h2>
        <p class="cm-sub">
          Bellwether posts the failure into your team's chat with the runs that
          prove it and a link into the trace that caused it. There is no second
          dashboard to remember to check at 2am.
        </p>
      </div>

      <div class="cm-panel">
        <div class="cm-head">
          <span class="cm-hash" aria-hidden="true">#</span>
          <span class="cm-channel">${CHANNEL.name}</span>
          <span class="cm-head-topic">${CHANNEL.topic}</span>
          <span class="cm-head-count">${CHANNEL.members}</span>
        </div>

        <!-- Every row, delivered or not, holds its slot from first paint, so
             the panel is exactly as tall before the first message as it is
             after the last one and nothing below the section ever moves. -->
        <ol class="cm-thread">
          ${THREAD.map(messageHtml).join("")}
          <li class="cm-typing" data-cm-typing style="order:5">
            <span class="cm-avatar cm-avatar-app" aria-hidden="true">BW</span>
            <span class="cm-dots" role="status" aria-label="Bellwether is typing">
              <i class="cm-dot"></i><i class="cm-dot"></i><i class="cm-dot"></i>
            </span>
          </li>
        </ol>
      </div>

    </div>
  </section>`;
}

export function mount(root) {
  const messages = Array.from(root.querySelectorAll("[data-cm-msg]"));
  const typing = root.querySelector("[data-cm-typing]");
  if (!messages.length || !typing) return;

  let lastSignature = "";

  /* Declarative rather than a replayed event list: state is a pure function of
   * elapsed time, so applying it twice is the same as applying it once. That is
   * what makes banking safe. Resuming mid-sequence re-applies whatever the
   * banked time implies and nothing double-fires. */
  function apply(elapsed) {
    let shown = 0;
    for (let i = 0; i < MESSAGE_AT.length; i += 1) {
      if (elapsed >= MESSAGE_AT[i]) shown = i + 1;
    }
    const isTyping = TYPING_WINDOWS.some(([from, to]) => elapsed >= from && elapsed < to);
    const signature = `${shown}:${isTyping ? 1 : 0}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    messages.forEach((el, i) => el.classList.toggle("is-in", i < shown));
    typing.classList.toggle("is-on", isTyping);
    /* Flex `order` parks the indicator in the slot the next message will land
     * in, rather than at the foot of the panel with the undelivered rows
     * stranded between. It displaces only rows that are still invisible, so no
     * visible row moves and the panel's height does not change: the three
     * screenshot marks all measure 425.2px. Four writes for the whole sequence,
     * not one per frame, because `apply` bails when the state is unchanged. */
    typing.style.order = String(shown * 10 + 5);
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("cm-still");
    apply(SETTLE_MS);
    return;
  }

  apply(0);

  let elapsed = 0;
  let previous = 0;
  let frame = 0;

  function tick(now) {
    elapsed += now - previous;
    previous = now;
    apply(elapsed);
    if (elapsed >= SETTLE_MS) {
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (frame || elapsed >= SETTLE_MS) return;
    previous = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  /* Threshold 0, matching every other figure on the reference. Time only
   * accumulates while the panel is on screen, so scrolling away and back
   * resumes the thread rather than replaying it from the first typing dot. */
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) start();
        else stop();
      }
    },
    { threshold: 0 },
  );
  observer.observe(root);

  return () => {
    stop();
    observer.disconnect();
  };
}
