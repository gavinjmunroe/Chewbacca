import test from "node:test";
import assert from "node:assert/strict";
import {
  PRECISIONS,
  COARSEST,
  DEFAULT_PRECISION,
  precisionRank,
  clampPrecision,
  coarserOf,
  finerOf,
  resolvePlaceRef,
  overlaps,
  activeAt,
  haversineKm,
  sameMetro,
} from "./geo.js";

const CHICAGO = {
  placeId: "metro-chi",
  kind: "metro",
  metroPlaceId: "metro-chi",
  regionPlaceId: "region-il",
  countryPlaceId: "country-us",
};

const LINCOLN_PARK = {
  placeId: "hood-lp",
  kind: "neighborhood",
  metroPlaceId: "metro-chi",
  regionPlaceId: "region-il",
  countryPlaceId: "country-us",
};

test("the precision ladder has no 'exact' rung, and that is the design", () => {
  // Nothing in the schema stores a person's own point, so no audience can ever
  // be shown one. Adding a rung here would be adding a way to leak.
  assert.ok(!PRECISIONS.includes("exact"));
  assert.deepEqual([...PRECISIONS], ["country", "region", "metro", "neighborhood"]);
  assert.equal(COARSEST, "country");
  assert.equal(DEFAULT_PRECISION, "metro");
});

test("AN UNRECOGNIZED PRECISION BECOMES THE COARSEST, not the default", () => {
  // This runs on input nobody checked. A typo in a client must narrow what is
  // shown, never widen it.
  for (const junk of ["street", "EXACT", "", null, undefined, 7, {}, "nieghborhood"]) {
    assert.equal(clampPrecision(junk), "country", `${String(junk)} should clamp to country`);
  }
  assert.equal(clampPrecision("Metro"), "metro");
  assert.equal(clampPrecision("  neighborhood "), "neighborhood");
});

test("rank orders coarse to fine, and an unknown word has no rank", () => {
  assert.ok(precisionRank("country") < precisionRank("region"));
  assert.ok(precisionRank("region") < precisionRank("metro"));
  assert.ok(precisionRank("metro") < precisionRank("neighborhood"));
  assert.equal(precisionRank("exact"), -1);
});

test("coarserOf reveals less, finerOf reveals more", () => {
  assert.equal(coarserOf("neighborhood", "metro"), "metro");
  assert.equal(coarserOf("country", "neighborhood"), "country");
  assert.equal(finerOf("country", "neighborhood"), "neighborhood");
  // An unknown word is not a winner in either direction; the known one survives.
  assert.equal(coarserOf("exact", "metro"), "metro");
  assert.equal(finerOf("exact", "metro"), "metro");
});

// ── coarsening ──────────────────────────────────────────────────────────────

test("A NEIGHBORHOOD SHOWN AT METRO PRECISION RESOLVES TO THE METRO ITSELF", () => {
  // Not to a rounded version of the neighborhood. The returned id is a real
  // place that existed before anybody stood in it, identical for everyone who
  // shares at that level, so intersecting two audiences' views yields the city.
  assert.equal(resolvePlaceRef(LINCOLN_PARK, "metro"), "metro-chi");
  assert.equal(resolvePlaceRef(LINCOLN_PARK, "region"), "region-il");
  assert.equal(resolvePlaceRef(LINCOLN_PARK, "country"), "country-us");
});

test("asked at its own precision, a place is itself", () => {
  assert.equal(resolvePlaceRef(LINCOLN_PARK, "neighborhood"), "hood-lp");
  assert.equal(resolvePlaceRef(CHICAGO, "metro"), "metro-chi");
});

test("PRECISION IS A CEILING, NOT A DEMAND", () => {
  // Somebody who named their city and allows neighborhood precision is still
  // shown as their city. There is nothing finer to show and nothing is invented.
  assert.equal(resolvePlaceRef(CHICAGO, "neighborhood"), "metro-chi");
});

test("IT FAILS COARSE: a missing rollup hides the dot rather than showing a finer one", () => {
  // The one way this design can leak. A neighborhood whose metro was never
  // recorded, asked for at metro precision, must NOT fall back to itself.
  const orphan = {
    placeId: "hood-unknown",
    kind: "neighborhood",
    metroPlaceId: null,
    regionPlaceId: null,
    countryPlaceId: null,
  };
  assert.equal(resolvePlaceRef(orphan, "metro"), null);
  assert.equal(resolvePlaceRef(orphan, "country"), null);
  // It is still itself when that is what was asked for.
  assert.equal(resolvePlaceRef(orphan, "neighborhood"), "hood-unknown");
});

