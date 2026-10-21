/**
 * THE PRIVACY POLICY AND THE TERMS, AS SERVED PAGES.
 *
 * WHY THEY LIVE IN A .js FILE. The obvious home is two .html files read off
 * disk, and public.js already does that with knowledge/caleb-public.md. The
 * difference is what happens when the read fails: caleb-public.md serving a 500
 * is a broken endpoint on somebody's personal site, and a privacy policy URL
 * serving a 500 is an App Store rejection and, worse, a link inside a shipped
 * build that a user taps and gets nothing from. Anything outside src/ depends on
 * the deploy including it, and that is a dependency worth not having for the two
 * documents the app is legally obliged to be able to show.
 *
 * ── THESE ARE DRAFTS AND THE DATE SAYS SO ───────────────────────────────────
 *
 * They describe what Amber actually does, written from the code, which is the
 * part software can get right. Whether they say it in the way a regulator or a
 * plaintiff would want is a lawyer's question and has not been asked yet. The
 * effective date is the one line to change after that review.
 *
 * ── WHY THE TERMS ARE NOT APPLE'S STANDARD EULA ─────────────────────────────
 *
 * Apple lets an app link their standard EULA instead of writing one. It does not
 * contain the clause Guideline 1.2 requires of an app with user-generated
 * content: that the user agrees there is no tolerance for objectionable content
 * or abusive behavior. That clause is in section 4 below, and it is the reason
 * this document exists rather than a link to apple.com.
 */

const EFFECTIVE = "September 13, 2026";
const CONTACT = process.env.SUPPORT_EMAIL || "team@joinrytual.com";
const COMPANY = "Rytual Health LLC";

/**
 * One shell for both documents.
 *
 * Self-contained: no external stylesheet, no font, no script. A policy page is
 * read once, often on a phone with bad signal, sometimes by a reviewer behind a
 * proxy that blocks third-party requests -- and a legal document that needs a
 * CDN to render is a legal document that sometimes does not.
 */
