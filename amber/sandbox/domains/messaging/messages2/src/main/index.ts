import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  shell,
  dialog,
  nativeTheme,
} from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import windowStateKeeper from "electron-window-state";
import { join } from "node:path";

process.on("uncaughtException", (err) => {
  console.error("[messages2:uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[messages2:unhandledRejection]", reason);
});

import {
  destroySDK,
  checkPermissions,
  listChats,
  getMessages,
  send,
  startWatching,
  stopWatching,
  onWatcherEvent,
  probeAutomation,
} from "./imessage-bridge";
import { convertHeicToJpeg, convertAudioToM4a } from "./media-prep";
import { getPinned, togglePin } from "./pinned-store";
import { loadCachedPreviews, saveCachedPreviews } from "./chat-cache";
import { getContacts } from "./contacts";
import {
  IPC,
  type ChatDTO,
  type ChatQueryParams,
  type MessageQueryParams,
  type SendPayload,
  type WatcherEvent,
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Persist size + position across launches.
  const winState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 820,
  });

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Messages2",
    titleBarStyle: "hiddenInset", // native traffic lights, no chrome
    trafficLightPosition: { x: 18, y: 18 },
    // Don't set a hard backgroundColor — let the vibrancy show through
    // when the renderer uses transparent backgrounds on the sidebar.
    vibrancy: "sidebar",
    visualEffectState: "active",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  winState.manage(mainWindow);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Renderer entry: dev server in dev, file:// in prod
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ---- IPC ---------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(IPC.permissions, async () => checkPermissions());

  ipcMain.handle(IPC.listChats, async (_, params: ChatQueryParams = {}) => {
    // Helper to apply pinned overlay + sort. The pinned set lives in
    // userData; the chat list itself doesn't know about pins.
    const decorate = (chats: ChatDTO[]): ChatDTO[] => {
      const pinned = new Set(getPinned());
      const decorated: ChatDTO[] = chats.map((c) => ({
        ...c,
        isPinned: pinned.has(c.chatId),
      }));
      decorated.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        return bt - at;
      });
      return decorated;
    };

    // Cold-start fast path: if we have a cached preview list AND this is
    // a no-filter sweep (the default sidebar fetch), return cache instantly
    // and kick off a background refresh whose result is pushed to all
    // windows via the chatsUpdated event channel.
    const isPlainSweep = !params.search && !params.kind && !params.hasUnread;
    if (isPlainSweep) {
      const cached = loadCachedPreviews();
      if (cached && cached.length > 0) {
        // Background refresh: fetch fresh, persist, push to renderer.
        void (async (): Promise<void> => {
          try {
            const fresh = await listChats(params);
            const decorated = decorate(fresh);
            saveCachedPreviews(decorated);
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) {
                win.webContents.send(IPC.chatsUpdated, decorated);
              }
            });
          } catch (err) {
            console.error("[messages2] background chat refresh failed:", err);
          }
        })();
        return decorate(cached);
      }
    }

    // No usable cache — synchronous fetch. With the new one-shot SQL
    // query this is ~30-50x faster than the old N+1 pattern.
    const chats = await listChats(params);
    const decorated = decorate(chats);
    if (isPlainSweep) saveCachedPreviews(decorated);
    return decorated;
  });

  ipcMain.handle(IPC.getMessages, async (_, params: MessageQueryParams) =>
    getMessages(params),
  );

  ipcMain.handle(IPC.send, async (_, payload: SendPayload) => {
    try {
      await send(payload);
      return { ok: true as const };
    } catch (err) {
      // On send failure, probe the Automation permission so the error
      // surface tells the user exactly what's wrong (denied vs. Messages
      // not running vs. genuine SDK error) instead of the raw stack.
      const status = await probeAutomation().catch(() => "unknown" as const);
      const baseMsg = (err as Error).message;
      let humanMsg = baseMsg;
      if (status === "denied") {
        humanMsg =
          "Messages2 isn't allowed to control Messages.app. Open System Settings → Privacy & Security → Automation, find Messages2, and enable the toggle for Messages.";
      } else if (status === "messages-not-running") {
        humanMsg =
          "Messages.app isn't running. Open Messages from /Applications and try again.";
      }
      return { ok: false as const, error: humanMsg, automationStatus: status };
    }
  });

  ipcMain.handle(IPC.probeAutomation, async () => probeAutomation());

  ipcMain.handle(IPC.convertHeic, async (_, sourcePath: string) =>
    convertHeicToJpeg(sourcePath),
  );

  ipcMain.handle(IPC.convertAudio, async (_, sourcePath: string) =>
    convertAudioToM4a(sourcePath),
  );

  // Save a pasted image to a temp file so the SDK can attach it. The
  // renderer hands us the bytes + a mime hint; we pick the extension
  // and return the absolute path.
  ipcMain.handle(
    IPC.savePastedImage,
    async (_, payload: { bytes: ArrayBuffer; mimeType: string }) => {
      const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const ext = payload.mimeType.includes("png")
        ? "png"
        : payload.mimeType.includes("gif")
          ? "gif"
          : payload.mimeType.includes("webp")
            ? "webp"
            : "jpg";
      const dir = join(tmpdir(), "messages2-paste");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = join(dir, `pasted-${Date.now()}.${ext}`);
      writeFileSync(path, Buffer.from(payload.bytes));
      return path;
    },
  );

  ipcMain.handle(IPC.startWatching, async () => {
    await startWatching();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.stopWatching, async () => {
    await stopWatching();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.togglePin, async (_, chatId: string) => togglePin(chatId));
  ipcMain.handle(IPC.getPinnedIds, async () => getPinned());

  ipcMain.handle(IPC.pickAttachment, async () => {
    if (!mainWindow) return { paths: [] as string[] };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "All Files", extensions: ["*"] },
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic"],
        },
        { name: "Videos", extensions: ["mp4", "mov", "m4v", "webm"] },
      ],
    });
    return { paths: result.canceled ? [] : result.filePaths };
  });

  ipcMain.handle(IPC.setBadge, async (_, count: number) => {
    if (process.platform === "darwin") {
      app.setBadgeCount(count > 0 ? count : 0);
    }
    return { ok: true as const };
  });

  // Photos picker: opens to ~/Pictures, restricts to image + video types
  // (the same set Messages.app's media picker shows).
  ipcMain.handle(IPC.pickPhotos, async () => {
    if (!mainWindow) return { paths: [] as string[] };
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: join(homedir(), "Pictures"),
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Photos & Videos",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "heic",
            "heif",
            "bmp",
            "tiff",
            "mp4",
            "mov",
            "m4v",
            "webm",
          ],
        },
      ],
    });
    return { paths: result.canceled ? [] : result.filePaths };
  });

  // Files picker: defaults to ~/Documents, accepts any file type.
  ipcMain.handle(IPC.pickFiles, async () => {
    if (!mainWindow) return { paths: [] as string[] };
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: join(homedir(), "Documents"),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "All Files", extensions: ["*"] }],
    });
    return { paths: result.canceled ? [] : result.filePaths };
  });
}

