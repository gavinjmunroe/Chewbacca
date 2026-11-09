// Mounts our glass layer inside Carlton Aikins' Realm renderer
// (github.com/31Carlton7/realm, apps/desktop/src/renderer).
//
// Two ways in, picked at build time by which checkout realm-ui copied
// (REALM_UI_SOURCE, bin/lib/realm_ui/__init__.py):
//
// Caleb's fork (github.com/calebnewtonusc/realm, branch chewbacca) has an
// extension slot, src/extensions.ts: his App renders whatever a host
// registered under his store's provider, and the layer reads the store with
// his own useAppStore. The same file lets a host quiet his loops while his
// app is hidden, and his composer names its session.
//
// His own checkout (~/code/vendor/realm, the default) has no slot, so the
// layer rides in as a child of his one StoreContext.Provider: the property
// is replaced, before his main.tsx renders, with a component that renders his
// context exactly as before plus our layer beside his children. React 19
// renders a context object as its own provider, which is what `Real` is
// below. If his next commit renames or removes StoreContext, the build test
// (tests/test_realm_glass.py) fails on an untouched copy of his renderer
// instead of the glass silently losing its layer.
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { StoreContext, useAppStore } from "../src/state/store";
import { GlassLayer, type Host } from "./GlassLayer";
import { FolderPick } from "./FolderPick";
import "./attach";

type Store = Parameters<typeof GlassLayer>[0]["store"];
type ProviderProps = { value: Store | null; children?: ReactNode };

// An empty object when the copied renderer has no slot (his checkout).
const slot = Object.values(
  import.meta.glob("../src/extensions.ts", { eager: true }) as Record<
    string,
    {
      registerExtension?: (c: ComponentType) => void;
      setHostQuiet?: (quiet: boolean) => void;
    }
  >,
)[0];
const register = slot?.registerExtension;
const host: Host = register
  ? { setQuiet: slot?.setHostQuiet, namedComposers: true }
  : { namedComposers: false };

function GlassMount() {
  return createElement(
    Fragment,
    null,
    createElement(GlassLayer, { store: useAppStore() as Store, host }),
    createElement(FolderPick),
  );
}

if (register) {
  register(GlassMount);
} else {
  const Real = StoreContext;
  const GlassProvider = ({ value, children }: ProviderProps) =>
    createElement(
      Real,
      { value },
      children,
      value
        ? createElement(GlassLayer, { store: value, host, key: "chewbacca-glass" })
        : null,
      createElement(FolderPick, { key: "chewbacca-glass-folder" }),
    );
  (Real as unknown as { Provider: unknown }).Provider = GlassProvider;
}

// A marker the build test and the headless checks read: the layer is in, and
// which way it went in.
const w = window as unknown as {
  __realmGlassInstalled?: boolean;
  __realmGlassMount?: "slot" | "provider";
};
w.__realmGlassInstalled = true;
w.__realmGlassMount = register ? "slot" : "provider";
