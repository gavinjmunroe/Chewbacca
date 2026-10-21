import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getPreferredRegister,
  buildRegisterOverrideBlock,
  ALLOWED_REGISTERS,
} from "../register-preference.js";

function clearEnv() {
  delete process.env.LOOP_REGISTER_OVERRIDE;
}

test("ALLOWED_REGISTERS exposes the three Amber voice registers", () => {
  assert.deepEqual([...ALLOWED_REGISTERS].sort(), [
    "mother",
    "sister",
    "wife",
  ]);
});

test("getPreferredRegister: returns null when nothing is configured", () => {
  clearEnv();
  assert.equal(getPreferredRegister(null), null);
  assert.equal(getPreferredRegister({}), null);
  assert.equal(
    getPreferredRegister({ onboardingProfile: {} }),
    null,
  );
});

test("getPreferredRegister: reads onboardingProfile.preferredRegister first", () => {
  clearEnv();
  process.env.LOOP_REGISTER_OVERRIDE = "mother";
  const tenant = {
    onboardingProfile: { preferredRegister: "sister" },
    preferredRegister: "wife",
  };
  assert.equal(getPreferredRegister(tenant), "sister");
  clearEnv();
});

test("getPreferredRegister: falls back to tenant.preferredRegister", () => {
  clearEnv();
  process.env.LOOP_REGISTER_OVERRIDE = "mother";
  assert.equal(
    getPreferredRegister({ preferredRegister: "wife" }),
    "wife",
  );
  clearEnv();
});

test("getPreferredRegister: falls back to LOOP_REGISTER_OVERRIDE env var", () => {
  clearEnv();
  process.env.LOOP_REGISTER_OVERRIDE = "Mother";
  assert.equal(getPreferredRegister({}), "mother");
  clearEnv();
});

test("getPreferredRegister: rejects unknown values (safety default)", () => {
  clearEnv();
  // Typos / made-up values must not silently change voice — caller falls
  // through to the next source instead of accepting garbage.
  assert.equal(
    getPreferredRegister({
      onboardingProfile: { preferredRegister: "girlfriend" },
    }),
    null,
  );
  assert.equal(
    getPreferredRegister({ preferredRegister: "" }),
    null,
  );
  assert.equal(
    getPreferredRegister({ preferredRegister: 42 }),
    null,
  );
});

test("getPreferredRegister: 'auto' and 'default' are treated as no override", () => {
  clearEnv();
  assert.equal(
    getPreferredRegister({ preferredRegister: "auto" }),
    null,
  );
  assert.equal(
    getPreferredRegister({
      onboardingProfile: { preferredRegister: "DEFAULT" },
    }),
    null,
  );
});

test("getPreferredRegister: env var override is rejected if invalid", () => {
  clearEnv();
  process.env.LOOP_REGISTER_OVERRIDE = "queen";
  assert.equal(getPreferredRegister({}), null);
  clearEnv();
});

test("buildRegisterOverrideBlock: empty when no override configured", () => {
  clearEnv();
  assert.equal(buildRegisterOverrideBlock({}), "");
  assert.equal(buildRegisterOverrideBlock(null), "");
});

test("buildRegisterOverrideBlock: emits an uppercase pin when configured", () => {
  clearEnv();
  const block = buildRegisterOverrideBlock({
    onboardingProfile: { preferredRegister: "sister" },
  });
  assert.match(block, /REGISTER PREFERENCE/);
  assert.match(block, /SISTER/);
  // Must preserve override hierarchy — explicit user direction still wins.
  assert.match(block, /Selection order in the voice doctrine still applies/);
});
