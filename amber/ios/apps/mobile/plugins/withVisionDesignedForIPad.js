/**
 * Expo config plugin: opt the iPad build into "Designed for iPad" mode
 * on visionOS so the same binary runs as a windowed app on Vision Pro
 * without a separate visionOS target.
 *
 * Apple ships two paths to ship for visionOS:
 *   1. Native visionOS — adds device family 7 to TARGETED_DEVICE_FAMILY
 *      and requires every linked Pod to declare visionOS in its
 *      podspec. Skia, Reanimated, and expo-calendar do not all support
 *      this today, so the native path would block on third-party work.
 *   2. "Designed for iPad" — flips SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD
 *      = YES on the iOS app target so the iPad slice loads inside the
 *      visionOS Compatibility Layer. No native code changes; no new
 *      Pods; the existing ThreePaneLayout (which is already iPad-aware
 *      via useWindowDimensions at 760pt+) renders as a Vision Pro
 *      window automatically.
 *
 * We take path 2 here. A future milestone can graduate to a true
 * visionOS target once the relevant native modules ship visionOS
 * support.
 *
 * Apple Developer reference:
 *   developer.apple.com/documentation/visionos/checking-whether-your-existing-app-is-compatible
 */

const { withXcodeProject } = require('@expo/config-plugins');

function applyToAppTarget(xcodeProject, appTargetName) {
  const xcBuildConfigSection = xcodeProject.pbxXCBuildConfigurationSection();
  const configList = xcodeProject.pbxXCConfigurationList();
  const targets = xcodeProject.pbxNativeTargetSection();

  let appConfigListUuid = null;
  for (const key of Object.keys(targets)) {
    if (key.endsWith('_comment')) continue;
    const target = targets[key];
    if (target?.name === appTargetName) {
      appConfigListUuid = target.buildConfigurationList;
      break;
    }
  }
  if (!appConfigListUuid) {
    throw new Error(`[withVisionDesignedForIPad] could not find native target "${appTargetName}"`);
  }

  const appConfigList = configList[appConfigListUuid];
  if (!appConfigList) {
    throw new Error(`[withVisionDesignedForIPad] no configuration list for ${appTargetName}`);
  }

  for (const ref of appConfigList.buildConfigurations) {
    const buildConfig = xcBuildConfigSection[ref.value];
    if (!buildConfig?.buildSettings) continue;
    const bs = buildConfig.buildSettings;
    bs.SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD = 'YES';
  }
}

const withVisionDesignedForIPad = (config) => {
  return withXcodeProject(config, (cfg) => {
    const projectName = cfg.modRequest.projectName || cfg.name || 'App';
    applyToAppTarget(cfg.modResults, projectName);
    return cfg;
  });
};

module.exports = withVisionDesignedForIPad;
