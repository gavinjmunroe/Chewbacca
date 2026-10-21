import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarMidnight,
  readGoogleCalendars,
} from "./google-calendar-read.js";
test("all-day boundaries use calendar timezone across DST", () => {
  assert.equal(
    calendarMidnight("2026-03-08", "America/Los_Angeles"),
    "2026-03-08T08:00:00.000Z",
  );
  assert.equal(
    calendarMidnight("2026-03-09", "America/Los_Angeles"),
    "2026-03-09T07:00:00.000Z",
  );
});
test("pages every selected calendar, preserves primary IDs, details and cancellations", async () => {
  const fetcher = async (raw) => {
    const u = new URL(raw);
    let data;
    if (u.pathname.endsWith("calendarList"))
      data = {
        items: [
          { id: "me", primary: true, timeZone: "America/Los_Angeles" },
          { id: "team", selected: true },
          { id: "hidden", selected: false },
        ],
      };
    else if (u.pathname.includes("primary") && !u.searchParams.has("pageToken"))
      data = {
        items: [
          {
            id: "one",
            start: { date: "2026-09-23" },
            end: { date: "2026-09-24" },
            location: "Park",
            description: "Walk",
          },
        ],
        nextPageToken: "second",
      };
    else if (u.pathname.includes("primary"))
      data = { items: [{ id: "cancel", status: "cancelled" }] };
    else
      data = {
        items: [
          {
            id: "one",
            start: { dateTime: "2026-09-23T09:00:00Z" },
            end: { dateTime: "2026-09-23T10:00:00Z" },
          },
        ],
      };
    return { ok: true, json: async () => data };
  };
  const rows = await readGoogleCalendars(
    "fixture",
    { from: "2026-09-01", to: "2026-10-01" },
    fetcher,
  );
  assert.deepEqual(
    rows.map((r) => r.externalId),
    ["one", "cancel", "team:one"],
  );
  assert.equal(rows[0].startsAt, "2026-09-23T07:00:00.000Z");
  assert.equal(rows[0].allDay, true);
  assert.equal(rows[0].place, "Park");
  assert.equal(rows[1].cancelled, true);
});
