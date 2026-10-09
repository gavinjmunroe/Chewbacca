// @ts-nocheck
// people help: the text printed by `people`, `people help`, and after an
// unknown command.

"use strict";

const { c } = require("./output");
const { DIR } = require("./db");

const HELP = `${c.b("people")} ${c.dim("- everything you know about the people in your life")}

  ${c.b("people add")} "Maggie Chen" --company Acme --role CTO --met "SXSW 2026"
  ${c.b("people note")} maggie "just got promoted" --dim financial
  ${c.b("people note")} maggie "thinking about moving to SF" --modality planned
  ${c.b("people log")} maggie --channel call "caught up about the move"
  ${c.b("people show")} maggie
  ${c.b("people brief")} maggie                  ${c.dim("before you write to them: refuses if the identity is split")}
  ${c.b("people list")} [--by score]
  ${c.b("people me")} "starting the neuro sequence" --dim intellectual

  ${c.b("people circle create")} "Hiking" --desc "people I hike with"
  ${c.b("people circle add")} Hiking maggie declan
  ${c.b("people circle classify")} Hiking --kind interest --fact "enjoys hiking"
  ${c.b("people circle")} [list|show|remove|delete]

  ${c.b("people today")}                      birthdays + who is slipping
  ${c.b("people reconnect")}                  who you owe a message
  ${c.b("people birthdays")} [--days 60]
  ${c.b("people date add")} maggie "wedding anniversary" --on 06-14
  ${c.b("people task add")} maggie "send her the book" --due 2026-09-20
  ${c.b("people tasks")} | ${c.b("people task done")} <ref>
  ${c.b("people loan")} maggie --lent "the Bonhoeffer book" | ${c.b("people loans")}
  ${c.b("people rel")} maggie mother declan      records both directions
  ${c.b("people check-on")} ben --in 14d --because "his thesis defense"
  ${c.b("people ask")} maggie                    what you still do not know
  ${c.b("people fact")} maggie food "no shellfish"

  ${c.b("people dashboard")}                     who you texted, ranked + categorised
  ${c.b("people dashboard --install")}           keep it running, and after a reboot

  ${c.b("people who")} "founders at YC"          ask who you know, in a sentence

  ${c.b("people linkedin sync")}                 match a LinkedIn export to your contacts
  ${c.b("people linkedin audit")}                contacts with no LinkedIn connection
  ${c.b("people linkedin clay")} [--limit 5]     rows to enrich, in Clay's shape
  ${c.b("people linkedin changes")}              job changes, free, from your own exports
  ${c.b("people linkedin locate")}               where people live, free, via Clay search
  ${c.b("people linkedin locate --who <id>")}    one person, by row id when the name is shared

  ${c.b("people dedupe")}                        likely duplicate records
  ${c.b("people merge <keep> <absorb>")}         fold one record into another
  ${c.b("people events scan")}                   log what happened, from your texts

  ${c.b("people texts sync")}                    pull new iMessage and WhatsApp in (local only)
  ${c.b("people send")} maggie "text" [--via whatsapp] [--dry-run]   reply in the app the thread is in
  ${c.b("people send")} --room "Group Name" "text" [--via whatsapp]   a group chat, by its exact name
  ${c.b("people texts")} [--days 3] [--who maggie]   the running log
  ${c.b("people texts owed")} [--days 7] [--json]  who is waiting on a reply, with context
  ${c.b("people texts drafts")} [add who "text" | send n | drop n]   replies waiting for your ok
  ${c.b("people texts search")} "the trip"
  ${c.b("people texts stats")} | ${c.b("people texts link")} "Thread Name" <person>
  ${c.b("people update")} maggie --company Anthropic --cadence 30
  ${c.b("people intro")} Anthropic            who could introduce you
  ${c.b("people import")} --mac | --vcf FILE | --csv FILE
  ${c.b("people distill")} [--limit 50] [--dry-run]   turn new messages into facts, with Claude
  ${c.b("people identify")} [--min 25] [--dry-run]     work out who unnamed group senders are
  ${c.b("people classify")}                        work out what each group chat actually is
  ${c.b("people purge")} "Name" --yes                delete a person and their messages, for good
  ${c.b("people alias")}                          handles sending you texts that nobody owns
  ${c.b("people alias")} "Maya Patel" maya@example.com

  ${c.b("people rank")} [--dim financial] [--limit 20]
  ${c.b("people search")} "hiking"
  ${c.b("people dims")} [set financial --half-life 90 --weight 1.5]
  ${c.b("people tune")} [saturation_k 0.5]
  ${c.b("people score")}

  ${c.b("people history")} "Sam" [--days 365] [--steps 12]   how it changed
  ${c.b("people trend")} [--days 90]                           who is warming, who is cooling
  ${c.b("people snapshot")}                                    freeze today so the curve keeps it

  ${c.b("people export")} [--out DIR]        markdown you can read
  ${c.b("people sync")} init <private-git-url> | push | pull | diff | status
  ${c.b("people check")} | ${c.b("people stats")}

${c.dim("flags on note:")}
  --dim spiritual,emotional,physical,intellectual,social,financial
  --modality actual|planned|hypothetical|desired|available|declined
  --source told_directly|observed|inferred|third_party|imported
  --kind fact|note|experience|memory|transcript
  --temporal permanent|window|decaying   --from DATE  --until DATE

${c.dim(`data: ${DIR}`)}
`;

module.exports = {
  HELP,
};
