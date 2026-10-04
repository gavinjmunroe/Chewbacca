/* Panel 2, "Live alerts": Sift posts an issue into a team channel and answers
 * two follow-ups.
 *
 * Mechanism read out of the reference's chunk 3247 (AlertsVisual): five
 * messages, one more every 1400ms with a typing row parked in the slot the
 * next message will take, a 2000ms hold on the full thread, then the thread
 * clears and starts again. Every slot is laid out from first paint and only
 * made visible on arrival, so the panel height never moves. Measured on
 * their page at 1440: zoom 0.85 on a natural 640px card, 636px tall at 544.
 *
 * Channel, bot, person and every message are ours. The chat client is a
 * generic one; nothing here names or draws a real product.
 */

export const MOUNT = "#chat-mock";

const STEP_MS = 1400;
const HOLD_MS = 2000;

const SIFT_AVATAR = `<span class="cm-av cm-av-bot" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M4 6h12M6 10h8M8 14h4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg></span>`;
const WREN_AVATAR = `<span class="cm-av cm-av-human" aria-hidden="true">WO</span>`;

/* A flashing beacon, drawn, in place of an emoji. */
const BEACON = `<svg class="cm-beacon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="12" width="12" height="2.5" rx=".6" fill="#7a1f2b"/><path d="M4 12V8a4 4 0 0 1 8 0v4z" fill="#e0344b"/><path d="M6.2 8.4a1.8 1.8 0 0 1 1.8-1.8" stroke="#fff" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".8"/><path d="M8 1.2v1.6M2.6 3.4l1.1 1.1M13.4 3.4l-1.1 1.1" stroke="#e0344b" stroke-width="1.1" stroke-linecap="round"/></svg>`;

const SIFT = { name: "Sift", avatar: SIFT_AVATAR, app: true };
const WREN = { name: "Wren Okafor", avatar: WREN_AVATAR, app: false };

const mention = (t) => `<span class="cm-at">${t}</span>`;
const code = (t) => `<code class="cm-code">${t}</code>`;

const MESSAGES = [
  {
    author: SIFT,
    time: "10:16 AM",
    body: `${BEACON} <strong>New issue in refund-agent</strong> ${BEACON}<br>The agent tells the customer their refund is on its way before the payout call has returned, and when the payout fails the message stands. 21 of the last 60 runs affected.`,
  },
  {
    author: WREN,
    time: "10:18 AM",
    body: `${mention("@Sift")} which runs?`,
  },
  {
    author: SIFT,
    time: "10:18 AM",
    body: "Three runs, one for each way it goes wrong:",
    thread: { count: 3, meta: "Today at 10:18 AM" },
  },
  {
    author: WREN,
    time: "10:19 AM",
    body: `${mention("@Sift")} how many customers got the wrong message?`,
  },
  {
    author: SIFT,
    time: "10:19 AM",
    body:
      `<strong>35% of refund runs</strong><br>` +
      `• 12 confirmations with no payout behind them<br>` +
      `• 6 payouts retried after the customer was told it was done<br>` +
      `• 3 orders refunded twice, each with ${code("payout_id: null")} on the first try<br>` +
      `None of them raised an error, so the error tracker saw nothing.<br>` +
      `<strong>Proposed fix:</strong> hold the confirmation until issue_payout returns. The prompt change is drafted and waiting on your review.`,
    action: "Open in Sift",
  },
];

function messageHtml(m) {
  const badge = m.author.app ? '<span class="cm-app">APP</span>' : "";
  const thread = m.thread
    ? `<div class="cm-thread">${SIFT_AVATAR.replace("cm-av ", "cm-av cm-av-sm ")}<span class="cm-replies">${m.thread.count} replies</span><span class="cm-tmeta">${m.thread.meta}</span></div>`
    : "";
  const action = m.action
    ? `<div class="cm-actions"><span class="cm-btn" role="presentation">${m.action}</span></div>`
    : "";
  return `<div class="cm-msg">
      ${m.author.avatar}
      <div class="cm-main">
        <div class="cm-meta"><span class="cm-name">${m.author.name}</span>${badge}<span class="cm-time">${m.time}</span></div>
        <div class="cm-body">${m.body}</div>
        ${thread}${action}
      </div>
    </div>`;
}

export function panel() {
  return `<div class="cm-zoom">
    <div class="cm-panel">
      <div class="cm-head">#agent-alerts</div>
      <div class="cm-list">
        ${MESSAGES.map(
          (m) => `<div class="cm-slot">
          <div class="cm-arrive">${messageHtml(m)}</div>
          <div class="cm-typing" aria-hidden="true">${m.author.avatar}<span class="cm-dots"><i></i><i></i><i></i></span></div>
        </div>`,
        ).join("")}
      </div>
      <div class="cm-steps">${MESSAGES.map(() => '<span class="cm-step"></span>').join("")}</div>
    </div>
  </div>`;
}

export function render() {
  return panel();
}

export function mount(root) {
  const slots = [...root.querySelectorAll(".cm-slot")];
  const steps = [...root.querySelectorAll(".cm-step")];
  const n = slots.length;
  let timer = 0;

  /* count = messages delivered. The slot at `count` shows the typing row and
   * its progress segment fills over STEP_MS; once all are in, only the last
   * segment is drawn solid, as theirs does. */
  function paint(count, animate) {
    slots.forEach((el, i) => {
      el.classList.toggle("is-in", i < count);
      el.classList.toggle("is-anim", animate && i < count);
      el.classList.toggle("is-typing", animate && i === count);
    });
    steps.forEach((el, i) => {
      el.innerHTML = "";
      if (animate && i === count && count < n)
        el.innerHTML = '<span class="cm-fill"></span>';
      if (i === n - 1 && count >= n)
        el.innerHTML = '<span class="cm-full"></span>';
    });
  }

  function step(count) {
    paint(count, true);
    if (count < n) {
      timer = window.setTimeout(() => step(count + 1), STEP_MS);
    } else {
      timer = window.setTimeout(() => step(0), HOLD_MS);
    }
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  paint(n, false);

  return {
    setActive(on) {
      window.clearTimeout(timer);
      if (reduced) return paint(n, false);
      if (on) step(0);
    },
  };
}
