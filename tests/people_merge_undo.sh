#!/usr/bin/env bash
# people merge must keep everything the absorbed person owned, and people
# unmerge must put every row back.
#
# On 2026-10-21 merge was found deleting the absorbed person's phones, emails
# and Slack link: `identities` and `slack_links` reference people ON DELETE
# CASCADE and were missing from a hand-written table list. The first unmerge
# then deleted and reinserted observations, which cascaded their
# observation_dimensions away and zeroed a real person's score.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export PEOPLE_DIR="$T/people" NODE_NO_WARNINGS=1
pass=0; fail=0
ok(){ printf '  pass  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  fail  %s\n' "$1"; fail=$((fail+1)); }
P(){ node "$ROOT/bin/people" "$@"; }
q(){ node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);const r=d.prepare(process.argv[2]).all();console.log(r.map(x=>Object.values(x).join("|")).join("\n"))' "$PEOPLE_DIR/people.db" "$1"; }

P stats >/dev/null 2>&1
node -e '
const {DatabaseSync}=require("node:sqlite");
const d=new DatabaseSync(process.argv[1]); d.exec("PRAGMA foreign_keys=ON");
d.prepare("INSERT INTO people (id,name,company) VALUES (?,?,?)").run("keep","Sam Fake","Acme");
d.prepare("INSERT INTO people (id,name,phone) VALUES (?,?,?)").run("drop","Sam Fake","+15550100002");
d.prepare("INSERT INTO identities (person_id,kind,value) VALUES (?,?,?)").run("drop","phone","+15550100002");
d.prepare("INSERT INTO identities (person_id,kind,value) VALUES (?,?,?)").run("drop","email","sam@example.com");
const o=d.prepare("SELECT sql FROM sqlite_master WHERE name=?").get("observations").sql;
const cols=d.prepare("SELECT name,\"notnull\" nn,dflt_value dv,type FROM pragma_table_info(?)").all("observations");
const row={id:"obs1",person_id:"drop",body:"Sam grew up in Austin"};
for (const c of cols) if (c.nn && c.dv==null && !(c.name in row)) row[c.name]= /INT|REAL/.test(c.type)?0:(c.name==="subject_type"?"person":(c.name==="modality"?"note":"x"));
const k=Object.keys(row);
d.prepare(`INSERT INTO observations (${k.join(",")}) VALUES (${k.map(()=>"?").join(",")})`).run(...k.map(x=>row[x]));
const dim=d.prepare("SELECT id FROM dimensions LIMIT 1").get().id;
d.prepare("INSERT INTO observation_dimensions (observation_id,dimension_id) VALUES (?,?)").run("obs1",dim);
' "$PEOPLE_DIR/people.db" 2>"$T/seed.err" || { cat "$T/seed.err"; echo "seed failed"; exit 1; }

P merge keep drop --quiet >"$T/merge.out" 2>&1 || { cat "$T/merge.out"; no "merge ran"; }
[ "$(q "SELECT count(*) FROM identities WHERE person_id='keep'")" = 2 ] \
  && ok "merge moves the absorbed person's phone and email" || no "merge lost identities"
[ "$(q "SELECT phone FROM people WHERE id='keep'")" = "+15550100002" ] \
  && ok "merge fills a blank field from the absorbed person" || no "merge did not fill phone"
grep -q "people unmerge 1" "$T/merge.out" && ok "merge prints how to undo it" || no "no undo hint"

P unmerge last >"$T/unmerge.out" 2>&1 || { cat "$T/unmerge.out"; no "unmerge ran"; }
[ "$(q "SELECT name FROM people WHERE id='drop'")" = "Sam Fake" ] \
  && ok "unmerge brings the absorbed person back" || no "absorbed person missing"
[ "$(q "SELECT count(*) FROM identities WHERE person_id='drop'")" = 2 ] \
  && ok "unmerge gives back their phone and email" || no "identities not restored"