function page(title, body, options = {}) {
  const company = options.company || COMPANY;
  const contact = options.contact || CONTACT;
  const effective = options.effective || EFFECTIVE;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Amber</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 32px 20px 96px; max-width: 44rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1c1a17; background: #fdfcfa;
  }
  @media (prefers-color-scheme: dark) { body { color: #ece8e2; background: #16150f; } }
  h1 { font-size: 1.6rem; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 1.06rem; margin: 2.2em 0 0.5em; letter-spacing: -0.005em; }
  .eff { font-size: 0.85rem; opacity: 0.6; margin: 0 0 2em; }
  li { margin: 0.3em 0; }
  a { color: inherit; }
  code { font-size: 0.9em; }
</style>
</head><body>
<h1>${title}</h1>
<p class="eff">Amber, by ${company} · Effective ${effective}</p>
${body}
<h2>Contact</h2>
<p>Questions, requests, or reports: <a href="mailto:${contact}">${contact}</a>.</p>
</body></html>`;
}

export const PRIVACY_HTML = page(
  "Privacy Policy",
  `<p>This policy describes Amber — Rytual Beta, operated by Rytual Health LLC. Amber helps you record voice memos, organize relationship information, and manage plans. It applies to the beta app and the Amber ID services used by that app.</p>
<h2>1. Information you provide</h2>
<p>We process your account phone number and verification information, profile details you choose to provide, voice recordings, transcripts, messages to Amber, and the people, plans, notes, and attachments you save. Relationship information may include other people's names, contact details, organizations, and context you provide. Only share information you are entitled to provide.</p>
<h2>2. Optional connections and device permissions</h2>
<ul>
<li><strong>Contacts:</strong> with permission, Amber imports contact details to identify people and attach your notes to the correct person.</li>
<li><strong>Calendars and Google:</strong> connecting an account or allowing device calendar access lets Amber display permitted calendar information. Google access may also cover contacts or Gmail when included in the consent screen and enabled. Reviewed plan actions can create or update events in the Google calendar you choose.</li>
<li><strong>Microphone:</strong> used when you start a recording. The original recording can remain on your device and be uploaded to Amber ID for storage, transcription, and playback.</li>
<li><strong>Photos and files:</strong> Amber processes items you select or submit. A permission grant alone does not mean every photo is uploaded.</li>
<li><strong>Location:</strong> optional location access supports location context. The beta does not import Apple Find My friends or continuously publish friends' locations.</li>
<li><strong>Health and fitness:</strong> optional Apple Health access reads supported activity data, such as steps and workouts. A summary is sent to Amber ID only when you choose to save it. Health information is not used for advertising, data brokerage, or marketing profiles.</li>
</ul>
<p>You can decline optional permissions and revoke device permissions in iOS Settings. Disconnect Google in Amber or revoke its access in your Google account. Disconnecting stops future authorized access; it does not automatically erase information already saved. Meta account import, cross-app activity tracking, and third-party wearable connections are not enabled in this beta.</p>
<h2>3. How we use information</h2>
<p>We use information to authenticate you; store and play recordings; transcribe and summarize notes; suggest person and plan matches; organize relationship context and PeopleRank results; perform updates you confirm; answer your questions; and operate, secure, troubleshoot, and improve the service. AI outputs can be inaccurate. Review identities, dates, and destinations before confirming an update.</p>
<h2>4. Service providers and AI processing</h2>
<p>Audio and relevant text or relationship context may be processed by providers supporting transcription, AI responses, identity, messaging, cloud hosting, databases, and storage. Depending on the configured processing route, AI providers may include OpenAI, Groq, Google, and Anthropic. Optional research or enrichment features may use Exa, Perplexity, or Clay when enabled and requested. Photon supports the optional iMessage channel after you link it to your account. Google receives information needed for calendar actions you authorize. Apple processes TestFlight distribution and diagnostics under its own terms. These services receive information needed to provide their functions; their applicable service terms govern their processing.</p>
<h2>5. Sharing and visibility</h2>
<p>Your private recordings and imported relationship notes are not automatically published to other users. Profile sharing and other sharing actions disclose the information you select to the recipients or services involved. We may disclose information when required by law, to address fraud or security issues, or as part of a business transfer subject to appropriate safeguards. We do not sell your personal information. This beta does not include advertising or cross-app advertising tracking.</p>
<h2>6. Storage, retention, and security</h2>
<p>Information may be stored on your device and in cloud services, including outside your country. We use access controls and encrypted network connections to protect it; no system can guarantee absolute security. We keep account information and saved content while needed to provide the service, honor your choices, resolve disputes, or meet legal and security obligations. Backups and limited operational records may remain for a period after deletion. Revoking a permission does not delete existing copies.</p>
<h2>7. Your choices and requests</h2>
<p>You can correct information, manage connections and permissions, and request access, export, correction, or deletion by contacting team@joinrytual.com. To delete your account, use the account-deletion option in Settings where available, or email us from a verifiable account contact. We may verify your identity before handling a request. Deleting Amber from your phone alone does not delete cloud data. Applicable law may provide additional rights to object to or restrict processing or complain to a data-protection authority.</p>
<h2>8. Children, changes, and contact</h2>
<p>Amber is not directed to children under 13. If you believe a child has provided information, contact us so we can investigate and take appropriate action. We may update this policy as the service changes and will update its effective date. For questions or privacy requests, contact Rytual Health LLC at team@joinrytual.com.</p>
`,
  { company: "Rytual Health LLC", contact: "team@joinrytual.com", effective: "October 5, 2026" },
);

export const TERMS_HTML = page(
  "Terms of Service",
  `
<p>These terms are the agreement between you and ${COMPANY} for the Amber app.
Using Amber means you accept them.</p>

<h2>1. Who can use Amber</h2>
<p>You must be at least 13 years old, and old enough to enter a contract where
you live. You need a working phone number; it is how your account is identified.
Your account is yours, one person per account, and you are responsible for what
happens on it.</p>

<h2>2. What Amber is</h2>
<p>A personal assistant for your relationships: it holds what you tell it about
the people you know, and it suggests, summarizes and reminds. Some of what it
shows you is produced by AI models and <strong>some of it will be wrong</strong>.
Check anything that matters before you act on it. Amber is not professional
advice of any kind.</p>

<h2>3. Your content</h2>
<p>What you write, record, and upload stays yours. You give us the permission we
need to run the service with it — to store it, process it, transcribe it, send it
where you tell us to send it, and pass the relevant parts to the AI providers who
help produce your results. That permission exists to operate Amber for you and
for nothing else. It ends when you delete the content or your account, except for
copies in backups that expire on their own.</p>

<h2>4. No tolerance for abusive behavior or objectionable content</h2>
<p><strong>There is no tolerance for objectionable content or abusive users on
Amber.</strong> By using Amber you agree not to post, send, or share content that
is unlawful, harassing, threatening, hateful, defamatory, sexually explicit,
depicts or promotes harm to anyone, invades someone's privacy, impersonates
another person, or infringes someone else's rights — and not to use Amber to
stalk, threaten, spam, scam, or harass anyone.</p>
<p>Every user can <strong>block</strong> another user, which stops contact in both
directions, and <strong>report</strong> a user or a message from inside the app.
We review every report, normally within 24 hours, and we remove content and
remove users when a report is founded. We may suspend or terminate an account for
a violation of this section without notice, and we do not owe an explanation to a
terminated abusive user.</p>

<h2>5. Other people's information</h2>
<p>Amber holds information about people who are not users. Only add information
you are allowed to have, use it only for your own relationships, and do not use
Amber to build lists for spam or to harvest contact details for resale. If
someone asks you to delete what you hold about them, do it.</p>

<h2>6. What you must not do</h2>
<ul>
  <li>Break the law with it, or help someone else break the law with it.</li>
  <li>Reverse engineer it, scrape it, or attack it, its users, or its
      infrastructure.</li>
  <li>Get around a block, a rate limit, or a suspension — including by making a
      new account.</li>
  <li>Resell access, or run it as a service for someone else, without our written
      agreement.</li>
</ul>

<h2>7. Third-party services</h2>
<p>Connecting Google, Microsoft, LinkedIn, Slack, Notion, GitHub, X, or any other
account is between you and them as well as us. Their terms apply to their part,
and we are not responsible for what they do or for their outages.</p>

<h2>8. Paid features</h2>
<p>If a part of Amber is paid, the price and billing period are shown before you
buy. Purchases made through the App Store are billed by Apple and subject to
Apple's refund policy; cancel or manage a subscription in your Apple account
settings.</p>

<h2>9. Ending it</h2>
<p>Delete your account from Settings, any time, for any reason. We may suspend or
end your access if you break these terms, if we are legally required to, or if we
stop offering Amber — and in the last case we will give you reasonable notice and
a way to get your data out.</p>

<h2>10. No warranty, and the limit of what we owe</h2>
<p>Amber is provided "as is". To the extent the law allows, we disclaim all
warranties, including merchantability, fitness for a particular purpose, and
non-infringement, and we do not promise the service will be uninterrupted,
error-free, or that its output will be accurate.</p>
<p>To the extent the law allows, ${COMPANY} is not liable for indirect,
incidental, special, consequential, or punitive damages, or for lost profits or
lost data, and our total liability for any claim relating to Amber is limited to
the greater of the amount you paid us in the twelve months before the claim, or
one hundred United States dollars. Some places do not allow these limits, in
which case they do not apply to you.</p>

<h2>11. Apple</h2>
<p>Apple is not a party to this agreement and has no obligation to provide support
for Amber. Apple is a third-party beneficiary of these terms and may enforce
them. Any claim that the app fails to conform to a warranty is ours to answer, not
Apple's.</p>

<h2>12. Law, disputes, and changes</h2>
<p>These terms are governed by the laws of the State of Delaware, without regard
to its conflict-of-laws rules, and any dispute will be brought in the state or
federal courts located in Delaware — except that either of us may bring a claim
in small claims court, and nothing here waives a right you cannot waive where you
live. If we change these terms materially, we will tell you in the app before the
change takes effect. If a term is unenforceable, the rest still stands.</p>
`,
);

export const SUPPORT_HTML = page('Amber Support', `<p>For help with sign-in, recordings, contacts, calendar connections, or account access, email <a href="mailto:team@joinrytual.com">team@joinrytual.com</a>.</p><p>Include your app version and a description of the issue. Do not send passwords, verification codes, or private recordings.</p><h2>Your account and data</h2><p>Open your profile, then Account Settings to manage connections, processing permissions, or delete your account. For access, correction, or deletion assistance, contact the same support address.</p><p><a href="/legal/privacy">Privacy Policy</a> · <a href="/legal/terms">Terms of Service</a></p>`, { company: 'Rytual Health LLC', contact: 'team@joinrytual.com', effective: 'October 7, 2026' });
