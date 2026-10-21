import { api, unwrapSingle, type Me } from './api';
import { hasOnboarded, markOnboarded } from './secureStorage';

export function profileCompletedOnboarding(me: Me | null): boolean {
  if (!me) return false;
  if ('onboardingCompletedAt' in me) return !!me.onboardingCompletedAt;
  // Compatibility with older servers that did not return the completion field.
  return !!me.displayName?.trim();
}

export async function isOnboardingComplete(): Promise<boolean> {
  if (await hasOnboarded()) return true;
  try {
    const result = await api.me();
    // An unavailable profile is not evidence that a returning account is new.
    // Do not cache this fallback; retry against the server next time.
    if (!result.ok) return true;
    const done = profileCompletedOnboarding(unwrapSingle<Me>(result));
    if (done) await markOnboarded();
    return done;
  } catch {
    return true;
  }
}
