/**
 * THE SQL COARSENING AND THE JAVASCRIPT COARSENING ARE THE SAME RULE.
 *
 * They have to exist twice: once for the write path and once inside the read
 * query, where it must run before the fine row can be loaded. Two hand-written
 * copies of an authorization rule is precisely how field-policy and
 * viewer-reach drifted apart, so both are generated from one array and this
 * file holds them to it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MAP_PLACE_REF_SQL, LOCATION_KINDS } from "./locations-store.js";
import { PLACE_REF_LADDER, PRECISIONS, resolvePlaceRef } from "../lib/geo.js";

test("the SQL names the ladder's columns in the ladder's order", () => {
  const found = [...MAP_PLACE_REF_SQL.matchAll(/THEN p\.(\w+) END/g)].map((m) => m[1]);
  assert.deepEqual(found, PLACE_REF_LADDER.map((r) => r.column));
});

test("the SQL knows exactly the precisions the ladder does, and no others", () => {
  const words = new Set([...MAP_PLACE_REF_SQL.matchAll(/WHEN '(\w+)' THEN/g)].map((m) => m[1]));
  assert.deepEqual([...words].sort(), [...PRECISIONS].sort());
  // If 'exact' ever appears here it is because somebody added a rung, and the
  // whole no-coordinates guarantee goes with it.
  assert.ok(!MAP_PLACE_REF_SQL.includes("exact"));
});

test("AN UNKNOWN PRECISION IS -1 IN SQL, which passes no guard", () => {
  // The JS clamps junk to 'country'. The SQL cannot clamp, so it ranks junk as
  // -1 -- and every rung guards `rank <= s.precision`, so a -1 precision
  // matches nothing and the row drops out of the map. Both directions are
  // safe; they are safe differently, and that is worth pinning.
  assert.ok(MAP_PLACE_REF_SQL.includes("ELSE -1 END"));
  for (const rung of PLACE_REF_LADDER) {
    if (rung.rank == null) continue;
    assert.ok(
      new RegExp(`${rung.rank} <= CASE s\\.precision`).test(MAP_PLACE_REF_SQL),
      `rung ${rung.column} must guard on the row's own precision`,
    );
  }
});

test("the named place is the first rung and is guarded by its own kind", () => {
  // A metro row asked for at neighborhood precision is still the metro. That
  // only works if the first rung ranks by `p.kind` rather than by a constant.
  assert.equal(PLACE_REF_LADDER[0].column, "place_id");
  assert.ok(MAP_PLACE_REF_SQL.indexOf("p.kind") < MAP_PLACE_REF_SQL.indexOf("p.metro_place_id"));
});

test("every rung the SQL has, the JS walks, for every precision", () => {
  // Exhaustive over the shapes that exist: each place kind, each subset of
  // recorded rollups, each precision. This is the table the SQL is generated to
  // match, so a change to one that is not a change to the other fails here.
  const kinds = [...PRECISIONS, null, "nonsense"];
  const subsets = [
    {},
    { metroPlaceId: "m" },
    { regionPlaceId: "r" },
    { countryPlaceId: "c" },
    { metroPlaceId: "m", regionPlaceId: "r" },
    { metroPlaceId: "m", regionPlaceId: "r", countryPlaceId: "c" },
  ];
  for (const kind of kinds) {
    for (const roll of subsets) {
      for (const want of [...PRECISIONS, "exact"]) {
        const place = { placeId: "self", kind, ...roll };
        const got = resolvePlaceRef(place, want);
        // The expectation, derived straight from the ladder: the first rung
        // whose id exists and whose rank is no finer than what was asked for.
        const wantRank = PRECISIONS.indexOf(want) < 0 ? 0 : PRECISIONS.indexOf(want);
        let expected = null;
        for (const rung of PLACE_REF_LADDER) {
          const id = place[rung.field];
          if (!id) continue;
          const rank = rung.rank == null ? PRECISIONS.indexOf(kind) : rung.rank;
          if (rank < 0 || rank > wantRank) continue;
          expected = id;
          break;
        }
        assert.equal(got, expected, `kind=${kind} roll=${JSON.stringify(roll)} want=${want}`);
      }
    }
  }
});

test("A ROW THAT CANNOT BE COARSENED IS JOINED AWAY, not returned null", () => {
  // The map query INNER JOINs on the resolved id. That is the difference
  // between a missing dot and a dot drawn at a precision nobody agreed to.
  const sql = String(MAP_PLACE_REF_SQL);
  assert.ok(sql.startsWith("COALESCE("), "all rungs null must produce NULL, not a fallback");
});

test("the kinds a location can be do not include a coordinate", () => {
  assert.deepEqual([...LOCATION_KINDS], ["home", "work", "current", "trip", "wish"]);
});
