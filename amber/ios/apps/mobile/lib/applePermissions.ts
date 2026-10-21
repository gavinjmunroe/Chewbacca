import * as Contacts from 'expo-contacts';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type HealthSummary = { from: string; to: string; steps?: number; workoutMinutes?: number };
export async function readHealthSummary(): Promise<HealthSummary> {
  const native = nativePermissions();
  if (!native?.healthSummary) throw Error('Install the updated Amber beta to preview Health data.');
  return native.healthSummary();
}
export type ApplePermission = 'location' | 'contacts' | 'photos' | 'health' | 'fitness';
export type PermissionState = 'notDetermined' | 'granted' | 'limited' | 'denied' | 'restricted' | 'reviewed' | 'unavailable';
type PermissionBridge = {
  healthSummary(): Promise<HealthSummary>;
  getStatus(kind: Exclude<ApplePermission, 'contacts'>): Promise<PermissionState>;
  request(kind: Exclude<ApplePermission, 'contacts'>): Promise<PermissionState>;
};
function nativePermissions() {
  return Platform.OS === 'ios' ? requireOptionalNativeModule<PermissionBridge>('AmberPermissions') : null;
}
export const APPLE_PERMISSIONS: { key: ApplePermission; title: string; purpose: string }[] = [
  { key: 'location', title: 'Location', purpose: 'Use location while Amber is open. Sharing remains a separate choice.' },
  { key: 'contacts', title: 'Contacts', purpose: 'Choose the people you want to bring into People.' },
  { key: 'photos', title: 'Photos', purpose: 'Choose photos to add to your relationship memories.' },
  { key: 'health', title: 'Health', purpose: 'Choose access to steps and workouts in Apple Health.' },
  { key: 'fitness', title: 'Fitness', purpose: 'Allow motion and activity context from this iPhone.' },
];
export function permissionLabel(status: PermissionState): string {
  return ({ notDetermined: 'Not requested', granted: 'Allowed', limited: 'Selected only', denied: 'Not allowed', restricted: 'Restricted', reviewed: 'Choices reviewed', unavailable: 'Unavailable in this build' })[status];
}
export function permissionAction(status: PermissionState): string {
  return status === 'denied' || status === 'restricted' || status === 'granted' || status === 'limited' ? 'Settings' : status === 'reviewed' ? 'Manage' : 'Allow';
}
function contactsState(result: Contacts.ContactsPermissionResponse): PermissionState {
  if (result.status === 'granted') return result.accessPrivileges === 'limited' ? 'limited' : 'granted';
  return result.status === 'denied' ? 'denied' : 'notDetermined';
}
export async function getApplePermission(kind: ApplePermission): Promise<PermissionState> {
  if (Platform.OS !== 'ios') return 'unavailable';
  if (kind === 'contacts') return contactsState(await Contacts.getPermissionsAsync());
  const native = nativePermissions();
  return native ? native.getStatus(kind) : 'unavailable';
}
export async function requestApplePermission(kind: ApplePermission): Promise<PermissionState> {
  if (Platform.OS !== 'ios') return 'unavailable';
  if (kind === 'contacts') return contactsState(await Contacts.requestPermissionsAsync());
  const native = nativePermissions();
  return native ? native.request(kind) : 'unavailable';
}

// Apple documents this route at https://support.apple.com/en-us/108779.
export const HEALTH_MANAGEMENT_INSTRUCTIONS = 'Open Health → your profile → Apps → Amber to change access to steps and workouts. Apple keeps your read-permission choices private.';

/** A completed Health sheet cannot be presented again for the same data types. */
export async function performApplePermissionAction(kind: ApplePermission, current: PermissionState): Promise<
  | { kind: 'instructions'; message: string }
  | { kind: 'settings' }
  | { kind: 'permission'; status: PermissionState }
> {
  const action = permissionAction(current);
  if (action === 'Manage') return { kind: 'instructions', message: HEALTH_MANAGEMENT_INSTRUCTIONS };
  if (action === 'Settings') return { kind: 'settings' };
  return { kind: 'permission', status: await requestApplePermission(kind) };
}
