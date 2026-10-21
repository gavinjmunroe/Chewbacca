const clean = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export function normalizeCard(input) {
  const name = clean(input?.name, 120),
    bio = clean(input?.bio, 280);
  if (!name || !Array.isArray(input.links) || input.links.length > 20)
    throw Error("invalid_card");
  const ids = new Set();
  const links = input.links.map((link) => {
    const id = clean(link.id, 80),
      label = clean(link.label, 60),
      value = clean(link.value, 1200),
      type = link.type;
    if (
      !id ||
      ids.has(id) ||
      !label ||
      !value ||
      !["url", "email", "phone"].includes(type) ||
      /[\r\n]/.test(value)
    )
      throw Error("invalid_link");
    ids.add(id);
    if (type === "url") {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password)
        throw Error("invalid_link");
    }
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      throw Error("invalid_link");
    if (type === "phone" && !/^\+?[0-9 ()-]{7,30}$/.test(value))
      throw Error("invalid_link");
    return { id, label, value, type, enabled: link.enabled === true };
  });
  return { name, bio, links, published: input.published === true };
}
export function publicCard(card) {
  if (!card?.published) return null;
  return {
    name: card.name,
    bio: card.bio,
    links: card.links
      .filter((l) => l.enabled)
      .map(({ label, value, type }) => ({ label, value, type })),
  };
}
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const vc = (s) =>
  String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
export function cardVcf(card) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:" + vc(card.name),
    "N:;" + vc(card.name) + ";;;",
  ];
  if (card.bio) lines.push("NOTE:" + vc(card.bio));
  for (const link of card.links)
    lines.push(
      (link.type === "phone"
        ? "TEL"
        : link.type === "email"
          ? "EMAIL"
          : "URL") +
        ":" +
        vc(link.value),
    );
  return [...lines, "END:VCARD", ""].join("\r\n");
}
export function cardHtml(card, token) {
  const links = card.links
    .map((link) => {
      const href =
        link.type === "phone"
          ? "tel:" + link.value.replace(/[^+0-9]/g, "")
          : link.type === "email"
            ? "mailto:" + encodeURIComponent(link.value)
            : link.value;
      return `<a class="link" href="${esc(href)}" rel="noopener noreferrer">${esc(link.label)}<span>↗</span></a>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(card.name)} · Amber</title><style>
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#f8eddd,transparent 65%),#fafaf9;color:#242321;font:16px/1.5 system-ui,sans-serif;min-height:100vh;padding:32px 20px}main{max-width:440px;margin:5vh auto;padding:32px 24px;border:1px solid #fff;border-radius:32px;background:#ffffffbd;backdrop-filter:blur(24px);box-shadow:0 16px 64px #342c1710}small{letter-spacing:.12em;color:#856336}h1{font-size:34px;line-height:1.15;letter-spacing:-1px;overflow-wrap:anywhere;margin:28px 0 12px}p{color:#625f58;white-space:pre-wrap}.link{display:flex;justify-content:space-between;gap:16px;padding:16px 18px;margin-top:12px;border:1px solid #e8e6e0;border-radius:20px;background:#fffffff0;color:inherit;text-decoration:none;overflow-wrap:anywhere}.save{background:#242321;color:white;text-align:center;display:block;border-radius:24px;padding:16px;margin-top:28px;text-decoration:none}footer{text-align:center;font-size:12px;color:#78756e;margin-top:24px}@media(prefers-reduced-transparency:reduce){main{background:#fff;backdrop-filter:none}}</style></head><body><main><small>AMBER ID</small><h1>${esc(card.name)}</h1>${card.bio ? `<p>${esc(card.bio)}</p>` : ""}${links}<a class="save" href="/card/${token}/contact.vcf">Save contact</a><a class="link" href="amber://import-card?token=${token}">Add in Amber<span>↗</span></a><footer>Shared intentionally. Connected through Amber.</footer></main></body></html>`;
}
