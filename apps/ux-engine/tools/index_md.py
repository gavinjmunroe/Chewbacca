#!/usr/bin/env python3
"""Render data/systems.json as SYSTEMS.md, the one file an agent reads to choose.

Ordered by how strongly each system constrains itself, most-constrained first,
because the constrained ones are the ones that do not look generated. A system
with an empty `forbids` column will happily produce the same page as the house
rule.
"""
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
all_rows = json.loads((REPO / "data" / "systems.json").read_text())
rows = [r for r in all_rows if r["has_frontmatter"]]
unparsed = [r for r in all_rows if not r["has_frontmatter"]]
rows.sort(key=lambda r: (-len(r["forbids"]), r["name"]))

out = ["""# The systems

`""" + str(len(rows)) + """` machine-readable design systems extracted from real products, indexed so a
generator can pick one without reading 40,000 lines. Source corpus is
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(MIT), vendored under `systems/`.

**Read this file, pick a row, then read only that row's `DESIGN.md`.** Loading
more than one full system is how a page ends up looking like an average of all
of them, which is the generated look.

**The `forbids` column is the one that matters.** A brand is recognizable
because of what it refuses. Bugatti has no accent colour, no radius between 0
and a pill, and no display weight above 400, and those three refusals are most
of what makes a page read as Bugatti instead of as every other generated page.
Rows are sorted by how much they refuse.

| system | mode | canvas | accent | radius | max weight | refuses |
|---|---|---|---|---|---|---|"""]

for r in rows:
    a = r["accent"]
    out.append(
        f"| [{r['name']}]({r['path']}) "
        f"| {r['mode'] or '?'} "
        f"| `{r['canvas'] or '?'}` "
        f"| {'`' + a['hex'] + '`' if a else '**none**'} "
        f"| {r['radius_profile']} "
        f"| {r['weight_max'] or '?'} "
        f"| {'; '.join(r['forbids']) or '(nothing distinctive)'} |"
    )

sharp = [r["name"] for r in rows if r["radius_profile"] == "sharp"]
noacc = [r["name"] for r in rows if not r["accent"]]
dark = [r["name"] for r in rows if r["mode"] == "dark"]

out += ["", "## Fast picks", "",
        f"**No accent colour at all** ({len(noacc)}): " + ", ".join(f"`{n}`" for n in noacc),
        "", f"**Sharp corners, 0px or pill only** ({len(sharp)}): " + ", ".join(f"`{n}`" for n in sharp),
        "", f"**Dark canvas** ({len(dark)}): " + ", ".join(f"`{n}`" for n in dark), "",
        "## Prose only, not indexed", "",
        "These ship a written analysis with no token frontmatter, so nothing above",
        "was derived for them and no constraint should be inferred. Read the file",
        "directly if you want one of these.", "",
        ", ".join(f"[{r['name']}]({r['path']})" for r in unparsed), ""]

(REPO / "SYSTEMS.md").write_text("\n".join(out))
print(f"wrote SYSTEMS.md: {len(rows)} rows, {sum(1 for r in rows if r['forbids'])} with a stated refusal")
