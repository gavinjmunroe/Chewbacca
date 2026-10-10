#!/bin/bash
# chewbacca linkedin must read LinkedIn through the user's own Chrome tab and
# never push past LinkedIn's pushback: Voyager responses parse into the fields
# each command promises, calls inside one command sit at least 2 s apart, and
# the first 429, 999 or /checkpoint redirect stops the command with no retry.
# chrome-js is faked (CHEWBACCA_CHROME_JS): no Chrome, no network, no account.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }

cat > "$T/chrome-js" <<'PY'
#!/usr/bin/env python3
# Fake chrome-js. --list prints the tabs; a START script logs "<time> <path>"
# and remembers the path; a POLL script answers with the fixture for it.
import json, os, re, sys, time
d = os.environ["FAKE_DIR"]
args = sys.argv[1:]
assert args[0] == "--real", "chewbacca linkedin must target the real Chrome"
tabs = os.environ.get("FAKE_TABS", "https://www.linkedin.com/feed/").split("|")
if "--list" in args:
    print("\n".join(tabs)); sys.exit(0)
# Only exact targeting is accepted: a substring --match is what let a decoy in.
assert "--url" in args and "--match" not in args, "tab must be targeted by exact --url"
target = args[args.index("--url") + 1]
if target not in tabs:
    print("NO_TAB_MATCHING: " + target); sys.exit(0)
with open(os.path.join(d, "targets.log"), "a") as f:
    f.write(target + "\n")
src = open(args[args.index("--file") + 1]).read()
origin = os.environ.get("FAKE_ORIGIN", "https://www.linkedin.com")
if "window.__chewLi[key] = null" in src:
    open(os.path.join(d, "script.js"), "w").write(src)
    path = json.loads(re.search(r"var path = (\"[^\"]*\")", src).group(1))
    with open(os.path.join(d, "calls.log"), "a") as f:
        f.write(f"{time.monotonic()} {path}\n")
    open(os.path.join(d, "last"), "w").write(path)
    print(json.dumps({"started": "k", "page": target, "origin": origin})); sys.exit(0)
path = open(os.path.join(d, "last")).read()
status = int(os.environ.get("FAKE_STATUS", "200"))
url = os.environ.get("FAKE_URL", "https://www.linkedin.com" + path)
fx = json.load(open(os.path.join(d, "fixtures.json")))
body = next((v for k, v in fx.items() if k in path), {"elements": []})
print(json.dumps({"status": status, "url": url, "body": json.dumps(body), "origin": origin}))
PY
chmod +x "$T/chrome-js"

python3 - "$T/fixtures.json" <<'PY'
import json, sys
person = lambda n, pid, d: {"itemUnion": {"entityResult": {
    "title": {"text": n}, "primarySubtitle": {"text": "Student at USC"},
    "secondarySubtitle": {"text": "Los Angeles, CA"},
    "navigationUrl": f"https://www.linkedin.com/in/{pid}?miniProfileUrn=x",
    "entityCustomTrackingInfo": {"memberDistance": d}}}}
