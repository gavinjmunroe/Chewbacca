// Tab 9 motion primitives: haptic vocabulary.
//
// Item #125 (and used by #126, #127, list staggers): one place that decides
// which physical feedback maps to which interaction, so a "press" feels the
// same whether it fires from a button, a card, or a citation chip.
//
// Every call is fire-and-forget and swallows errors. Haptics are unavailable on
// the simulator and on devices with the Taptic Engine disabled; a missing buzz
// must never throw into an animation callback. Safe to call from runOnJS inside
// a worklet.

import * as Haptics from 'expo-haptics';

/** Light tick. Fire when a tappable is pressed in (PressableScale, chips). */
export function hapticPress(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Selection change. Use as cards stagger in or a picker value moves. */
export function hapticSelection(): void {
  Haptics.selectionAsync().catch(() => {});
}

/** Medium impact. Heavier confirmations, sheet snap-to-dismiss. */
export function hapticImpact(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Success notification. Completed actions, checkmark reveal. */
export function hapticSuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Warning notification. Destructive confirms, recoverable errors. */
export function hapticWarning(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Error notification. Failed actions the user must act on. */
export function hapticError(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
