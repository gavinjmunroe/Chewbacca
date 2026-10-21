/**
 * THE PROJECT'S REAL LINT RULES, RUN ANYWHERE.
 *
 * Run with:  node scripts/eslint-core.cjs        (part of `npm run verify`)
 *
 * WHY THIS EXISTS, and it is the fix for a process failure rather than a bug.
 *
 * `expo lint` cannot run in the cloud agent's shell: eslint-plugin-import's
 * module resolver (unrs-resolver) loads a NATIVE binary, the installed one is
 * darwin-arm64, and that shell is Linux with the Mac's disk mounted. So for weeks
 * the agent reported "eslint UNAVAILABLE" and the real run happened only on the
 * Mac, at the end -- which meant every lint failure was discovered by the person
 * least able to fix it, one batch at a time. Two consecutive `npm run verify`
 * runs failed on 20 warnings each, and fixing them one by one was treating the
 * symptom.
 *
 * The insight is small: it is not eslint that needs a Mac. It is ONE PLUGIN.
 * eslint itself, @typescript-eslint, eslint-plugin-react and
 * eslint-plugin-react-hooks are pure JavaScript and load fine. So this loads the
 * project's ACTUAL config -- eslint-config-expo/flat, the same object
 * eslint.config.js extends -- strips the `import` plugin and its rules, and runs
 * everything else. 60 of the 70 rules, including every rule that has actually
 * bitten: no-unused-vars, array-type, exhaustive-deps, rules-of-hooks.
 *
 * The 10 it cannot run are named in the output, every time, so the gap is a
 * stated fact rather than something to be rediscovered. Most of them are covered
 * by scripts/imports-check.mts, which does the same job with fs instead of a
 * native resolver.
 *
 * DERIVED, NOT COPIED. The rule list is read out of the installed config at run
 * time. A hand-picked list is a list that drifts from the config it is imitating,
 * which is the whole failure mode this replaces.
 */
const { ESLint } = require('eslint');
const path = require('node:path');

const APP = path.join(__dirname, '..');

/** The plugin whose resolver needs a platform binary, and its rules. */
const UNRUNNABLE_PLUGIN = 'import';

/**
 * Of the ten skipped rules, these three are re-implemented with `fs` in
 * scripts/imports-check.mts -- including no-unresolved, the only one of the ten
 * whose failure is fatal at launch rather than cosmetic. Named here so the
 * output distinguishes "not checked anywhere" from "checked another way",
 * because a list of ten unchecked rules that is really seven invites someone to
 * treat the whole list as noise.
 */
const COVERED_BY_IMPORTS_CHECK = new Set([
  'import/no-unresolved',
  'import/no-duplicates',
  'import/first',
]);

function loadExpoConfig() {
  // eslint-config-expo ships CJS; this file is CJS for that reason.
  const raw = require('eslint-config-expo/flat');
  return Array.isArray(raw) ? raw : [raw];
}

function stripImportPlugin(blocks) {
  const skipped = new Set();
  const out = [];
  for (const block of blocks) {
    const next = { ...block };
    if (next.plugins) {
      const plugins = { ...next.plugins };
      delete plugins[UNRUNNABLE_PLUGIN];
      next.plugins = plugins;
    }
    if (next.rules) {
      const rules = {};
      for (const [name, setting] of Object.entries(next.rules)) {
        if (name.startsWith(`${UNRUNNABLE_PLUGIN}/`)) {
          skipped.add(name);
          continue;
        }
        rules[name] = setting;
      }
      next.rules = rules;
    }
    // `settings` can reference the resolver; harmless without the plugin, but
    // dropped so nothing tries to construct it.
    if (next.settings) {
      const settings = { ...next.settings };
      delete settings['import/resolver'];
      delete settings['import/parsers'];
      next.settings = settings;
    }
    out.push(next);
  }
  return { blocks: out, skipped: [...skipped].sort() };
}

async function main() {
  const { blocks, skipped } = stripImportPlugin(loadExpoConfig());

  const eslint = new ESLint({
    cwd: APP,
    overrideConfigFile: true,
    overrideConfig: [...blocks, { ignores: ['dist/*', 'scripts/*'] }],
  });

  const results = await eslint.lintFiles(['app', 'components', 'lib']);
  const problems = results.flatMap((r) =>
    r.messages.map((m) => ({
      file: path.relative(APP, r.filePath),
      line: m.line,
      rule: m.ruleId ?? '(parse)',
      severity: m.severity,
      message: m.message,
    })),
  );

  const covered = skipped.filter((r) => COVERED_BY_IMPORTS_CHECK.has(r));
  const uncovered = skipped.filter((r) => !COVERED_BY_IMPORTS_CHECK.has(r));
  console.log(
    `${blocks.reduce((n, b) => n + Object.keys(b.rules ?? {}).length, 0)} rules over ` +
      `${results.length} files.`,
  );
  console.log(
    `  ${covered.length} skipped here, covered by imports-check: ${covered.join(', ')}`,
  );
  console.log(
    `  ${uncovered.length} skipped here, checked only by \`eslint\` on the Mac: ${uncovered.join(', ')}`,
  );

  if (problems.length > 0) {
    console.error('');
    for (const p of problems.slice(0, 80)) {
      console.error(`  ${p.file}:${p.line}  ${p.rule}  ${p.message}`);
    }
    if (problems.length > 80) console.error(`  … and ${problems.length - 80} more`);
    console.error(
      `\n${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
        'Zero is the bar: `npm run verify` runs eslint with --max-warnings 0 on the Mac, ' +
        'so a warning here is a failed gate there.',
    );
    process.exit(1);
  }

  console.log('No problems.');
}

main().catch((err) => {
  console.error(`eslint-core could not run: ${err?.message || err}`);
  process.exit(2);
});
