// Lightweight phone helpers. Server-side validation is the source of truth; this just
// produces something dial-able and a friendly display string. E.164 only.

export function normalizePhone(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  // A PLUS IS A LEADING MARK, NOT A DIGIT, AND THERE IS ONLY EVER ONE.
  //
  // This used to keep every '+' the string contained and return early on any
  // string starting with one, so:
  //   '+'              -> '+'                  a card with a stray plus became a
  //                                            "number" that every consumer then
  //                                            had to know meant empty
  //   '++15550101234'  -> '++15550101234'      nothing dials that
  //   '+1+555+010+1234'-> '+1+555+010+1234'    and contacts imported from other
  //                                            apps really do arrive like this
  //
  // Digits decide whether there is a number; the plus only records that the
  // digits are already international.
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  const international = trimmed.trimStart().startsWith('+');
  if (international) return `+${digits}`;
  // Bare 10-digit US numbers default to +1.
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  // 11-digit starting with 1.
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return `+${digits}`;
}

export function isLikelyValid(raw: string): boolean {
  const n = normalizePhone(raw);
  return /^\+\d{7,15}$/.test(n);
}

export function formatDisplay(raw: string): string {
  const n = normalizePhone(raw);
  // +1XXXXXXXXXX -> +1 (XXX) XXX-XXXX
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
  return n;
}
