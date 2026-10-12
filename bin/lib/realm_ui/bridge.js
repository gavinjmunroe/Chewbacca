// window.realm for Realm's desktop renderer running in a plain web view.
//
// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm). In
// his Electron app this object comes from apps/desktop/src/preload/index.ts
// over contextBridge, and most of it talks to Electron's main process over IPC.
// On the Chewbacca glass there is no main process: the renderer is served by
// bin/lib/realm_ui/server.mjs on 127.0.0.1, and the only thing it can reach is
// the realm engine, through that server's WebSocket pipe.
//
// So this keeps the members the renderer needs to boot and talk to the engine,
// and answers every IPC-only member the way Realm's own renderer already
// treats a missing bridge (its env.d.ts marks most of them optional "like
// every bridge: jsdom has none"): nothing picked, nothing listed, no native
// menu (folders excepted: see pickFolder). Nothing here can open a file dialog, read the clipboard, touch the
// keychain or drive a browser view, because a page this server serves must
// not be able to.
//
// server.mjs replaces __REALM_UI_PORT__ and __REALM_HOME__ when it serves
// this file. The token is the pipe's own, minted per server start, and is
// never served over http: the HUD's web view sets window.__realmUiToken from
// the 0600 state file before any script runs (AppPane.swift), and this takes
// it off the window again. The engine's token never reaches the page.
(() => {
  "use strict";
  const unsubscribe = () => {};
  const none = () => Promise.resolve(null);
  const empty = () => Promise.resolve([]);
  const nothing = () => Promise.resolve();

  // A namespace the renderer calls into unconditionally. It must be a plain
  // object with every member present, because browser-client.ts spreads
  // `...window.realm.browser` and a spread copies own keys only. The member
  // names are the preload's own (apps/desktop/src/preload/index.ts at
  // 59afd9e4). Every one answers "not here": a subscription hands back a
  // no-op unsubscribe, a list is empty, anything else is null.
  const absent = (members) =>
    Object.fromEntries(members.map((key) => [key,
      /^on[A-Z]/.test(key) ? () => unsubscribe : /^list|s$/.test(key) ? empty : none]));

  const token = typeof window.__realmUiToken === "string" ? window.__realmUiToken : "";
  try { delete window.__realmUiToken; } catch { /* set non-configurable */ }

  const bridge = {
    port: Number("__REALM_UI_PORT__"),
    token,
    home: "__REALM_HOME__",
    platform: "darwin",
    // HtmlMenu instead of NativeMenu: Menu.tsx draws its own when popupMenu is absent.
    htmlMenus: true,
    zoomFactor: () => 1,
    onOpenSession: () => unsubscribe,
    onDaemonState: () => unsubscribe,
    onWindowKey: () => unsubscribe,
    isWindowKey: () => Promise.resolve(document.hasFocus()),
    onScrollPhase: () => unsubscribe,
    // Quitting is the glass's job (Escape, voice, click-away), never the page's.
    quitAndStopAgents: nothing,
    // His "Choose folder" opens the system dialog in Electron. Here our
    // layer draws its own chooser on the glass (glass/FolderPick.tsx), so a
    // new agent can start in a repo; it lists only git checkouts under
    // $HOME, checked by the server. Looked up per call: the layer mounts
    // after this file runs.
    pickFolder: () => {
      const pick = window.__realmGlassPickFolder;
      return typeof pick === "function" ? pick() : Promise.resolve(null);
    },
    pickFiles: empty,
    pickThemeFile: none,
    pickIconImage: none,
    compressIconImage: none,
    attachmentThumbnail: none,
    describePaths: empty,
    saveTempAttachment: () =>
      Promise.reject(new Error("attachments need Realm's desktop app")),
    pathForFile: () => "",
    clipboard: { readText: () => Promise.resolve("") },
    permissions: absent(["probe", "openSettings"]),
    // Two namespaces his store reads a shape from, not just a value: the
    // composer's @ picker reads `computerAccess.rows` and the Permissions tab
    // `macAccess.rows`, so a null crashed the whole page the moment @ was
    // typed on the glass (realm-hud-report.md, 2026-10-11). They answer
    // "nothing granted here" in his own shape: no rows, no helper.
    macAccess: {
      ...absent(["grant", "openSettings", "appIcon", "revealApp"]),
      status: () => Promise.resolve({ cli: { present: false, path: null, version: null }, host: { name: "Chewbacca glass", bundlePath: null, packaged: false }, rows: [] }),
    },
    computerAccess: {
      ...absent(["openSettings"]),
      status: () => Promise.resolve({ hostName: "Chewbacca glass", packaged: false, helperAvailable: false, rows: [] }),
      request: () => Promise.resolve({ hostName: "Chewbacca glass", packaged: false, helperAvailable: false, rows: [] }),
    },
    updates: absent(["status", "check", "download", "install", "onChanged"]),
    notify: absent(["show", "badge", "onActivate"]),
    credentials: absent(["list", "status", "add", "remove", "share", "setPresenceTtl"]),
    passkeys: absent(["list", "remove", "share"]),
    browser: absent(["create", "destroy", "retain", "navigate", "nav", "search", "historyMenu", "setAllowlist", "setBounds", "onState", "pickElement", "cancelPick", "annotate", "cancelAnnotate", "setAccent", "blockedDownloads", "saveDownload", "dismissDownload", "onDownloadBlocked", "onPasskey", "menuState", "goToIndex", "find", "stopFind", "onFound", "onFindRequest", "zoom", "print", "setDevice", "screenshot", "clearData", "shareSignIn"]),
  };

  // Escape on the glass. In Realm's window Escape only ever closes something
  // inside the page; on the glass it is also how the surface goes away
  // (Chewbacca is an OS: Escape, voice or click-away). So the page keeps it
  // whenever it has a use for it: a dialog, menu or list is open (Realm marks
  // its palette, sheets and pickers with these roles), or the key is going to
  // a text field, the CodeMirror editor or a terminal, where vim and the
  // shell need it. Otherwise it asks the glass to close. Checked in the
  // capture phase, before Realm's own handlers close anything, so the state
  // read is the state the person pressed Escape on.
  const PAGE_OVERLAY = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]';
  const PAGE_KEYS = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],.cm-editor,.xterm';
  const pageWantsEscape = (doc) => {
    if (doc.querySelector(PAGE_OVERLAY)) return true;
    const focus = doc.activeElement;
    return Boolean(focus && focus !== doc.body && focus.closest && focus.closest(PAGE_KEYS));
  };
  const glass = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.realmGlass;
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    // Our glass layer (glass/GlassLayer.tsx) answers first: in the grown
    // workspace Escape shrinks it back to its tile instead of closing.
    const layer = window.__realmGlass;
    if (layer && layer.onEscape && layer.onEscape(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (glass && !pageWantsEscape(document)) glass.postMessage("dismiss");
  }, true);

  Object.defineProperty(window, "realm", {
    value: Object.freeze(bridge),
    writable: false,
    configurable: false,
  });
})();
