// The glass build's default entry: Carlton Aikins' Realm
// (github.com/31Carlton7/realm) exactly as he ships it. His own src/main.tsx
// runs unchanged and draws his whole window: rail, sidebar, sessions,
// prompter, panes. Nothing of ours sits over it.
//
// What is added is only what a web view on the HUD needs to stand in for
// Electron, and none of it draws until his app asks for it:
//   - attach.ts describes files Kyber's open panel picked or a drop carried,
//     as his main/attachments.ts does (bridge.js pickFiles, describePaths)
//   - FolderPick answers his window.realm.pickFolder(), the system folder
//     dialog in Electron, in its own root beside his
// Links leaving the app and notifications are Kyber's (AppPane.swift,
// RealmBridges.swift), and Escape closing the glass is bridge.js. The tiles,
// story and bar layer is the opt-in glass/ entry (realm-ui build --mode glass).
// vite.config.mjs points index.html here instead of at /src/main.tsx.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "../glass/attach";
import "../src/main";
import { FolderPick } from "../glass/FolderPick";

const pick = document.createElement("div");
pick.id = "chewbacca-folder-pick";
document.body.appendChild(pick);
createRoot(pick).render(createElement(FolderPick));

// Read by the build test and the headless checks: which entry this bundle is.
(window as unknown as { __realmUiMode?: string }).__realmUiMode = "stock";
