/**
 * Area-code → region heuristic. The LAST-RESORT tier of location retrieval: when
 * we have no saved info and no enrichment for a "who do I know in <place>" query,
 * a contact's phone area code is a weak-but-real signal of where they're from.
 * It's a heuristic (mobile numbers keep their original area code after a move),
 * so it's surfaced as "these MIGHT be there — want to ask them?", never asserted.
 *
 * Coverage is the major US metros people actually query; extend REGIONS freely.
 */

const REGIONS = [
  { name: "New York City", aliases: ["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx"], codes: ["212", "646", "332", "917", "718", "347", "929"] },
  { name: "Los Angeles", aliases: ["los angeles", "l.a.", "socal", "hollywood"], codes: ["213", "323", "310", "424", "818", "747", "661", "626"] },
  { name: "San Francisco Bay Area", aliases: ["san francisco", "sf", "bay area", "oakland", "silicon valley", "palo alto", "san jose"], codes: ["415", "628", "510", "341", "650", "408", "669", "925"] },
  { name: "Chicago", aliases: ["chicago"], codes: ["312", "773", "872", "708", "847", "224", "331", "630"] },
  { name: "Boston", aliases: ["boston"], codes: ["617", "857", "781", "339", "508", "774"] },
  { name: "Washington DC", aliases: ["washington dc", "washington, d.c", "d.c.", " dc "], codes: ["202", "771", "703", "571", "240", "301"] },
  { name: "Seattle", aliases: ["seattle"], codes: ["206", "253", "425", "564"] },
  { name: "Austin", aliases: ["austin"], codes: ["512", "737"] },
  { name: "Dallas", aliases: ["dallas", "fort worth", "dfw"], codes: ["214", "469", "972", "817", "682", "945"] },
  { name: "Houston", aliases: ["houston"], codes: ["713", "281", "832", "346"] },
  { name: "Miami", aliases: ["miami", "south florida"], codes: ["305", "786", "954", "754"] },
  { name: "Atlanta", aliases: ["atlanta"], codes: ["404", "470", "678", "770"] },
  { name: "Philadelphia", aliases: ["philadelphia", "philly"], codes: ["215", "267", "445", "484", "610"] },
  { name: "Denver", aliases: ["denver"], codes: ["303", "720", "983"] },
  { name: "Phoenix", aliases: ["phoenix"], codes: ["602", "480", "623"] },
  { name: "San Diego", aliases: ["san diego"], codes: ["619", "858", "760"] },
  { name: "Portland", aliases: ["portland"], codes: ["503", "971"] },
  { name: "Nashville", aliases: ["nashville"], codes: ["615", "629"] },
];

/** Match a free-text query to a known region, or null. */
export function regionForQuery(q) {
  const s = ` ${String(q || "").toLowerCase()} `;
  for (const r of REGIONS) {
    if (r.aliases.some((a) => s.includes(a))) return r;
  }
  return null;
}

/** Pull the 3-digit US area code from a phone number, or null. */
export function areaCodeOf(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const d = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  return d.length >= 3 ? d.slice(0, 3) : null;
}

/**
 * Contacts whose phone area code falls in the queried region. Reads phone from
 * the common shapes. Returns { region, matches:[{id,name,phone,areaCode}] } or
 * { region:null, matches:[] } when the query names no known region.
 */
export function contactsByAreaCode(query, contacts) {
  const region = regionForQuery(query);
  if (!region || !Array.isArray(contacts)) return { region: null, matches: [] };
  const codes = new Set(region.codes);
  const matches = [];
  for (const c of contacts) {
    const phone = c.phone || c.phoneNumber || c.phone_number ||
      (Array.isArray(c.phoneNumbers) ? c.phoneNumbers[0] : null);
    const ac = areaCodeOf(phone);
    if (ac && codes.has(ac)) {
      matches.push({ id: String(c.id ?? c.contactId ?? ""), name: c.full_name || c.name || "", phone, areaCode: ac });
    }
  }
  return { region, matches };
}
