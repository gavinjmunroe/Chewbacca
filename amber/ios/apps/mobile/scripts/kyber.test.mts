/**
 * Kyber's pure Swift logic (targets/kyber/KyberCore.swift), compiled with swiftc
 * and run on the Mac. The keyboard itself can only run inside iOS with Full
 * Access switched on by hand, so this is the part of it that a test can reach:
 * marker resolution, the chat stream parser, token expiry, free-time windows,
 * the bill split, and the circle-graph intro ranking.
 *
 * Skipped, with the reason printed, where there is no swiftc (Linux CI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hasSwift = spawnSync('swiftc', ['--version']).status === 0;

test('kyber core logic', { skip: hasSwift ? false : 'swiftc not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kyber-'));
  copyFileSync(join(here, '../targets/kyber/KyberCore.swift'), join(dir, 'KyberCore.swift'));
  copyFileSync(join(here, 'kyberCoreTest.swift'), join(dir, 'main.swift'));
  const bin = join(dir, 'kyber-core-test');
  const build = spawnSync('swiftc', [join(dir, 'KyberCore.swift'), join(dir, 'main.swift'), '-o', bin], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(bin, { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
