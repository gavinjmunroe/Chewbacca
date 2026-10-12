// Mounts our glass layer inside Carlton Aikins' Realm renderer without
// editing a line of it (github.com/31Carlton7/realm, apps/desktop/src/renderer).
//
// His App creates its store in a useMemo and hands it down through
// StoreContext.Provider. Our layer needs that same store (to reveal a session,
// open his palette, read his layout), so it rides in as a child of that one
// Provider: the property is replaced, before his main.tsx renders, with a
// component that renders his context exactly as before plus our layer beside
// his children. React 19 renders a context object as its own provider, which
// is what `Real` is below. If his next commit renames or removes StoreContext,
// the build test (tests/test_realm_glass.py) fails on an untouched copy of his
// renderer instead of the glass silently losing its layer.
import { createElement, type ReactNode } from "react";
import { StoreContext } from "../src/state/store";
import { GlassLayer } from "./GlassLayer";
import { FolderPick } from "./FolderPick";

type ProviderProps = {
  value: Parameters<typeof GlassLayer>[0]["store"] | null;
  children?: ReactNode;
};

const Real = StoreContext;
function GlassProvider({ value, children }: ProviderProps) {
  return createElement(
    Real,
    { value },
    children,
    value
      ? createElement(GlassLayer, { store: value, key: "chewbacca-glass" })
      : null,
    createElement(FolderPick, { key: "chewbacca-glass-folder" }),
  );
}

// A marker the build test and the headless checks read: the layer is in.
(
  window as unknown as { __realmGlassInstalled?: boolean }
).__realmGlassInstalled = true;
(Real as unknown as { Provider: unknown }).Provider = GlassProvider;
