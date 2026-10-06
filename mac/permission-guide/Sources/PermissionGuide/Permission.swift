import Foundation

/// How the card asks for the grant.
///
/// Anarlog splits panes the same way (guidance.rs): **drag** panes are lists
/// with a + button, where the person has to add the app themselves, so the card
/// offers the app as a real drag source. **Toggle** panes only ever list apps
/// that already asked macOS, so there is nothing to drop and the card points at
/// the switch instead.
enum CardMode: String {
    case drag
    case toggle
}

/// Where macOS keeps a grant. The rows below were read off this Mac's two TCC
/// databases on 2026-10-05: ScreenCapture, SystemPolicyAllFiles and
/// Accessibility sat in the system one, Microphone, Calendar, AddressBook and
/// AppleEvents in the user one. The probe still reads both for every service,
/// because Apple has moved services between them across releases.
struct Permission {
    let id: String
    let paneTitle: String
    let anchor: String
    let tccService: String
    let mode: CardMode

    var title: String { "Allow \(paneTitle)" }

    func subtitle(appName: String) -> String {
        switch mode {
        // Anarlog's exact line (overlay.rs).
        case .drag: return "Drag the app below into the list above."
        case .toggle: return "Switch \(appName) on in the list above."
        }
    }

    /// Anarlog's order (guidance.rs privacy_settings_deep_link_urls, then the
    /// two bare fallbacks ext.rs adds): the Ventura extension URL first, the
    /// legacy preference pane URL second, then the same two without an anchor
    /// so a pane Apple renamed still lands in Privacy and Security.
    var settingsURLs: [String] {
        [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(anchor)",
            "x-apple.systempreferences:com.apple.preference.security?\(anchor)",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
            "x-apple.systempreferences:com.apple.preference.security",
        ]
    }

    static let all: [Permission] = [
        Permission(id: "accessibility", paneTitle: "Accessibility",
                   anchor: "Privacy_Accessibility", tccService: "kTCCServiceAccessibility",
                   mode: .drag),
        // The pane is titled "Screen & System Audio Recording" since Sonoma and
        // holds both the screen list and the system-audio-only list, which is
        // why this is one permission and not two. It has a + button, so it is
        // a drag pane even though Anarlog routes it through a native prompt.
        Permission(id: "screen-recording-and-system-audio", paneTitle: "Screen & System Audio Recording",
                   anchor: "Privacy_ScreenCapture", tccService: "kTCCServiceScreenCapture",
                   mode: .drag),
        Permission(id: "microphone", paneTitle: "Microphone",
                   anchor: "Privacy_Microphone", tccService: "kTCCServiceMicrophone",
                   mode: .toggle),
        Permission(id: "full-disk-access", paneTitle: "Full Disk Access",
                   anchor: "Privacy_AllFiles", tccService: "kTCCServiceSystemPolicyAllFiles",
                   mode: .drag),
        Permission(id: "calendars", paneTitle: "Calendars",
                   anchor: "Privacy_Calendars", tccService: "kTCCServiceCalendar",
                   mode: .toggle),
        Permission(id: "contacts", paneTitle: "Contacts",
                   anchor: "Privacy_Contacts", tccService: "kTCCServiceAddressBook",
                   mode: .toggle),
        Permission(id: "automation", paneTitle: "Automation",
                   anchor: "Privacy_Automation", tccService: "kTCCServiceAppleEvents",
                   mode: .toggle),
    ]

    static func named(_ id: String) -> Permission? {
        all.first { $0.id == id }
    }
}
