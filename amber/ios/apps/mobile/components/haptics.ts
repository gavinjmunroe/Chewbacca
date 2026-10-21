import * as Haptics from 'expo-haptics';

// One place for the design system's haptic vocabulary so a tap, a confirmation,
// and an error feel identical everywhere they fire. Calls are fire-and-forget;
// haptics are never load-bearing and a rejection (unsupported device) is ignored.
export const haptics = {
  tap() {
    Haptics.selectionAsync().catch(() => {});
  },
  impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
    Haptics.impactAsync(style).catch(() => {});
  },
  success() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  error() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
