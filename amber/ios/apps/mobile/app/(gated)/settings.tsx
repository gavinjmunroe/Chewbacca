import { View } from 'react-native';
import { AmberBackdrop } from '../../components/AmberBackdrop';
import { SettingsPage } from '../../components/pages/SettingsPage';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary';
import { LIGHT } from '../../lib/theme';

/**
 * SETTINGS, BEHIND THE GEAR.
 *
 * A PUSHED ROUTE RATHER THAN A FOURTH PAGE IN THE PAGER, and that is the whole
 * reason it is cheap. The pager keeps every page it holds mounted from cold
 * launch -- which is why ProfilePage guards its own queries behind `everActive`
 * -- and settings is a screen you open twice a year carrying five queries. A
 * route costs nothing until it is opened and takes them with it when it closes.
 *
 * THE BACKDROP IS HERE, NOT IN THE PAGE. Every section on this screen moved off
 * the profile, which is drawn over the ground app/(gated)/home.tsx paints behind
 * the whole pager -- white paper with three faint warm radials in it, not a
 * colored wash (scripts/palette-check.mts holds it at L* 98+). A pushed route
 * has no such parent, so without these two layers the cream cards and gold
 * hairlines would sit on flat canvas: a small difference, and exactly the kind
 * that makes a moved screen look like a different screen. Same two layers as
 * home.tsx, in the same order.
 *
 * The error boundary is the same one the rest of the gated group uses: a throw
 * in here should lose the settings screen, not the session.
 */
export { RouteErrorBoundary as ErrorBoundary };

export default function SettingsRoute() {
  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
      <AmberBackdrop />
      <SettingsPage />
    </View>
  );
}
