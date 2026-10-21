/**
 * The app config, as Expo hands it to the running app. Values come from
 * app.json so a test reads the SAME configuration the build does rather than a
 * made-up one -- config drift is exactly the kind of thing worth catching.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let appJson = { expo: {} };
try {
  appJson = JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8'));
} catch {
  /* a test that needs it will fail on the missing field, which is the point */
}

const expoConfig = { ...(appJson.expo ?? {}), extra: appJson.expo?.extra ?? {} };
export default { expoConfig, manifest: expoConfig, manifest2: null, appOwnership: null, executionEnvironment: 'standalone' };
export { expoConfig };
