import { useEvent, useHandler } from 'react-native-reanimated';

// A REANIMATED EVENT HANDLER for react-native-pager-view's `onPageScroll`.
//
// This exists because the obvious thing does not work. Writing
//
//   onPageScroll={(e) => { 'worklet'; cursor.value = e.nativeEvent.position + ... }}
//
// looks like a worklet and is not one. Reanimated's NativeEventsManager decides
// whether a prop is an event worklet by checking `prop.workletEventHandler
// instanceof WorkletEventHandler`; a plain inline arrow fails that test and
// PropsFilter passes it straight through to PagerView as an ORDINARY JS CALLBACK.
// The `'worklet'` directive is silently irrelevant. The result is a shared value
// written from the JS thread once per frame of every page slide — asynchronous,
// a frame behind, and dropped entirely whenever the JS thread is busy, which is
// precisely when a transition needs to stay smooth.
//
// `useHandler` + `useEvent` are the only supported way to get a real UI-thread
// handler out of a direct event. The worklet writes ONLY a shared value, never
// React state, so there is zero per-frame reconciliation.
//
// The event carries `position` (the settled page) and `offset` (0..1 through the
// current swipe), so `position + offset` is a continuous cursor across the pages.
//
// Hoisted into lib/ rather than copied per screen: it was defined locally in
// home.tsx, and the second pager (ContactsPage's Contacts↔Circles pager) hand-rolled
// the broken inline version instead — so one screen's transition was frame-locked
// and the other's only looked like it was. One implementation, no way to drift.

export type PagerScrollEvent = { position: number; offset: number; eventName: string };

export function usePagerScrollHandler(handlers: {
  onPageScroll: (event: PagerScrollEvent) => void;
}) {
  const { doDependenciesDiffer } = useHandler(handlers as never, []);
  return useEvent<PagerScrollEvent>(
    (event) => {
      'worklet';
      const { onPageScroll } = handlers;
      if (onPageScroll && event.eventName.endsWith('onPageScroll')) {
        onPageScroll(event);
      }
    },
    ['onPageScroll'],
    doDependenciesDiffer,
  );
}
