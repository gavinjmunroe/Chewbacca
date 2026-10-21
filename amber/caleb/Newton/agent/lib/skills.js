/**
 * Skill system: extensible capabilities via SKILL.md files.
 * Inspired by Claude Code's skill format and Composio's awesome-claude-skills.
 *
 * Skills are markdown files with YAML frontmatter that define:
 * - name: skill identifier
 * - description: when to use this skill
 * - trigger: regex or keyword patterns that activate the skill
 * - instructions: what Amber should do when the skill is activated
 *
 * Skills live in the skills/ directory and are loaded on startup.
 *
 * Example SKILL.md:
 * ---
 * name: prayer
 * description: When someone asks for prayer or spiritual support
 * trigger: pray|prayer|spiritual|God|Jesus|faith|church|worship
 * ---
 * When someone asks for or mentions prayer, respond with genuine warmth...
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { registerCapability } from "./capabilities.js";

const SKILLS_DIR = new URL("../skills", import.meta.url).pathname;
const skillCache = new Map(); // name -> { meta, instructions }
let skillsLoaded = false;

/**
 * Parse a SKILL.md file into metadata + instructions.
 */
function parseSkillFile(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const instructions = frontmatterMatch[2].trim();

  // Parse YAML-like frontmatter (simple key: value)
  const meta = {};
  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    meta[key] = val;
  }

  if (!meta.name) return null;

  return {
    name: meta.name,
    description: meta.description || "",
    trigger: meta.trigger ? new RegExp(meta.trigger, "i") : null,
    priority: parseInt(meta.priority || "0", 10),
    instructions,
  };
}

/**
 * Load all skills from the skills/ directory.
 */
export async function loadSkills() {
  if (skillsLoaded) return;

  try {
    const files = await readdir(SKILLS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(SKILLS_DIR, file), "utf-8");
        const skill = parseSkillFile(content);
        if (skill) {
          skillCache.set(skill.name, skill);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    skillsLoaded = true;
    if (skillCache.size > 0) {
      // Auto-register all loaded skills as capabilities
      for (const [, skill] of skillCache) {
        registerCapability("Skills", `${skill.name}: ${skill.description}`);
      }
      console.log(
        `[skills] Loaded ${skillCache.size} skill(s): ${[...skillCache.keys()].join(", ")}`,
      );
    }
  } catch {
    // skills/ directory may not exist yet, that's fine
    skillsLoaded = true;
  }
}

/**
 * Find skills relevant to a message.
 * Returns matching skill instructions to inject into the system prompt.
 */
export function findRelevantSkills(text) {
  const matches = [];
  for (const [, skill] of skillCache) {
    if (skill.trigger && skill.trigger.test(text)) {
      matches.push(skill);
    }
  }
  // Sort by priority (higher first)
  matches.sort((a, b) => b.priority - a.priority);
  return matches;
}

/**
 * Build a skill injection block for the system prompt.
 */
export function buildSkillBlock(skills) {
  if (!skills || skills.length === 0) return "";
  const blocks = skills
    .slice(0, 3) // max 3 skills at once
    .map(
      (s) => `=== SKILL: ${s.name} ===\n${s.instructions}\n=== END SKILL ===`,
    );
  return `\n\n${blocks.join("\n\n")}`;
}

/**
 * Get all loaded skills for status/debugging.
 */
export function getLoadedSkills() {
  return [...skillCache.values()].map((s) => ({
    name: s.name,
    description: s.description,
    hasTrigger: !!s.trigger,
  }));
}
