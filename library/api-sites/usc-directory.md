# usc-directory

USC's public faculty and staff directory (uscdirectory.usc.edu), read only, for looking up a professor's or staff member's title, department and contact details by name. The search page calls a public JSON route, `/web/directory/faculty-staff/proxy.php?basic=<text>`, with no USC login, and the op replays it at tier 1 (direct HTTP). The page also accepts the search in its URL hash (`/faculty-staff/#basic=<text>`), which is the trigger.

- `searchPeople(name)` -> name, fullName, title, department, email, phone, pvid

## Caveats

- name goes to the page's basic search, which also matches department and job title text. It returns at most 100 people; the page shows "Over 100" in that case.
- phone and some departments are missing for people who have not published them. department is the raw HR value and sometimes carries a cost center code ("1726-PMOB Lic Multispec Cl").
- pvid is the directory's person id. The page loads a single person's detail with `proxy.php?uscpvid=<pvid>`, which was not made an op.
- A name with no match comes back `ok: false, class: input` ("no results ... the operation works"). That path took 5 to 6 seconds because api-anything replays the example to confirm the op still works; a hit took about 0.4 seconds.
- Only the faculty and staff directory is covered. The student directory (`/web/directory/student/`) was not touched.
