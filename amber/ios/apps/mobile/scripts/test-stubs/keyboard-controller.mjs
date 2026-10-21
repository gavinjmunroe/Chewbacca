/**
 * react-native-keyboard-controller, for tests that only want the pure parts.
 *
 * The library is native: it hooks the system keyboard's real animation and
 * publishes its position as a Reanimated shared value. None of that exists in
 * Node, and none of it is what the tests here are about -- lib/useKeyboardLift
 * exports `barLift`, four numbers in and one out, and importing the module to
 * reach it should not require an iPhone.
 *
 * EVERY HOOK THROWS RATHER THAN RETURNING A PLAUSIBLE ZERO. A stub that quietly
 * hands back `{ height: { value: 0 } }` would let a test assert that the bar
 * does not move and call it a pass -- which is, precisely, the bug this library
 * was brought in to fix. If a test ever needs these, it needs a component tree,
 * and it should say so out loud.
 */
function needsTree(name) {
  return () => {
    throw new Error(`test stub: ${name}() needs a component tree and a real keyboard.`);
  };
}

export const useReanimatedKeyboardAnimation = needsTree('useReanimatedKeyboardAnimation');
export const useKeyboardAnimation = needsTree('useKeyboardAnimation');
export const useKeyboardHandler = needsTree('useKeyboardHandler');
export const useGenericKeyboardHandler = needsTree('useGenericKeyboardHandler');
export const useResizeMode = needsTree('useResizeMode');
export const useKeyboardContext = needsTree('useKeyboardContext');

/** Components render nothing; a test that mounts one is testing the wrong thing. */
export const KeyboardProvider = () => null;
export const KeyboardStickyView = () => null;
export const KeyboardAvoidingView = () => null;
export const KeyboardAwareScrollView = () => null;

export const KeyboardController = {
  setInputMode: () => {},
  setDefaultMode: () => {},
  dismiss: async () => {},
};

export default {
  KeyboardProvider,
  KeyboardStickyView,
  KeyboardController,
};
