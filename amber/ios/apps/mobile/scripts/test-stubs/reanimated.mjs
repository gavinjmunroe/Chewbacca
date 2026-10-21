/**
 * Reanimated's API surface, with shared values that actually hold a value.
 * Worklets run inline: a test can call one and see what it computed, which is
 * the only part of an animation worth asserting here.
 */
export function useSharedValue() { throw new Error('test stub: useSharedValue() needs a component tree.'); }
export const makeMutable = (initial) => ({ value: initial });
export const withTiming = (to) => to;
export const withSpring = (to) => to;
export const withDelay = (_ms, v) => v;
export const withRepeat = (v) => v;
export const withSequence = (...v) => v[v.length - 1];
export const runOnJS = (fn) => fn;
export const runOnUI = (fn) => fn;
export const interpolate = (x, input, output) => {
  if (!Array.isArray(input) || !Array.isArray(output) || input.length < 2) return x;
  if (x <= input[0]) return output[0];
  if (x >= input[input.length - 1]) return output[output.length - 1];
  for (let i = 1; i < input.length; i += 1) {
    if (x <= input[i]) {
      const t = (x - input[i - 1]) / (input[i] - input[i - 1]);
      return output[i - 1] + t * (output[i] - output[i - 1]);
    }
  }
  return output[output.length - 1];
};
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
export const Easing = { linear: (t) => t, bezier: () => (t) => t, out: (f) => f, inOut: (f) => f, ease: (t) => t };
const needsTree = (name) => () => { throw new Error(`test stub: ${name}() needs a component tree.`); };
export const useAnimatedKeyboard = needsTree('useAnimatedKeyboard');
export const KeyboardState = { UNKNOWN: 0, OPENING: 1, OPEN: 2, CLOSING: 3, CLOSED: 4 };
export const useFrameCallback = needsTree('useFrameCallback');
export const useAnimatedProps = needsTree('useAnimatedProps');
export const useAnimatedGestureHandler = needsTree('useAnimatedGestureHandler');
export const measure = () => null;
export const withDecay = (v) => v;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' };
export const useAnimatedStyle = needsTree('useAnimatedStyle');
export const useDerivedValue = needsTree('useDerivedValue');
export const useAnimatedScrollHandler = needsTree('useAnimatedScrollHandler');
export const useAnimatedRef = needsTree('useAnimatedRef');
export const useAnimatedReaction = needsTree('useAnimatedReaction');
export const cancelAnimation = () => {};
export const scrollTo = () => {};
const view = (name) => ({ $$stub: name, displayName: name });
export default {
  View: view('Animated.View'), Text: view('Animated.Text'), ScrollView: view('Animated.ScrollView'),
  createAnimatedComponent: (c) => c,
};
