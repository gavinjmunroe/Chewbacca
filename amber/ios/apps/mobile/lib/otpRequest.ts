export type RequestCodeResult =
  | { kind: 'ok' }
  // The number must text Amber once (opt-in / handshake) before codes can be
  // delivered. `optInUrl` is an `imessage:` deep link the UI opens; after the
  // user sends that message they tap "Send code" again.
  | { kind: 'optIn'; optInUrl?: string; senderPhone?: string; message: string }
  | { kind: 'error'; message: string };

// Only allow Messages links from the delivery response. Never open arbitrary URLs
// on the sign-in screen; older servers may provide only a sender number.
export function optInMessagesUrl(body: Record<string, unknown>): string | undefined {
  for (const value of [body.opt_in_sms_url, body.opt_in_url]) {
    if (typeof value === 'string' && /^(sms:|imessage:)/i.test(value)) return value;
  }
  const sender = typeof body.sender_phone === 'string' ? body.sender_phone : '';
  return /^\+[1-9]\d{6,14}$/.test(sender) ? `sms:${sender}&body=Hi%20Amber` : undefined;
}

const GENERIC_SEND_ERROR = "Couldn't send your code, try again.";

// Ask the backend (Photon delivery) to text a 6-digit OTP to this phone via
// iMessage. Unlike the old /v1/auth/issue-code, the response never carries the
// code — it only reports the delivery state.
//
// This reads the raw response body directly rather than going through
// callMedhaId, because callMedhaId collapses every non-2xx body down to
// { error, message } (see medhaId.ts) and would drop the opt-in flow's
// `opt_in_url` / `sender_phone` fields the UI needs.
export async function requestOtpCode(baseUrl: string, phone: string): Promise<RequestCodeResult> {
  const url = `${baseUrl}/v1/auth/otp/request`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let status: number;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ phone }),
      signal: controller.signal,
    });
    status = res.status;
    // Defensive body read: an empty/unreadable JSON body can throw on RN's
    // fetch polyfill, so treat that as no body and degrade on the status.
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      body =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      body = {};
    }
  } catch {
    return {
      kind: 'error',
      message: controller.signal.aborted
        ? 'Sending your code took too long. If it arrives, tap ‘I already have a code’. Otherwise, wait a moment and retry.'
        : 'Could not reach Amber. Check your connection and try again.',
    };
  } finally {
    clearTimeout(timeout);
  }

  if (status === 200 && body.ok === true) {
    return { kind: 'ok' };
  }

  const error = typeof body.error === 'string' ? body.error : undefined;
  const serverMessage = typeof body.message === 'string' ? body.message : undefined;

  if (status === 503 && error === 'delivery_restricted') {
    return {
      kind: 'error',
      message: "Amber can't send a code to this number right now. Please contact Amber support.",
    };
  }

  if (status === 429 && error !== 'resend_cooldown') {
    return {
      kind: 'error',
      message: 'Too many code requests. Wait 15 minutes before trying again.',
    };
  }

  if (status === 429 && error === 'resend_cooldown') {
    return { kind: 'error', message: 'Wait a moment before requesting another code.' };
  }

  if (status === 409 && (error === 'phone_needs_opt_in' || error === 'phone_needs_handshake')) {
    return {
      kind: 'optIn',
      optInUrl: optInMessagesUrl(body),
      senderPhone: typeof body.sender_phone === 'string' ? body.sender_phone : undefined,
      message: serverMessage ?? 'Text Amber once to enable login codes, then send code again.',
    };
  }

  if (status === 422 && error === 'phone_not_imessage') {
    return { kind: 'error', message: serverMessage ?? GENERIC_SEND_ERROR };
  }

  return { kind: 'error', message: GENERIC_SEND_ERROR };
}
