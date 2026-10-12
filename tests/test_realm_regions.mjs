// One owner per region of the glass (bin/lib/realm_ui/glass/regions.mjs).
// Daniel Thomas's review, 2026-10-11: every region of the glass has exactly
// one component that owns it, and two things never draw in the same place.
// This holds the table, the components, the stylesheet and skills/hud/SKILL.md
// to each other. The headless WebKit check of the drawn rectangles is in the
// harness the morning report names.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { REGIONS } from "../bin/lib/realm_ui/glass/regions.mjs";

const DIR = new URL("../bin/lib/realm_ui/glass/", import.meta.url);
const layer = readdirSync(DIR)
  .filter((n) => n.endsWith(".tsx"))
  .map((n) => ({ name: n, src: readFileSync(new URL(n, DIR), "utf8") }));
const css = readFileSync(new URL("glass.css", DIR), "utf8");
const ours = REGIONS.filter((r) => r.owner !== "Carlton's app (#root)");

/** The body of `function Name(` up to the next top-level function. */
function body(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const next = src.slice(at + 1).search(/\n(?:export )?function \w+\(/);
  return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
}

/** The grid-template-areas of a grid ("layer" in one mode, or "story"). */
function areasFor(grid, mode) {
  const rule = (re) => (re.exec(css) ?? [])[1];
  const block =
    grid === "story"
      ? rule(/\n\.story \{([^}]*)\}/)
      : (mode !== "tiles" && rule(new RegExp(`\\.glass-layer\\[data-mode="${mode}"\\] \\{([^}]*grid-template[^}]*)\\}`))) ||
        rule(/\.glass-layer \{([^}]*)\}/);
  return [...(block ?? "").matchAll(/"([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((a) => a !== ".");
}
const CLASS = { notice: "glass-notice", field: "glass-field", stage: "glass-stage", story: "story" };
const classOf = (r) => CLASS[r.id] ?? `story-${r.id}`;

test("every region is drawn by exactly one component, at its own root", () => {
  for (const r of ours) {
    const tag = `data-region="${r.id}"`;
    const hits = layer.flatMap((f) =>
      f.src.split(tag).length - 1
        ? [[f.name, f.src.split(tag).length - 1]]
        : [],
    );
    assert.deepEqual(
      hits.map((h) => h[1]).reduce((a, b) => a + b, 0),
      1,
      `${tag} drawn ${JSON.stringify(hits)}`,
    );
    const owner = layer.map((f) => body(f.src, r.owner)).find(Boolean);
    assert.ok(owner, `no component ${r.owner}`);
    assert.ok(owner.includes(tag), `${r.owner} doesn't own ${tag}`);
  }
  // And no component draws a region the table doesn't list.
  const listed = new Set(REGIONS.map((r) => r.id));
  for (const f of layer)
    for (const m of f.src.matchAll(/data-region="([\w-]+)"/g))
      assert.ok(
        listed.has(m[1]),
        `${f.name} draws an unlisted region "${m[1]}"`,
      );
});

test("within a mode, no two regions share a grid area, and every area is in its grid", () => {
  const modes = [...new Set(REGIONS.flatMap((r) => r.modes))];
  for (const mode of modes)
    for (const grid of ["layer", "story"]) {
      const placed = REGIONS.filter((r) => r.grid === grid && r.modes.includes(mode));
      if (!placed.length) continue;
      const areas = areasFor(grid, mode);
      const used = placed.map((r) => r.area);
      assert.equal(new Set(used).size, used.length, `${mode}/${grid}: ${used}`);
      for (const r of placed) assert.ok(areas.includes(r.area), `${mode}/${grid}: no "${r.area}" area for ${r.id}`);
    }
  for (const r of REGIONS.filter((x) => x.area)) {
    const cls = classOf(r);
    const rule = new RegExp(`\\n\\.${cls} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    assert.match(rule, new RegExp(`grid-area:\\s*${r.area};`), `${cls} isn't placed in "${r.area}"`);
    assert.doesNotMatch(rule, /position:\s*(absolute|fixed)/, `${cls} is lifted out of its grid`);
  }
});

test("skills/hud/SKILL.md carries the same table", () => {
  const md = readFileSync(
    new URL("../skills/hud/SKILL.md", import.meta.url),
    "utf8",
  );
  const block = md.slice(
    md.indexOf("<!-- regions:begin -->"),
    md.indexOf("<!-- regions:end -->"),
  );
  const rows = block
    .split("\n")
    .filter(
      (l) =>
        l.startsWith("| ") &&
        !l.startsWith("| Region") &&
        !l.startsWith("| ---"),
    )
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  assert.deepEqual(
    rows.map(([id, owner, area, modes]) => [id, owner, area, modes]),
    REGIONS.map((r) => [r.id, r.owner, r.area ? `${r.area} (${r.grid})` : "-", r.modes.join(", ")]),
  );
});
