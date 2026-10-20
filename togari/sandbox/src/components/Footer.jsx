import { useState } from "react";
import { MARKETING_URL } from "../config.js";

const EXPLORE_LINKS = [
  { label: "Home", href: MARKETING_URL },
  { label: "Use Cases", href: `${MARKETING_URL}/#use-cases` },
  { label: "About", href: `${MARKETING_URL}/about` },
  { label: "Capabilities", href: `${MARKETING_URL}/capabilities` },
];

export default function Footer() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (email) setSent(true);
  }

  return (
    <footer className="ft" role="contentinfo">
      {/* ── Top grid: CTA | Explore | Newsletter ── */}
      <div className="ft__grid">
        <div className="ft__cta">
          <p className="ft__cta-title">
            Ready to build the system behind your next pipeline?
          </p>
          <a
            href="https://cal.com/sagartiw/15min"
            target="_blank"
            rel="noreferrer noopener"
            className="ft__cta-btn"
          >
            Book a Meeting →
          </a>
        </div>

        <div className="ft__nav">
          <p className="ft__col-label">Explore</p>
          <ul className="ft__nav-list">
            {EXPLORE_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} className="ft__nav-link">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="ft__nws">
          <label className="ft__col-label" htmlFor="ft-email">
            Newsletter
          </label>
          <p className="ft__nws-desc">
            Insights on AI strategy, GTM systems, and modern revenue operations.
          </p>
          {sent ? (
            <p className="ft__nws-sent">Thanks — you're subscribed.</p>
          ) : (
            <form className="ft__nws-row" onSubmit={handleSubmit}>
              <input
                id="ft-email"
                type="email"
                className="ft__nws-input"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-label="Email address"
              />
              <button type="submit" className="ft__nws-btn">
                Subscribe
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div className="ft__bar">
        <a href={MARKETING_URL} className="ft__bar-brand" aria-label="Home">
          <img src="/bma.png" alt="" width="16" height="16" />
          <span>Blue Modern Advisory</span>
        </a>

        <span className="ft__bar-copy">
          © {new Date().getFullYear()} Blue Modern Advisory · GTM Strategy &amp;
          Engineering
        </span>

        <a
          className="ft__bar-link"
          href="https://www.linkedin.com/company/blue-modern-advisory/about/"
          target="_blank"
          rel="noreferrer noopener"
        >
          LinkedIn
        </a>
      </div>
    </footer>
  );
}
