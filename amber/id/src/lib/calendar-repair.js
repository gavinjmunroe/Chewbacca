import { getSecrets } from "../db/secrets.js";
import {
  connectCalendarAccount,
  listCalendarAccounts,
} from "../db/calendar-accounts.js";
/** Explicit recovery repairs a legacy Google grant without requesting credentials again. */
export async function restoreGoogleCalendar(ownerId, deps = {}) {
  const current = await (deps.list ?? listCalendarAccounts)(ownerId);
  if (!current) throw Error("calendars_unavailable");
  const bag = await (deps.secrets ?? getSecrets)(`did:amber:${ownerId}`);
  const email = bag.GCAL_OAUTH_ACCOUNT_EMAIL;
  if (!email || !bag.GCAL_OAUTH_REFRESH || !bag.GCAL_OAUTH_SCOPES) return false;
  if (
    current.some(
      (a) =>
        a.provider === "google" &&
        a.accountEmail?.toLowerCase() === email.toLowerCase(),
    )
  )
    return false;
  const account = await (deps.connect ?? connectCalendarAccount)(ownerId, {
    provider: "google",
    accountEmail: email,
    refreshToken: bag.GCAL_OAUTH_REFRESH,
    accessToken: bag.GCAL_OAUTH_ACCESS,
    expiresAt: bag.GCAL_OAUTH_EXPIRES_AT,
    scopes: bag.GCAL_OAUTH_SCOPES,
  });
  if (!account) throw Error("calendar_setup_failed");
  return true;
}