P = "com.linkedin.voyager.dash.identity.profile."
json.dump({
  "/voyager/api/me": {"included": [{"$type": "com.linkedin.voyager.identity.shared.MiniProfile",
      "firstName": "Tess", "lastName": "Trojan", "occupation": "Student at USC",
      "publicIdentifier": "tess-trojan", "dashEntityUrn": "urn:li:fsd_profile:ACoTESS"}]},
  "identity/dash/profiles": {"included": [
      {"$type": P + "Profile", "entityUrn": "urn:li:fsd_profile:A1", "firstName": "Tess", "lastName": "Trojan",
       "headline": "Student at USC", "summary": "I build things.", "publicIdentifier": "tess-trojan",
       "geoLocation": {"geoUrn": "urn:li:fsd_geo:1"}, "websites": [{"url": "https://tess.dev"}]},
      {"$type": "com.linkedin.voyager.dash.common.Geo", "entityUrn": "urn:li:fsd_geo:1",
       "defaultLocalizedName": "Los Angeles, California, United States"},
      {"$type": P + "Position", "profileUrn": "urn:li:fsd_profile:A1", "title": "Founder", "companyName": "Fight On Labs",
       "dateRange": {"start": {"year": 2025, "month": 9}}},
      {"$type": P + "Position", "profileUrn": "urn:li:fsd_profile:A1", "title": "Intern", "companyName": "Old Co",
       "dateRange": {"start": {"year": 2024}, "end": {"year": 2024, "month": 8}}},
      {"$type": P + "Education", "profileUrn": "urn:li:fsd_profile:A1", "schoolName": "University of Southern California",
       "degreeName": "BS", "fieldOfStudy": "Innovation", "dateRange": {"start": {"year": 2025}, "end": {"year": 2029}}}]},
  "resultType:List(SCHOOLS)": {"elements": [{"items": [{"itemUnion": {"entityResult": {
      "title": {"text": "University of Southern California"}, "trackingUrn": "urn:li:company:3084"}}}]}]},
  "resultType:List(PEOPLE)": {"elements": [{"items": [{"itemUnion": {"simpleTextV2": {}}}]},
      {"items": [person("Ada Lovelace", "ada-l", "DISTANCE_2"), person("Tommy Trojan", "tommy", "DISTANCE_1")]}]},
  "organization/companies": {"elements": [{"name": "Fight On Labs", "universalName": "fightonlabs",
      "tagline": "We build for SC", "companyIndustries": [{"localizedName": "Software Development"}],
      "staffCount": 12, "companyPageUrl": "https://fighton.dev", "entityUrn": "urn:li:fs_normalized_company:777",
      "headquarter": {"city": "Los Angeles", "geographicArea": "California", "country": "US"}}]},
  "relationships/dash/connections": {"included": [
      {"$type": "com.linkedin.voyager.dash.relationships.Connection", "connectedMember": "urn:li:fsd_profile:C1"},
      {"$type": P + "Profile", "entityUrn": "urn:li:fsd_profile:C1", "firstName": "Ada", "lastName": "Lovelace",
       "headline": "Analyst", "publicIdentifier": "ada-l"}]},
  "voyagerIdentityDashNotificationCards": {"included": [
      {"$type": "com.linkedin.voyager.dash.identity.notifications.Card", "headline": {"text": "Ada viewed your profile"}, "publishedAt": 1760000000000},
      {"$type": "com.linkedin.voyager.dash.identity.notifications.Card", "headline": {"text": "Older one"}, "publishedAt": 1750000000000}]},
  "voyagerMessagingGraphQL": {"included": [
      {"$type": "com.linkedin.messenger.Conversation", "entityUrn": "urn:li:msg_conversation:1", "lastActivityAt": 1760000000000,
       "unreadCount": 1, "*conversationParticipants": ["urn:li:msg_messagingParticipant:urn:li:fsd_profile:ACoTESS",
       "urn:li:msg_messagingParticipant:urn:li:fsd_profile:ADA"], "messages": {"*elements": ["urn:li:msg_message:9"]}},
      {"$type": "com.linkedin.messenger.MessagingParticipant", "entityUrn": "urn:li:msg_messagingParticipant:urn:li:fsd_profile:ADA",
       "participantType": {"member": {"firstName": {"text": "Ada"}, "lastName": {"text": "Lovelace"}}}},
      {"$type": "com.linkedin.messenger.Message", "entityUrn": "urn:li:msg_message:9", "body": {"text": "see you at the lab"}}]},
}, open(sys.argv[1], "w"))
PY

export FAKE_DIR="$T" CHEWBACCA_CHROME_JS="$T/chrome-js" CHEWBACCA_ROOT="$ROOT" CHEWBACCA_LINKEDIN_POLL=0.01
li() { : > "$T/calls.log"; bash "$ROOT/bin/chewbacca" linkedin "$@"; }
calls() { grep -c . "$T/calls.log"; }

out="$(li me --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d=={"name":"Tess Trojan","headline":"Student at USC","publicId":"tess-trojan"}, d' \
  || no "me did not parse: $out"
grep -q "method: 'GET'" "$T/script.js" || no "the in-page request is not hardcoded to GET"
grep -q "indexOf('/voyager/api/') !== 0" "$T/script.js" || no "the in-page request does not refuse non-Voyager paths"

out="$(li profile https://www.linkedin.com/in/tess-trojan/ --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d["location"].startswith("Los Angeles"), d
assert d["current"] == [{"title":"Founder","company":"Fight On Labs","since":"2025-09"}], d["current"]
assert d["education"][0]["school"] == "University of Southern California" and d["education"][0]["years"] == "2025-2029"
assert d["websites"] == ["https://tess.dev"] and d["about"] == "I build things."' || no "profile did not parse (or kept an ended position): $out"
grep -q "memberIdentity=tess-trojan" "$T/calls.log" || no "profile URL was not reduced to its public id"

# --school resolves the school, then searches: two calls, 2 s apart at least.
out="$(li people founder --school USC --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert [r["publicId"] for r in d] == ["ada-l","tommy"] and d[0]["degree"] == "2nd" and d[1]["degree"] == "1st", d' \
  || no "people did not parse: $out"
grep -q "schoolFilter:List(3084)" "$T/calls.log" || no "--school USC did not filter on the resolved school id"
[ "$(calls)" = 2 ] || no "people --school made $(calls) calls, want 2"
awk 'NR==1{a=$1} NR==2{exit !($1-a >= 2.0)}' "$T/calls.log" || no "Voyager calls inside one command were under 2 s apart"

