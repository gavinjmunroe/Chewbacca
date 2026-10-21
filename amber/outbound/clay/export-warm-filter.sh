#!/usr/bin/env bash
# Build the WARM-FILTER join table from the local people store.
# Output is gitignored. It is 3,349 real people.
set -euo pipefail
DB="${PEOPLE_DB:-$HOME/.chewbacca/people/people.db}"
OUT="${1:-$(dirname "$0")/warm-filter.csv}"

[ -f "$DB" ] || { echo "no people store at $DB" >&2; exit 1; }

sqlite3 -header -csv "$DB" "
SELECT
  p.linkedin                                   AS linkedin_url,
  p.name                                       AS name,
  COALESCE(p.company,'')                       AS company,
  COALESCE(p.role,'')                          AS role,
  CASE WHEN COUNT(i.id) > 0 THEN 'known' ELSE '' END AS relationship,
  COUNT(i.id)                                  AS interaction_count,
  COALESCE(MAX(i.happened_at),'')              AS last_contact
FROM people p
LEFT JOIN interactions i ON i.person_id = p.id
WHERE p.deleted_at IS NULL
  AND p.linkedin IS NOT NULL AND p.linkedin <> ''
GROUP BY p.id
ORDER BY interaction_count DESC;
" > "$OUT"

echo "wrote $OUT  ($(( $(wc -l < "$OUT") - 1 )) rows)"
