#!/bin/bash
H="${CHATDB_GUARD_HOOK:-$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/chatdb-guard.sh}"
pass=0; fail=0
t() { # name, expected_exit, command
  out=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")" | bash "$H" 2>/dev/null)
  rc=$?
  if [ "$rc" = "$2" ]; then echo "  ok   $1 (exit $rc)"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $rc, wanted $2)"; fail=$((fail+1)); fi
}
echo "SHOULD BLOCK (exit 2):"
# The exact query from 2026-10-03 that returned 1 row instead of 2,213.
t "the incident query"   2 "sqlite3 ~/Library/Messages/chat.db \"SELECT m.text FROM message m WHERE m.text LIKE '%pasadena%' ORDER BY m.date;\""
t "bare text like"       2 "sqlite3 chat.db \"select text from message where text like '%boba%'\""
t "text glob"            2 "sqlite3 ~/Library/Messages/chat.db \"select * from message where text GLOB '*taco*'\""
# 2026-10-09: hand-built "who's waiting" queries, both shapes that were run.
t "unanswered via chat.db"  2 "sqlite3 -readonly ~/Library/Messages/chat.db \"SELECT c.chat_identifier FROM chat c JOIN chat_message_join cmj ON cmj.chat_id=c.ROWID JOIN message m ON m.ROWID=cmj.message_id WHERE m.is_from_me=0\""
t "thread read from people.db" 2 "cd ~/.chewbacca/people && sqlite3 people.db \"SELECT sent_at, from_me, body FROM messages WHERE who='Mom' ORDER BY sent_at DESC LIMIT 7\""
echo "SHOULD PASS (exit 0):"
t "decodes attributedBody" 0 "sqlite3 ~/Library/Messages/chat.db \"select text, attributedBody from message where text like '%x%' or attributedBody is not null\""
t "people texts search"  0 'people texts search "pasadena"'
t "count query, no text filter" 0 "sqlite3 ~/Library/Messages/chat.db \"select count(*) from message\""
t "people.db schema"     0 "sqlite3 ~/.chewbacca/people/people.db \".schema messages\""
t "people.db fixture insert" 0 "sqlite3 \"\$DB\" \"INSERT INTO messages (msg_id, who, from_me, body, sent_at) VALUES (1,'a',0,'b','c')\""
t "people.db count by source" 0 "sqlite3 ~/.chewbacca/people/people.db \"SELECT source, count(*) FROM messages GROUP BY source\""
t "explicit reader debugging" 0 "RAW_MESSAGES_OK=1 sqlite3 chat.db \"select is_from_me from message limit 1\""
t "people texts owed"    0 'people texts owed --json'
t "other db"             0 "sqlite3 notes.db \"select * from notes where text like '%x%'\""
t "non-Bash tool"        0 'ignored'
t "context_text column"  0 "sqlite3 chat.db \"select * from message where subject_text like '%x%'\""
echo; echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
