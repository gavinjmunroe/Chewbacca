/**
 * @bacons/apple-targets configuration for the Amber "record" widget extension.
 *
 * This declares a WidgetKit extension target. It is INERT until `expo prebuild`
 * runs — the plugin reads this file, generates the extension's Xcode target
 * (Info.plist / NSExtension included automatically for the `widget` type), and
 * links the Swift sources that live alongside this file in `index.swift`.
 *
 * `deploymentTarget` is set to 15.1 (Expo SDK 54's default iOS min) so the Home
 * Screen families work on iOS 15; the Lock Screen accessory families (iOS 16+)
 * are added conditionally in Swift behind `#available` guards.
 *
 * @type {import('@bacons/apple-targets/app.config').Config}
 */
module.exports = {
  type: "widget",
  // Display name shown in the widget gallery ("Amber").
  name: "AmberRecordWidget",
  // EXPLICIT, because the plugin's default is derived from `type` -- it produced
  // `com.joinrytual.amber.widget`, which Apple refuses to register: that exact
  // identifier is either held by another team or was registered and deleted, and
  // Apple permanently reserves deleted App ID strings. Naming it here also means
  // the id can never drift if the plugin changes how it derives defaults.
  bundleIdentifier: "com.joinrytual.amber.recordwidget",
  // Match the app's minimum so the Home Screen widget runs on iOS 15+.
  deploymentTarget: "15.1",
  // WidgetKit + SwiftUI are the only frameworks this launcher needs.
  frameworks: ["SwiftUI", "WidgetKit"],
};
