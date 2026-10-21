/**
 * Expo config plugin: enable Mac Catalyst on the iOS app target.
 *
 * This flips the Xcode build settings that EAS' iOS prebuild generates
 * so the same binary slice can run on macOS via Mac Catalyst, without
 * forking into a separate macOS Expo project. Skia, Reanimated 4,
 * EventKit (expo-calendar), and Contacts.framework (expo-contacts) all
 * work under Catalyst on macOS 12+.
 *
 * Build settings applied to every config (Debug, Release, …) on the
 * primary app target:
 *
 *   SUPPORTS_MACCATALYST                       = YES
 *   DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO
 *   TARGETED_DEVICE_FAMILY                     = "1,2,6"   (iPhone, iPad, Mac)
 *   SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD      = NO        (Catalyst is the Mac path)
 *   MACOSX_DEPLOYMENT_TARGET                   = 13.0
 *
 * Apple-internal tests / Pods targets are left alone — only the main
 * app target gains the Catalyst destination.
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
    throw new Error(`[withMacCatalyst] could not find native target "${appTargetName}"`);
  }

  const appConfigList = configList[appConfigListUuid];
  if (!appConfigList) {
    throw new Error(`[withMacCatalyst] could not find configuration list for ${appTargetName}`);
  }

  for (const ref of appConfigList.buildConfigurations) {
    const buildConfig = xcBuildConfigSection[ref.value];
    if (!buildConfig?.buildSettings) continue;
    const bs = buildConfig.buildSettings;
    bs.SUPPORTS_MACCATALYST = 'YES';
    bs.DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = 'NO';
    bs.TARGETED_DEVICE_FAMILY = '"1,2,6"';
    bs.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = 'NO';
    bs.MACOSX_DEPLOYMENT_TARGET = '13.0';
  }
}

const withMacCatalyst = (config) => {
  return withXcodeProject(config, (cfg) => {
    const projectName = cfg.modRequest.projectName || cfg.name || 'App';
    applyToAppTarget(cfg.modResults, projectName);
    return cfg;
  });
};

module.exports = withMacCatalyst;
