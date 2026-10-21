import { create } from 'zustand';
import axios from '../api/client.js';

// Type mirrors SystemNoticeDTO from the server (copy here to avoid cross-package import)
export interface SystemNoticeDTO {
  id: string;
  display: 'modal' | 'banner' | 'toast';
  severity: 'info' | 'warn' | 'critical';
  titleKey: string;
  bodyKey: string;
  bodyParams?: Record<string, string>;
  icon?: string;
  media?: {
    src: string;
    srcDark?: string;
    altKey: string;
    placement?: 'hero' | 'inline';
    aspectRatio?: string;
  };
  highlights?: Array<{ labelKey: string; iconName?: string }>;
  cta?: (
    | { kind: 'nav'; labelKey: string; href: string }
    | { kind: 'action'; labelKey: string; actionId: string; dismissOnAction?: boolean }
  );
  dismissible: boolean;
}

interface SystemNoticeState {
  notices: SystemNoticeDTO[];
  loaded: boolean;
  fetching: boolean;
  fetch: () => Promise<void>;
  dismiss: (id: string) => void;
  reset: () => void;
}

export const useSystemNoticeStore = create<SystemNoticeState>()((set, get) => ({
  notices: [],
  loaded: false,
  fetching: false,

  async fetch() {
    if (get().fetching || get().loaded) return;
    set({ fetching: true });
    try {
      const res = await axios.get<SystemNoticeDTO[]>('/system-notices/active');
      set({ notices: res.data, loaded: true, fetching: false });
    } catch (err) {
      // Notices are non-critical. Fail silently; set loaded so UI doesn't hang.
      console.warn('[systemNotices] failed to fetch:', err);
      set({ loaded: true, fetching: false });
    }
  },

  reset() {
    set({ notices: [], loaded: false, fetching: false });
  },

  dismiss(id: string) {
    // Optimistic: remove immediately
    const prev = get().notices;
    set({ notices: prev.filter(n => n.id !== id) });

    // POST in background; retry once on error
    const post = () => axios.post(`/system-notices/${id}/dismiss`);
    post().catch(() => {
      setTimeout(() => {
        post().catch(e => console.warn('[systemNotices] dismiss failed:', e));
      }, 2000);
    });
  },
}));