test("a missing rung falls OUTWARD to the next coarser one", () => {
  const noMetro = { ...LINCOLN_PARK, metroPlaceId: null };
  assert.equal(resolvePlaceRef(noMetro, "metro"), "region-il");
  const onlyCountry = { ...LINCOLN_PARK, metroPlaceId: null, regionPlaceId: null };
  assert.equal(resolvePlaceRef(onlyCountry, "metro"), "country-us");
});

test("a country asked for at metro precision is a country", () => {
  const usa = {
    placeId: "country-us",
    kind: "country",
    metroPlaceId: null,
    regionPlaceId: null,
    countryPlaceId: "country-us",
  };
  assert.equal(resolvePlaceRef(usa, "metro"), "country-us");
  assert.equal(resolvePlaceRef(usa, "neighborhood"), "country-us");
});

test("garbage in resolves to nothing, not to something", () => {
  assert.equal(resolvePlaceRef(null, "metro"), null);
  assert.equal(resolvePlaceRef({}, "metro"), null);
  assert.equal(resolvePlaceRef({ placeId: "x", kind: "galaxy" }, "metro"), null);
});

test("an unknown precision coarsens the ANSWER too, not just the word", () => {
  // clampPrecision sends junk to 'country', so a neighborhood asked for with a
  // typo comes back as the country rather than the neighborhood.
  assert.equal(resolvePlaceRef(LINCOLN_PARK, "street"), "country-us");
});

// ── time ────────────────────────────────────────────────────────────────────

test("overlapping trips overlap, and touching trips count as overlapping", () => {
  const d = (s) => new Date(s).toISOString();
  assert.ok(overlaps(d("2026-10-01"), d("2026-10-05"), d("2026-10-04"), d("2026-10-09")));
  // Same day is the same city, not a miss by a boundary condition.
  assert.ok(overlaps(d("2026-10-01"), d("2026-10-05"), d("2026-10-05"), d("2026-10-09")));
  assert.ok(!overlaps(d("2026-10-01"), d("2026-10-05"), d("2026-10-06"), d("2026-10-09")));
});

test("a null bound is open in that direction", () => {
  const d = (s) => new Date(s).toISOString();
  assert.ok(overlaps(null, null, d("2026-10-04"), d("2026-10-09")));
  assert.ok(overlaps(d("2026-01-01"), null, d("2030-10-04"), null));
  assert.ok(!overlaps(null, d("2026-01-01"), d("2026-02-01"), null));
});

test("an undated location is true now and a past trip is not", () => {
  const now = new Date("2026-10-02").getTime();
  assert.ok(activeAt({}, now));
  assert.ok(activeAt({ startsAt: "2026-10-01", endsAt: "2026-10-05" }, now));
  assert.ok(!activeAt({ startsAt: "2026-09-01", endsAt: "2026-09-05" }, now));
  assert.ok(!activeAt({ startsAt: "2026-11-01" }, now));
  assert.ok(activeAt({ startsAt: "2026-01-01" }, now));
});

// ── display distance, which authorizes nothing ──────────────────────────────

test("distance is roughly right and refuses impossible points", () => {
  const chi = { lat: 41.8781, lon: -87.6298 };
  const nyc = { lat: 40.7128, lon: -74.006 };
  const km = haversineKm(chi, nyc);
  assert.ok(km > 1100 && km < 1200, `Chicago to New York came out ${km}`);
  assert.equal(haversineKm(chi, chi), 0);
  assert.equal(haversineKm(chi, { lat: 91, lon: 0 }), null);
  assert.equal(haversineKm(chi, null), null);
  assert.equal(haversineKm(chi, { lat: "41", lon: "-87" }), null);
});

// ── co-presence ─────────────────────────────────────────────────────────────

test("CO-PRESENCE IS AN EQUALITY, NOT A RADIUS", () => {
  // A suburb and the city it is in are the same place for this purpose, which a
  // radius would get right only by being tuned, and would get wrong at the edge.
  assert.ok(sameMetro(CHICAGO, LINCOLN_PARK));
  assert.ok(sameMetro(LINCOLN_PARK, { ...LINCOLN_PARK, placeId: "hood-wicker" }));
  assert.ok(!sameMetro(CHICAGO, { placeId: "metro-nyc", kind: "metro", metroPlaceId: "metro-nyc" }));
});

test("a place with no metro is not co-present with anything, including itself", () => {
  const orphan = { placeId: "hood-unknown", kind: "neighborhood", metroPlaceId: null };
  assert.ok(!sameMetro(orphan, orphan));
  assert.ok(!sameMetro(orphan, CHICAGO));
});
