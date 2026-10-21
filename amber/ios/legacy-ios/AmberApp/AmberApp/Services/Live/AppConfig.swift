import Foundation

/// Single source of truth for environment-dependent configuration.
/// Values are read from the Info.plist `AmberConfig` dictionary, which is
/// populated at build time by xcconfig substitution
/// (Development/Staging/Release.xcconfig). Compile-time fallbacks point at
/// production amber-id / amber-agent so a misconfigured build is loud but
/// not silently broken.
struct AmberAppConfig {
    let amberAgentBaseURL: URL
    let amberIDBaseURL: URL
    let privyAppId: String
    let privyAppClientId: String
    let composioProjectId: String
    let composioRedirectURL: URL
    let exaApiKeyLookupName: String
    let environment: Environment

    enum Environment: String { case development, staging, production }

    /// True when xcconfig substitution did not run (placeholder or empty
    /// string). The app should refuse to make outbound calls in this state
    /// rather than silently hitting prod with wrong credentials.
    var isMisconfigured: Bool {
        privyAppId.isEmpty
            || privyAppId.hasPrefix("REPLACE_WITH_")
            || privyAppId.hasPrefix("$(")
    }

    static let `default`: AmberAppConfig = {
        let plist = Bundle.main.object(forInfoDictionaryKey: "AmberConfig") as? [String: Any] ?? [:]
        let envString = (plist["Environment"] as? String) ?? "production"
        let env = Environment(rawValue: envString) ?? .production

        let agentURL = sanitizedURL(plist["AmberAgentBaseURL"] as? String)
            ?? URL(string: "https://amber-agent-production.up.railway.app")!
        let idURL = sanitizedURL(plist["AmberIDBaseURL"] as? String)
            ?? URL(string: "https://amber-id-production.up.railway.app")!
        let privy = sanitizedString(plist["PrivyAppId"] as? String) ?? ""
        let privyClient = sanitizedString(plist["PrivyAppClientId"] as? String) ?? ""
        let composioProject = sanitizedString(plist["ComposioProjectId"] as? String) ?? ""
        let composioRedirect = sanitizedURL(plist["ComposioRedirectURL"] as? String)
            ?? URL(string: "amber://composio/callback")!
        let exaKeyName = sanitizedString(plist["ExaKeychainKey"] as? String) ?? "amber.exa.apiKey"

        return AmberAppConfig(
            amberAgentBaseURL: agentURL,
            amberIDBaseURL: idURL,
            privyAppId: privy,
            privyAppClientId: privyClient,
            composioProjectId: composioProject,
            composioRedirectURL: composioRedirect,
            exaApiKeyLookupName: exaKeyName,
            environment: env
        )
    }()

    /// Returns the trimmed string, or nil if it is empty / still a build-time
    /// placeholder (`$(VAR)`, `REPLACE_WITH_*`).
    private static func sanitizedString(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let s = raw.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return nil }
        if s.hasPrefix("$(") { return nil }
        if s.hasPrefix("REPLACE_WITH_") { return nil }
        return s
    }

    private static func sanitizedURL(_ raw: String?) -> URL? {
        guard let s = sanitizedString(raw) else { return nil }
        return URL(string: s)
    }
}
