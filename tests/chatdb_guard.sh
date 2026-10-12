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
# 2026-10-12: a count may pass the thread rule, so everything that could still
# hand back words stays refused.
t "count beside a text column"  2 "sqlite3 ~/Library/Messages/chat.db \"select count(*), text from message where is_from_me=1\""
t "count beside group_concat"   2 "sqlite3 ~/Library/Messages/chat.db \"select count(*), group_concat(attributedBody) from message where is_from_me=0\""
t "star beside a count"         2 "sqlite3 ~/Library/Messages/chat.db \"select count(*), m.* from message m where m.is_from_me=1\""
t "select star with is_from_me" 2 "sqlite3 ~/Library/Messages/chat.db \"select * from message where is_from_me=0\""
t "count piped onward"          2 "sqlite3 ~/Library/Messages/chat.db \"select count(*) from message where is_from_me=0\" | head"
t "count after a cd"            2 "cd ~ && sqlite3 Library/Messages/chat.db \"select count(*) from chat_message_join\""
t "count from a sql file"       2 "sqlite3 ~/Library/Messages/chat.db \".read q.sql\" \"select sum(is_from_me) from message\""
t "count redirected from a file" 2 "sqlite3 ~/Library/Messages/chat.db < q.sql # is_from_me"
t "count with a substitution"   2 "sqlite3 ~/Library/Messages/chat.db \"\$(cat q.sql) select sum(is_from_me) from message\""
t "a chat id beside a count" 2 "sqlite3 -readonly ~/Library/Messages/chat.db \"select chat_id, count(*) from chat_message_join group by chat_id order by 2 desc limit 5\""
t "a count over a subquery"   2 "sqlite3 ~/Library/Messages/chat.db \"select count(*) from message where ROWID in (select message_id from chat_message_join) and is_from_me=0\""
t "a dot mode before a count" 2 "sqlite3 ~/Library/Messages/chat.db .headers \"select count(*) from message where is_from_me=1\""
t "max of a handle"            2 "sqlite3 ~/Library/Messages/chat.db \"select max(chat_identifier) from chat c join chat_message_join j on j.chat_id=c.ROWID\""
t "min of a handle id"          2 "sqlite3 ~/Library/Messages/chat.db \"select min(h.id), count(*) from message m join handle h on h.ROWID=m.handle_id where m.is_from_me=0\""
t "count through python"        2 "python3 -c \"import sqlite3; print(sqlite3.connect('chat.db').execute('select count(*), sum(is_from_me) from message').fetchall())\""
echo "SHOULD PASS (exit 0):"
# 2026-10-12, the weekly false-positive report's top refusal: a volume check
# that returns three numbers, after which the agent typed RAW_MESSAGES_OK=1.
t "the 10-12 volume check" 0 "sqlite3 \"file:\$HOME/Library/Messages/chat.db?mode=ro\" \"select count(*), sum(associated_message_type!=0), sum(is_from_me) from message where date > (strftime('%s','now','-35 days')-978307200)*1000000000\""

t "decodes attributedBody" 0 "sqlite3 ~/Library/Messages/chat.db \"select text, attributedBody from message where text like '%x%' or attributedBody is not null\""
t "people texts search"  0 'people texts search "pasadena"'
t "count query, no text filter" 0 "sqlite3 ~/Library/Messages/chat.db \"select count(*) from message\""
t "people.db schema"     0 "sqlite3 ~/.chewbacca/people/people.db \".schema messages\""
t "people.db fixture insert" 0 "sqlite3 \"\$DB\" \"INSERT INTO messages (msg_id, who, from_me, body, sent_at) VALUES (1,'a',0,'b','c')\""
t "people.db count by source" 0 "sqlite3 ~/.chewbacca/people/people.db \"SELECT source, count(*) FROM messages GROUP BY source\""
t "explicit reader debugging" 0 "RAW_MESSAGES_OK=1 sqlite3 chat.db \"select is_from_me from message limit 1\""
t "people texts owed"    0 'people texts owed --json'
t "python heredoc writing a chat.db fixture" 0 "cd ~/code/chewbacca && python3 - <<'EOF'
s='sqlite3 chat2.db \"CREATE TABLE chat_message_join (chat_id INT)\" is_from_me'
EOF"
# Security review, 2026-10-10: the heredoc exemption let a python heredoc that
# opens the REAL message store read threads. A fixture never names the real path.
t "python heredoc reading the real chat.db" 2 "python3 - <<'EOF'
import sqlite3, os
c = sqlite3.connect(os.path.expanduser('~/Library/Messages/chat.db'))
print(c.execute('select text, is_from_me from message join chat_message_join').fetchall())
EOF"
t "python heredoc reading the real people.db" 2 "python3 - <<'EOF'
import sqlite3, os
c = sqlite3.connect(os.path.expanduser('~/.chewbacca/people/people.db'))
print(c.execute('select body, from_me from messages').fetchall())
EOF"
t "a plain sqlite3 thread read still refuses" 2 "sqlite3 ~/Library/Messages/chat.db \"select is_from_me from chat_message_join\""
t "other db"             0 "sqlite3 notes.db \"select * from notes where text like '%x%'\""
t "non-Bash tool"        0 'ignored'
t "context_text column"  0 "sqlite3 chat.db \"select * from message where subject_text like '%x%'\""
echo; echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
