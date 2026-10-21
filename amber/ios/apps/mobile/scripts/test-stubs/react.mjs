/**
 * React, minus the renderer.
 *
 * A lib module that exports a hook still has to be IMPORTABLE so its
 * non-hook exports can be tested -- lib/monthStrip.ts is a publish/subscribe
 * module with one hook bolted on, and the interesting behavior is the part that
 * is not the hook. So the hooks exist and throw the moment they are called
 * outside a tree, which is the honest answer: there is no tree.
 */
const outsideTree = (name) => (...args) => {
  throw new Error(
    `test stub: React.${name}() was called outside a component tree. ` +
      `Test the plain function this hook wraps, or move the test to the render tier.`,
  );
};
export const useState = outsideTree('useState');
export const useEffect = outsideTree('useEffect');
export const useLayoutEffect = outsideTree('useLayoutEffect');
export const useMemo = outsideTree('useMemo');
export const useCallback = outsideTree('useCallback');
export const useRef = outsideTree('useRef');
export const useContext = outsideTree('useContext');
export const useReducer = outsideTree('useReducer');
export const useSyncExternalStore = outsideTree('useSyncExternalStore');
export const createContext = (defaultValue) => ({ Provider: null, Consumer: null, _currentValue: defaultValue });
export const memo = (c) => c;
export const forwardRef = (c) => c;
export const Fragment = Symbol.for('react.fragment');
export const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
export default {
  useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useContext,
  useReducer, useSyncExternalStore, createContext, memo, forwardRef, Fragment, createElement,
};
