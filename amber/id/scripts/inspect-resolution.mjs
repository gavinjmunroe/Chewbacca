import * as db from "../src/db/sql.js";
import * as store from "../src/db/store.js";
import { resolveContactByName } from "../src/lib/fact-capture.js";

const OWNER = "35a94acc-5d39-488b-9b01-a239c8255076";
const run = ["query","sql","all","rows"].map((k)=>db[k]).find((f)=>typeof f==="function");

const loader = store.getContactsForResolution || store.loadContactsByOwnerId;
console.log("loader:", loader?.name || "(none found)");
const contacts = await loader(OWNER);
console.log("contacts loaded:", Array.isArray(contacts) ? contacts.length : typeof contacts);
console.log("shape:", JSON.stringify(Object.keys(contacts?.[0] ?? {})));

for (const n of ["Spencer", "Eli", "Ajay", "AJ"]) {
  const r = resolveContactByName(n, contacts);
  console.log(`\n"${n}" -> ${r.status}  matched=${r.matchedName ?? "-"}`);
  for (const c of (r.candidateObjects ?? [])) console.log("    cand:", c.name, c.id);
}

const dupes = await run(
  `SELECT full_name, count(*) n FROM contacts
    WHERE owner_id = $1 AND deleted_at IS NULL
    GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 10`, [OWNER]);
console.log("\n--- duplicate names in this book ---");
for (const r of (dupes.rows ?? dupes)) console.log(" ", r.n, r.full_name);

await db.closePool?.();
