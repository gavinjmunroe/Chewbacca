/**
 * Path-traversal guard for context-repo writes.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/context-repo-path.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { safeRepoPath } from "../context-repo.js";

test("safeRepoPath: accepts normal wiki paths", () => {
  for (const p of [
    "wiki/dimensions/emotional.md",
    "raw/conversations/2026-04-27-hello.md",
    "log.md",
    "index.md",
    "CLAUDE.md",
  ]) {
    const r = safeRepoPath(p);
    assert.equal(r.ok, true, `expected ${p} to be allowed`);
  }
});

test("safeRepoPath: rejects empty / undefined", () => {
  assert.equal(safeRepoPath("").ok, false);
  assert.equal(safeRepoPath(undefined).ok, false);
  assert.equal(safeRepoPath(null).ok, false);
});

test("safeRepoPath: rejects parent traversal in any segment", () => {
  for (const p of [
    "../etc/passwd",
    "wiki/../../etc/passwd",
    "wiki/dimensions/../secrets",
    "../",
    "..",
  ]) {
    const r = safeRepoPath(p);
    assert.equal(r.ok, false, `expected ${p} to be rejected`);
    assert.match(r.reason, /traversal-segment/);
  }
});

test("safeRepoPath: rejects absolute paths", () => {
  assert.equal(safeRepoPath("/etc/passwd").ok, false);
  assert.equal(safeRepoPath("/wiki/file.md").ok, false);
  assert.equal(safeRepoPath("C:/wiki/file.md").ok, false);
  assert.equal(safeRepoPath("C:\\wiki\\file.md").ok, false);
});

test("safeRepoPath: rejects URL-shaped strings", () => {
  assert.equal(safeRepoPath("https://attacker.example/file").ok, false);
  assert.equal(safeRepoPath("file:///etc/passwd").ok, false);
});

test("safeRepoPath: rejects .git/ access", () => {
  const r = safeRepoPath(".git/config");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "git-internals");
});

test("safeRepoPath: rejects control characters", () => {
  const r = safeRepoPath("wiki/file\x00.md");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "control-char");
});

test("safeRepoPath: rejects a leading ./", () => {
  // "." is a traversal-segment under our rule even though it's
  // structurally harmless — we want callers to write paths in
  // canonical form, no exceptions.
  const r = safeRepoPath("./wiki/file.md");
  assert.equal(r.ok, false);
});

test("safeRepoPath: rejects very long paths", () => {
  const long = "a/".repeat(300) + "f.md";
  const r = safeRepoPath(long);
  assert.equal(r.ok, false);
});
