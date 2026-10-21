import React, { useEffect } from 'react';
import { useSystemNoticeStore } from '../../store/systemNoticeStore.js';
import { ModalRenderer } from './SystemNoticeModal.js';
import { BannerRenderer, ToastRenderer } from './SystemNoticeBanner.js';

export function SystemNoticeHost() {
  const { notices, loaded } = useSystemNoticeStore();

  // Notices are fetched by authStore after login (see App.tsx / authStore modification).
  // Cold-session fetch (page reload with valid session) is triggered here:
  useEffect(() => {
    // Only fetch if not already loaded (authStore may have already triggered)
    if (!loaded) {
      useSystemNoticeStore.getState().fetch();
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return null;

  const modals  = notices.filter(n => n.display === 'modal');
  const banners = notices.filter(n => n.display === 'banner');
  const toasts  = notices.filter(n => n.display === 'toast');

  return (
    <>
      <BannerRenderer notices={banners} />
      <ModalRenderer  notices={modals}  />
      <ToastRenderer  notices={toasts}  />
    </>
  );
}
