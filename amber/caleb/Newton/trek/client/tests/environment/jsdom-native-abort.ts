/**
 * Custom Vitest environment that extends jsdom but preserves the native
 * Node.js AbortController and AbortSignal.
 *
 * Problem: jsdom replaces globalThis.AbortController and AbortSignal with its
 * own implementations. Node.js's undici-based fetch validates signals via
 * `signal instanceof AbortSignal` against its own native class reference.
 * jsdom's AbortSignal instances fail this check, causing fetch to throw:
 *   TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an
 *   instance of AbortSignal.
 *
 * Fix: after jsdom installs its globals, restore the native AbortController
 * and AbortSignal so fetch works correctly in tests.
 */

import { builtinEnvironments } from 'vitest/environments';

const jsdomEnv = builtinEnvironments.jsdom;

export default {
  name: 'jsdom-native-abort',
  transformMode: 'web' as const,

  async setup(global: typeof globalThis, options: Record<string, unknown>) {
    // Capture native AbortController/AbortSignal BEFORE jsdom patches them
    const NativeAbortController = global.AbortController;
    const NativeAbortSignal = global.AbortSignal;

    // Run standard jsdom setup (installs jsdom globals, including its own AbortController)
    const env = await jsdomEnv.setup(global, options as Parameters<typeof jsdomEnv.setup>[1]);

    // Restore native AbortController so Node.js fetch (undici) accepts the signals
    global.AbortController = NativeAbortController;
    global.AbortSignal = NativeAbortSignal;

    return env;
  },
};