// Fan watcher events out to all renderer windows.
function bridgeWatcherEvents(): void {
  onWatcherEvent((event: WatcherEvent) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.watcherEvent, event);
      }
    });
  });
}

// ---- native menu -------------------------------------------------------

function buildAppMenu(): void {
  // Standard macOS application menu. Without this the Edit menu is gone,
  // which means Cmd+C / Cmd+V / Cmd+Z don't work in any textarea.
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "Messages2",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "View on GitHub",
          click: (): void => {
            shell.openExternal(
              "https://github.com/amber-organization/Messages2",
            );
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- lifecycle ---------------------------------------------------------

// Single-instance lock: if another Messages2 process is launched, focus the
// existing window instead of spawning a second main process.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId("com.calebnewton.messages2");

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    // Force dark — Messages2 is dark-only by design (matches real Messages app).
    nativeTheme.themeSource = "dark";

    buildAppMenu();
    registerIpc();
    bridgeWatcherEvents();

    // Pre-warm the Contacts cache on a microtask so the first listChats
    // doesn't pay the AddressBook read + photo extraction cost inline.
    // Fire-and-forget; if it fails the lookup just returns nulls.
    setImmediate(() => {
      try {
        getContacts();
      } catch {
        /**/
      }
    });

    // SDK boot is deferred to the renderer's first permissions check —
    // doing it here would risk blocking window creation if chat.db is
    // unreachable (no Full Disk Access yet).

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err) => {
    console.error("[messages2:whenReady]", err);
  });

app.on("window-all-closed", () => {
  // macOS convention: app stays running with no windows; Cmd+Q to quit.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  event.preventDefault();
  try {
    await destroySDK();
  } finally {
    app.exit(0);
  }
});
