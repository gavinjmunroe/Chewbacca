import { useState } from 'react';
import { View } from 'react-native';
import * as Updates from 'expo-updates';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { cl } from '../lib/classical';
import { spacing } from '../lib/tokens';
import { toast } from '../lib/toast';

/**
 * WHICH BUNDLE AM I ACTUALLY RUNNING.
 *
 * Three separate rounds of "I don't see any of the changes" turned out to be
 * the same thing each time: the app was running an older JS bundle than the one
 * that had just been published. There was no way to tell from inside the app --
 * no version, no channel, no build date anywhere -- so the only way to find out
 * was to change something impossible to miss and go looking for it. That is a
 * terrible instrument, and it cost several evenings.
 *
 * This is the instrument. One line at the bottom of Profile:
 *
 *     1.0.1 - preview - Sep 8, 9:24 PM - a422de37
 *
 * `channel` is which stream of updates this binary listens to. A build made
 * with the production profile will NEVER receive an update published to the
 * preview branch, and that mismatch is completely invisible without this line.
 * The date is when the running bundle was published, so "did my update land" is
 * answered by looking rather than by guessing.
 *
 * "embedded" means no OTA update has been applied and the app is running the
 * bundle compiled into the binary.
 *
 * Tapping it checks for an update immediately and applies it, instead of
 * waiting for the two cold starts expo-updates otherwise needs.
 */
export function BuildStamp() {
  const [checking, setChecking] = useState(false);

  // Updates.* are inert in dev and in Expo Go -- updateId is null and channel is
  // undefined there. Say so plainly rather than rendering a blank line.
  const channel = Updates.channel || 'dev';
  const runtime = Updates.runtimeVersion || '—';
  const created = Updates.createdAt
    ? Updates.createdAt.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'embedded';
  // Enough of the id to tell two updates apart at a glance, which is all it is for.
  const shortId = Updates.updateId ? Updates.updateId.slice(0, 8) : null;

  const check = async () => {
    if (checking || __DEV__) return;
    setChecking(true);
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        toast.info('You are on the newest bundle.');
        return;
      }
      toast.info('Downloading a new bundle…');
      await Updates.fetchUpdateAsync();
      // Applies it now. The alternative is telling the user to force-quit twice,
      // which is exactly what we have been doing.
      await Updates.reloadAsync();
    } catch {
      toast.error('Could not check for an update.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Pressable
      onPress={() => void check()}
      accessibilityRole="button"
      accessibilityLabel="Build information. Tap to check for an update."
      hitSlop={12}
      style={{ alignSelf: 'center', marginTop: spacing.md }}
    >
      {({ pressed }) => (
        <View style={{ paddingVertical: spacing.xs, opacity: pressed ? 0.5 : 1 }}>
          <CText t="metaSm" color={cl.ink38} style={{ textAlign: 'center' }}>
            {`${runtime} · ${channel} · ${created}${shortId ? ` · ${shortId}` : ''}`}
          </CText>
        </View>
      )}
    </Pressable>
  );
}
