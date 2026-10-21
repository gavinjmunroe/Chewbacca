/**
 * THE TWO DOORS, DRAWN.
 *
 * The sign-in page asks a question with exactly two answers and used to ask it
 * in two paragraphs of identical-looking text. A person deciding between "for
 * myself" and "for my organization" is not reading a comparison; they already
 * know which they are, and the job of the page is to let them recognize it
 * without reading at all.
 *
 * So: one figure, or a ring of them. It is the difference the whole product is
 * built on -- one account versus a company of them -- and it is the only thing
 * on either card that can be understood from across a desk.
 *
 * Drawn rather than imported. Two shapes at two sizes is not worth an icon
 * dependency, and an inline SVG inherits currentColor, which is how both marks
 * change with the card they sit on without a second asset.
 */

export function PersonMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id="person-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbb43c" />
          <stop offset="100%" stopColor="#e8840a" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill="var(--ds-accent-soft)" />
      <circle cx="32" cy="24.5" r="8.5" fill="url(#person-fill)" />
      <path
        d="M15.5 50.5c0-8.6 7.4-14.5 16.5-14.5s16.5 5.9 16.5 14.5"
        fill="url(#person-fill)"
      />
    </svg>
  );
}

/**
 * A company: six around one.
 *
 * The ring is deliberately not six identical dots. One of them is filled and
 * larger, because an organization in this product is not a crowd -- it is a
 * group with somebody administering it, and the person looking at this card is
 * about to be that somebody.
 */
export function OrgMark({ size = 56 }: { size?: number }) {
  const r = 20;
  const people = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    return { x: 32 + Math.cos(a) * r, y: 32 + Math.sin(a) * r, lead: i === 0 };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id="org-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbb43c" />
          <stop offset="100%" stopColor="#e8840a" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill="var(--ds-accent-soft)" />
      {/* The ring they stand on, so six dots read as one group rather than six things. */}
      <circle cx="32" cy="32" r={r} stroke="var(--ds-accent-ring)" strokeWidth="1.5" fill="none" />
      {people.map((p, i) => (
        <g key={i} fill={p.lead ? "url(#org-fill)" : "var(--ds-accent-ink)"} opacity={p.lead ? 1 : 0.55}>
          <circle cx={p.x} cy={p.y - 2.6} r={p.lead ? 4.4 : 3.4} />
          <path
            d={
              p.lead
                ? `M${p.x - 6.2} ${p.y + 8.4}c0-3.9 2.8-6.3 6.2-6.3s6.2 2.4 6.2 6.3z`
                : `M${p.x - 4.8} ${p.y + 6.9}c0-3 2.1-4.9 4.8-4.9s4.8 1.9 4.8 4.9z`
            }
          />
        </g>
      ))}
    </svg>
  );
}

/** The product mark. An "a" in the amber gradient, used wherever the app names itself. */
export function AmberMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        borderRadius: size * 0.3,
        background: "linear-gradient(145deg,#fbb43c,#e8840a)",
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.56,
        lineHeight: 1,
        boxShadow: "0 1px 3px rgba(232,132,10,0.45)",
      }}
    >
      a
    </span>
  );
}
