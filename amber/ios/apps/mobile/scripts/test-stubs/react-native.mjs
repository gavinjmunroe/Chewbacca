/**
 * React Native's non-visual surface: the parts a lib module legitimately reads.
 *
 * Platform is iOS because that is the only target this app ships. Dimensions
 * returns an iPhone 15 Pro logical size -- a REAL device size, so any layout
 * math a test exercises is exercised against a number the app actually sees,
 * not a round 400x800 that nothing has.
 *
 * AppState is a working state machine: a module that pauses work in the
 * background (the contacts sync engine does exactly this) can be driven through
 * a real foreground/background transition with __setAppState().
 */
export const Platform = {
  OS: 'ios',
  Version: '17.5',
  isPad: false,
  isTV: false,
  select: (spec) => (Object.prototype.hasOwnProperty.call(spec, 'ios') ? spec.ios : spec.default),
};

const WINDOW = { width: 393, height: 852, scale: 3, fontScale: 1 };
export const Dimensions = {
  get: (what) => ({ ...(what === 'screen' ? { ...WINDOW, height: 852 } : WINDOW) }),
  addEventListener: () => ({ remove() {} }),
};

export const PixelRatio = {
  get: () => WINDOW.scale,
  getFontScale: () => WINDOW.fontScale,
  roundToNearestPixel: (n) => Math.round(n * WINDOW.scale) / WINDOW.scale,
};

let appState = 'active';
const appListeners = new Set();
export const AppState = {
  get currentState() { return appState; },
  addEventListener(type, handler) {
    const entry = { type, handler };
    appListeners.add(entry);
    return { remove: () => appListeners.delete(entry) };
  },
};
/** Test-only: drive a real background/foreground transition. */
export function __setAppState(next) {
  appState = next;
  for (const { type, handler } of [...appListeners]) if (type === 'change') handler(next);
}
export function __resetAppState() {
  appState = 'active';
  appListeners.clear();
}

export const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) =>
    Array.isArray(style) ? style.filter(Boolean).reduce((a, s) => ({ ...a, ...StyleSheet.flatten(s) }), {}) : (style ?? {}),
  hairlineWidth: 1 / 3,
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

const linkingCalls = [];
export const Linking = {
  openURL: async (url) => { linkingCalls.push(url); return true; },
  canOpenURL: async () => true,
  addEventListener: () => ({ remove() {} }),
  getInitialURL: async () => null,
};
export function __linkingCalls() { return [...linkingCalls]; }
export function __resetLinking() { linkingCalls.length = 0; }

export const InteractionManager = {
  runAfterInteractions: (fn) => { const t = setTimeout(fn, 0); return { cancel: () => clearTimeout(t) }; },
};
export const Keyboard = { dismiss() {}, addListener: () => ({ remove() {} }) };
export const LayoutAnimation = { configureNext() {}, Presets: { easeInEaseOut: {} } };
export const NativeModules = {};
export const Share = { share: async () => ({ action: 'sharedAction' }) };
export const Vibration = { vibrate() {} };
export const Appearance = { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) };
export const useColorScheme = () => 'light';

/**
 * Components. Present so a module that imports them can load; they are inert
 * markers rather than renderable elements, because nothing in this tier renders.
 */
const component = (name) => ({ $$stub: name, displayName: name });
export const View = component('View');
export const Text = component('Text');
export const Image = component('Image');
export const ScrollView = component('ScrollView');
export const FlatList = component('FlatList');
export const SectionList = component('SectionList');
export const Pressable = component('Pressable');
export const TouchableOpacity = component('TouchableOpacity');
export const TextInput = component('TextInput');
export const Modal = component('Modal');
export const ActivityIndicator = component('ActivityIndicator');
export const Switch = component('Switch');
export const KeyboardAvoidingView = component('KeyboardAvoidingView');
export const SafeAreaView = component('SafeAreaView');
export const Animated = {
  View: component('Animated.View'),
  Text: component('Animated.Text'),
  Value: class { constructor(v) { this._v = v; } setValue(v) { this._v = v; } },
  timing: () => ({ start: (cb) => cb && cb({ finished: true }) }),
  spring: () => ({ start: (cb) => cb && cb({ finished: true }) }),
};
export const Easing = { linear: (t) => t, inOut: (f) => f, out: (f) => f, ease: (t) => t };
export default {
  Platform, Dimensions, PixelRatio, AppState, StyleSheet, Linking, InteractionManager,
  Keyboard, LayoutAnimation, NativeModules, Share, Vibration, Appearance,
  View, Text, Image, ScrollView, FlatList, SectionList, Pressable, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, Switch, KeyboardAvoidingView, SafeAreaView, Animated, Easing,
};

export const Alert = { alert() { throw Error('Test must supply an explicit consent choice'); } };