out="$(li company https://www.linkedin.com/company/fightonlabs/ --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d["tagline"]=="We build for SC" and d["industry"]=="Software Development" and d["staffCount"]==12
assert d["headquarters"]=="Los Angeles, California, US" and d["website"]=="https://fighton.dev"' || no "company did not parse: $out"

out="$(li employees fightonlabs engineer --json 2>&1)"
grep -q "currentCompany:List(777)" "$T/calls.log" || no "employees did not filter on the company id"
grep -q "keywords:engineer" "$T/calls.log" || no "employees dropped its keywords"

out="$(li connections --limit 5 --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d==[{"name":"Ada Lovelace","headline":"Analyst","publicId":"ada-l"}], d' \
  || no "connections did not parse: $out"

out="$(li notifications --json 2>&1)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert [r["text"] for r in d]==["Ada viewed your profile","Older one"], d' \
  || no "notifications did not parse newest first: $out"

out="$(CHEWBACCA_LINKEDIN_INBOX_QUERY=messengerConversations.abc li inbox --json 2>&1)"
printf '%s' "$out" | python3 -c '
import json,sys; d=json.load(sys.stdin)
assert d==[{"participants":["Ada Lovelace"],"snippet":"see you at the lab","time":d[0]["time"],"unread":True}], d' \
  || no "inbox did not list the thread without the user in it: $out"
grep -qi "markAsRead\|read:true\|/messaging/conversations/" "$T/script.js" && no "inbox touched a read-state path"

# Pushback stops on the first answer, with no retry and no second call.
for case in "FAKE_STATUS=429" "FAKE_STATUS=999" "FAKE_URL=https://www.linkedin.com/checkpoint/challenge/x"; do
  out="$(env "$case" bash -c ': > "$FAKE_DIR/calls.log"; bash "$CHEWBACCA_ROOT/bin/chewbacca" linkedin employees fightonlabs' 2>&1)"; rc=$?
  [ "$rc" = 4 ] || no "$case: exit $rc, want 4"
  printf '%s' "$out" | grep -q "STOPPED" || no "$case: no STOPPED line: $out"
  [ "$(calls)" = 1 ] || no "$case: made $(calls) calls after pushback, want 1"
done

# A tab already sitting on /login is refused before any call.
out="$(FAKE_TABS=https://www.linkedin.com/login li me 2>&1)"; rc=$?
[ "$rc" = 4 ] && [ "$(calls)" = 0 ] || no "a /login tab was not refused before calling (rc $rc, $(calls) calls)"

# Origin validation (security review of 458aec97). A tab only counts as
# LinkedIn when its URL parses to https and a host of exactly
# www.linkedin.com or linkedin.com; LinkedIn in a path, query, userinfo or a
# lookalike host is a decoy, and no script may run in it.
for decoy in "https://evil.example/?next=www.linkedin.com" "https://evil.example/www.linkedin.com/feed/" \
             "https://www.linkedin.com.evil.example/feed/" "https://evilwww.linkedin.com/feed/" \
             "http://www.linkedin.com/feed/" "https://www.linkedin.com@evil.example/feed/" \
             "https://www.linkedin.com:8443/feed/"; do
  : > "$T/targets.log"
  out="$(CHEWBACCA_CHROME_DIR="$T/no-chrome" FAKE_TABS="$decoy" li me 2>&1)"; rc=$?
  [ "$rc" != 0 ] || no "decoy tab $decoy was accepted"
  [ -s "$T/targets.log" ] && no "a script ran in decoy tab $decoy"
done
# A decoy listed first is skipped for the real tab behind it.
: > "$T/targets.log"
FAKE_TABS="https://evil.example/?linkedin.com|https://www.linkedin.com/feed/" li me >/dev/null 2>&1 \
  || no "the real LinkedIn tab behind a decoy was not used"
grep -qv '^https://www.linkedin.com/feed/$' "$T/targets.log" && no "a script was sent to a tab other than the exact LinkedIn one"
# The page reports a different origin: refused, and no request is polled for.
out="$(FAKE_ORIGIN=https://evil.example li me 2>&1)"; rc=$?
[ "$rc" = 5 ] || no "an answer from origin https://evil.example was accepted (rc $rc): $out"
grep -q "location.origin !== \"https://www.linkedin.com\"" "$T/script.js" || no "the in-page script has no origin guard"
grep -q "fetch(origin + path" "$T/script.js" || no "fetch URL is not built from the fixed origin"

# The env var can raise the pause, never lower it under 2 s.
grep -q 'PAUSE = max(2.0' "$ROOT/bin/chewbacca-linkedin" || no "the 2 s throttle floor is gone"

[ "$fail" -eq 0 ] && echo "chewbacca linkedin: ok"
exit "$fail"
