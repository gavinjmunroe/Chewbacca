const ROOT = "https://www.googleapis.com/calendar/v3";
async function pages(path, token, fetchImpl) {
  const items = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const url = `${ROOT}${path}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Error(`google ${res.status}`);
    const data = await res.json();
    items.push(...(data.items ?? []));
    if (!data.nextPageToken) return items;
    if (data.nextPageToken === pageToken) throw Error("google repeated page");
    pageToken = data.nextPageToken;
  }
  throw Error("Calendar is too large for one sync.");
}
/** Convert a calendar's midnight, including DST, without using the server timezone. */
export function calendarMidnight(date, timeZone = "UTC") {
  let guess = Date.parse(`${date}T00:00:00Z`),
    target = guess;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
      formatter.formatToParts(guess).map((v) => [v.type, v.value]),
    );
    const viewed = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    const diff = target - viewed;
    if (!diff) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}
export async function readGoogleCalendars(token, window, fetchImpl = fetch, maxEvents = 2500) {
  const listed = await pages(
    "/users/me/calendarList?maxResults=250",
    token,
    fetchImpl,
  );
  const calendars = listed.filter(
    (c) =>
      !c.deleted && c.selected !== false && c.accessRole !== "freeBusyReader",
  );
  if (!calendars.some((c) => c.primary))
    calendars.unshift({ id: "primary", primary: true, timeZone: "UTC" });
  if (calendars.length > 30)
    throw Error(
      "More than 30 selected calendars. Choose fewer calendars in Google.",
    );
  const output = [];
  for (const calendar of calendars) {
    const key = calendar.primary ? "primary" : calendar.id;
    const query = `?timeMin=${encodeURIComponent(window.from)}&timeMax=${encodeURIComponent(window.to)}&singleEvents=true&showDeleted=true&maxResults=2500`;
    const events = await pages(
      `/calendars/${encodeURIComponent(key)}/events${query}`,
      token,
      fetchImpl,
    );
    for (const e of events.filter((e) => e.id))
      output.push({
        externalId: calendar.primary
          ? String(e.id ?? "")
          : `${calendar.id}:${e.id}`,
        title: (e.summary ?? "").trim() || null,
        startsAt:
          e.start?.dateTime ??
          (e.start?.date
            ? calendarMidnight(e.start.date, calendar.timeZone)
            : null),
        endsAt:
          e.end?.dateTime ??
          (e.end?.date
            ? calendarMidnight(e.end.date, calendar.timeZone)
            : null),
        allDay: !!e.start?.date,
        place: e.location ?? e.hangoutLink ?? null,
        description: e.description ?? null,
        cancelled: e.status === "cancelled",
        /*
         * THE NAME, NOT ONLY THE ADDRESS. Dropping displayName produced a
         * graph whose nodes were local parts of email addresses, and left
         * the resolver with nothing that could ever span one human's work
         * and university addresses.
         */
        attendees: (e.attendees ?? [])
          .filter((a) => a?.email)
          .map((a) => ({ email: a.email, name: a.displayName ?? null })),
      });
    if (output.length > maxEvents)
      throw Error(`More than ${maxEvents.toLocaleString()} events in this sync window.`);
  }
  return output;
}
