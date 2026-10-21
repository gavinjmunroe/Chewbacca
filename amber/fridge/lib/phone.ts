/**
 * A US PHONE NUMBER, FORMATTED WHILE SOMEBODY TYPES IT.
 *
 * Every Amber account is a US number today, so this assumes +1 rather than
 * asking. That assumption is written down here in one place so that the day it
 * stops being true, there is one file to change rather than a regex in a form.
 *
 * THE RULE THAT MAKES LIVE FORMATTING WORK: the digits are the state, and the
 * formatting is a pure function of them. The input never holds anything the
 * formatter did not produce, so there is no way for the punctuation to get out
 * of step with what was typed. Formatters that edit the displayed string in
 * place are how you end up with "+1-(630-" after one backspace.
 *
 * DELETING HAS TO WORK. A formatter that appends punctuation eagerly traps the
 * caret: type "630", get "+1-(630)-", press backspace, the ")" comes off, the
 * formatter puts it straight back, and the field cannot be emptied. So a
 * closing bracket or dash is only added once there is a digit to put AFTER it,
 * which means every backspace removes exactly one digit and the field always
 * drains to empty.
 */

/**
 * Just the digits, with the US country code dropped.
 *
 * THE COUNTRY CODE IS STRIPPED FROM THE TEXT, NOT FROM THE DIGITS, and getting
 * that backwards is what made the first version of this a trap. The field
 * displays "+1-(630", and pulling digits out of that gives "1630" -- four
 * digits, too few to look like a country code plus a number, so the 1 survives
 * and "630" silently becomes area code "163". Backspacing then never shrank
 * the value and the field could not be emptied.
 *
 * So a LITERAL leading "+1" is removed first, because that prefix is this
 * formatter's own output and is never something the user typed as data. Only
 * after that does an eleven-digit pasted number get its leading 1 taken off.
 */
export function digitsOf(value: string): string {
  const raw = String(value ?? "").trim();
  // The prefix this formatter writes, in the shapes a paste might carry it.
  const withoutCode = raw.replace(/^\+\s*1\b[\s\-.()]*/, "");
  let d = withoutCode.replace(/\D+/g, "");
  // A pasted 11-digit number is country code + number, unambiguously. Ten or
  // fewer is a number being typed, and its leading 1 is an area code digit.
  if (d.length > 10 && d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/**
 * Digits in, "+1-(555)-010-0001" out, at every intermediate length.
 *
 * Nothing at all gives an empty string rather than a bare "+1-(", so the
 * placeholder still shows on an untouched field.
 */
export function formatUsPhone(value: string): string {
  const d = digitsOf(value);
  if (!d) return "";
  const area = d.slice(0, 3);
  const mid = d.slice(3, 6);
  const last = d.slice(6, 10);

  let out = `+1-(${area}`;
  if (d.length > 3) out += `)-${mid}`;
  if (d.length > 6) out += `-${last}`;
  return out;
}

/** The E.164 form the API wants: +15550100001. Null until it is a whole number. */
export function toE164(value: string): string | null {
  const d = digitsOf(value);
  return d.length === 10 ? `+1${d}` : null;
}

export const isCompleteUsPhone = (value: string): boolean => digitsOf(value).length === 10;
