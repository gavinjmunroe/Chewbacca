// Where each chat site keeps its parts. Lists, first match wins, because both
// sites reshape their DOM without notice.
//
// Checked against the real pages on 2026-10-13 (tests/browser_chewb_headless.py
// --real-dom reads saved copies): logged-out chatgpt.com renders its composer
// as <textarea name="prompt" id="mobile-composer-prompt" aria-label="Chat with
// ChatGPT"> and its send button as aria-label "Send message". The older
// #prompt-textarea (a ProseMirror div, bin/chatgpt-tab, 2026-09-19) stays in
// the list for signed-in pages that still render it. claude.ai answered a
// headless fetch with a Cloudflare challenge, so its entries below are the
// shapes it is known to use and are unverified against today's page.

const CHEWB_SITES = {
  chatgpt: {
    host: /(^|\.)chatgpt\.com$/,
    composer: [
      "#prompt-textarea",
      'textarea[name="prompt"]',
      '[contenteditable="true"][data-testid="prompt-textarea"]',
      'textarea[aria-label*="ChatGPT"]',
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      '[data-turn="assistant"]',
    ],
    user: ['[data-message-author-role="user"]', '[data-turn="user"]'],
    streaming: [
      '[data-is-streaming="true"]',
      ".result-streaming",
      'button[data-testid="stop-button"]',
    ],
  },
  claude: {
    host: /(^|\.)claude\.ai$/,
    composer: [
      'div[contenteditable="true"].ProseMirror',
      '[data-testid="chat-input"] [contenteditable="true"]',
      'fieldset [contenteditable="true"]',
      'textarea[aria-label*="Claude"]',
    ],
    assistant: [
      ".font-claude-response",
      '[data-testid="assistant-message"]',
      ".font-claude-message",
    ],
    user: ['[data-testid="user-message"]'],
    streaming: [
      '[data-is-streaming="true"]',
      'button[aria-label="Stop response"]',
    ],
  },
};

function chewbSite(hostname) {
  for (const [name, site] of Object.entries(CHEWB_SITES)) {
    if (site.host.test(hostname)) return { name, ...site };
  }
  return null;
}

function chewbFirst(root, selectors) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

function chewbAll(root, selectors) {
  for (const s of selectors) {
    const els = root.querySelectorAll(s);
    if (els.length) return [...els];
  }
  return [];
}

// Puts text in the composer for the person to read and send. Never presses send.
function chewbFillComposer(site, text) {
  const box = chewbFirst(document, site.composer);
  if (!box) return false;
  box.focus();
  if (box.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(box, (box.value ? box.value + "\n\n" : "") + text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  // ProseMirror and other contenteditable editors only keep text that arrives
  // as an input event, so a plain textContent write is dropped on the next render.
  const sel = window.getSelection();
  sel.selectAllChildren(box);
  sel.collapseToEnd();
  if (!document.execCommand("insertText", false, text)) box.textContent += text;
  return true;
}
