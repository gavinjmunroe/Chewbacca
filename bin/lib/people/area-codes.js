// @ts-nocheck
// people area codes: where a phone number's area code suggests somebody is.
//
// The weakest location evidence there is, and labelled that way everywhere it
// shows up. A mobile number keeps its area code after a move, so this says
// where somebody MIGHT be, never where they are. It only speaks for people with
// no stated location: somebody whose card says Austin has already answered.
//
// Upstream: `amber/id/src/lib/area-codes.js`. Orange County and the Inland
// Empire are added here because this store is mostly Southern California: on
// 2026-10-21, 714, 949 and 909 together held 66 people with no location, and
// folding them into "Los Angeles" would have answered a question about LA with
// people an hour away.

"use strict";

const REGIONS = [
  {
    name: "New York City",
    aliases: [
      "new york city",
      "new york",
      "nyc",
      "manhattan",
      "brooklyn",
      "queens",
      "bronx",
    ],
    codes: ["212", "646", "332", "917", "718", "347", "929"],
  },
  {
    name: "Los Angeles",
    aliases: ["los angeles", "la", "l.a.", "socal", "hollywood"],
    codes: ["213", "323", "310", "424", "818", "747", "661", "626"],
  },
  {
    name: "Orange County",
    aliases: ["orange county", "oc", "irvine", "anaheim", "newport beach"],
    codes: ["714", "657", "949"],
  },
  {
    name: "Inland Empire",
    aliases: ["inland empire", "riverside", "san bernardino"],
    codes: ["909", "951", "840"],
  },
  {
    name: "San Francisco Bay Area",
    aliases: [
      "san francisco bay area",
      "san francisco",
      "sf",
      "bay area",
      "oakland",
      "silicon valley",
      "palo alto",
      "san jose",
    ],
    codes: ["415", "628", "510", "341", "650", "408", "669", "925"],
  },
  {
    name: "Chicago",
    aliases: ["chicago"],
    codes: ["312", "773", "872", "708", "847", "224", "331", "630"],
  },
  {
    name: "Boston",
    aliases: ["boston"],
    codes: ["617", "857", "781", "339", "508", "774"],
  },
  {
    name: "Washington DC",
    aliases: ["washington dc", "dc", "d.c."],
    codes: ["202", "771", "703", "571", "240", "301"],
  },
  {
    name: "Seattle",
    aliases: ["seattle"],
    codes: ["206", "253", "425", "564"],
  },
  { name: "Austin", aliases: ["austin"], codes: ["512", "737"] },
  {
    name: "Dallas",
    aliases: ["dallas", "fort worth", "dfw"],
    codes: ["214", "469", "972", "817", "682", "945"],
  },
  {
    name: "Houston",
    aliases: ["houston"],
    codes: ["713", "281", "832", "346"],
  },
  {
    name: "Miami",
    aliases: ["miami", "south florida"],
    codes: ["305", "786", "954", "754"],
  },
  {
    name: "Atlanta",
    aliases: ["atlanta"],
    codes: ["404", "470", "678", "770"],
  },
  {
    name: "Philadelphia",
    aliases: ["philadelphia", "philly"],
    codes: ["215", "267", "445", "484", "610"],
  },
  { name: "Denver", aliases: ["denver"], codes: ["303", "720", "983"] },
  { name: "Phoenix", aliases: ["phoenix"], codes: ["602", "480", "623"] },
  { name: "San Diego", aliases: ["san diego"], codes: ["619", "858", "760"] },
  { name: "Portland", aliases: ["portland"], codes: ["503", "971"] },
  { name: "Nashville", aliases: ["nashville"], codes: ["615", "629"] },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The regions a place phrase names. Whole words only: Amber matched aliases as
 * substrings, which is fine for "austin" and wrong the moment "la" is an alias,
 * because "la" is inside "dallas" and "atlanta".
 */
function regionsFor(place) {
  const s = String(place || "").toLowerCase();
  return REGIONS.filter((r) =>
    r.aliases.some((a) =>
      new RegExp(`(^|[^a-z])${escape(a)}($|[^a-z])`).test(s),
    ),
  );
}

/**
 * A North American number's area code, or null. Anything that is not a
 * ten-digit NANP number (with or without the leading 1) is not guessed at: a
 * London +44 20 number must not read as area code 442.
 */
function areaCodeOf(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !raw.startsWith("+1")) return null;
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  return /^[2-9]/.test(d) ? d.slice(0, 3) : null;
}

module.exports = { REGIONS, regionsFor, areaCodeOf };
