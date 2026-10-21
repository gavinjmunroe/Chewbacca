import type { ElectronAPI } from "@electron-toolkit/preload";
import type { MessagesAPI } from "./index";

declare global {
  interface Window {
    electron: ElectronAPI;
    messages: MessagesAPI;
  }
}

export {};