[ "$(q "SELECT person_id FROM observations WHERE id='obs1'")" = drop ] \
  && ok "unmerge gives back their observations" || no "observation not restored"
[ "$(q "SELECT count(*) FROM observation_dimensions WHERE observation_id='obs1'")" = 1 ] \
  && ok "unmerge keeps observation_dimensions (no cascade)" || no "observation_dimensions cascaded away"
[ -z "$(q "SELECT phone FROM people WHERE id='keep'")" ] \
  && ok "unmerge clears the field the merge filled" || no "survivor kept the borrowed phone"

P unmerge 1 >/dev/null 2>&1 && no "a second unmerge was allowed" || ok "a merge cannot be undone twice"

# The review's repros, 2026-10-21. Each one is a way the first unmerge
# rewrote or lost data that was not the merge's to give back.
x(){ node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA foreign_keys=ON");d.exec(process.argv[2])' "$PEOPLE_DIR/people.db" "$1"; }

# 1. An edit to the survivor's own fact after the merge survives the unmerge.
x "INSERT INTO quick_facts (person_id,key,value) VALUES ('keep','note','old')"
P merge keep drop --quiet >/dev/null 2>&1
x "UPDATE quick_facts SET value='EDITED' WHERE person_id='keep' AND key='note'"
P unmerge last >/dev/null 2>&1
[ "$(q "SELECT value FROM quick_facts WHERE person_id='keep' AND key='note'")" = EDITED ] \
  && ok "unmerge leaves the survivor's own edits alone" || no "unmerge rewrote a survivor edit"

# 2. A collided row's rowid reused after the merge is not overwritten.
x "DELETE FROM quick_facts; INSERT INTO quick_facts (person_id,key,value) VALUES ('keep','city','LA'); INSERT INTO quick_facts (person_id,key,value) VALUES ('drop','city','SF')"
P merge keep drop --quiet >/dev/null 2>&1
x "INSERT INTO quick_facts (person_id,key,value) VALUES ('keep','school','USC')"
P unmerge last >/dev/null 2>&1
[ "$(q "SELECT value FROM quick_facts WHERE person_id='keep' AND key='school'")" = USC ] \
  && ok "a row added after the merge survives a reused rowid" || no "unmerge overwrote a new row"
[ "$(q "SELECT value FROM quick_facts WHERE person_id='drop' AND key='city'")" = SF ] \
  && ok "the collided fact comes back to the absorbed person" || no "collided fact lost"

# 3. Both were in a circle, so the absorbed membership collided and was
#    deleted; the circle is then deleted, so it cannot be reinserted.
x "INSERT INTO circles (id,name) VALUES ('c1','Club'); INSERT INTO circle_members (circle_id,person_id) VALUES ('c1','drop'), ('c1','keep')" 2>/dev/null
if [ "$(q "SELECT count(*) FROM circle_members WHERE person_id='drop'")" = 1 ]; then
  P merge keep drop --quiet >/dev/null 2>&1
  x "DELETE FROM circle_members WHERE circle_id='c1'; DELETE FROM circles WHERE id='c1'"
  P unmerge last >/dev/null 2>&1 && no "unmerge ignored a row it could not restore" || ok "unmerge refuses when a row cannot go back"
  P unmerge last --force >/dev/null 2>&1 && [ "$(q "SELECT count(*) FROM people WHERE id='drop'")" = 1 ] \
    && ok "--force undoes the rest" || no "--force could not undo"
else
  no "could not seed a circle membership (schema changed?)"
fi

# 4. Two people with the same live visibility rule can still be merged.
x "INSERT INTO visibility (id,item_type,item_id,scope_type) VALUES ('v1','person','keep','everyone'), ('v2','person','drop','everyone')"
P merge keep drop --quiet >/dev/null 2>&1 \
  && ok "merge survives a duplicate visibility rule" || no "visibility rule aborted the merge"

echo "  ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
