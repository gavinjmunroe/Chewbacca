import CoreGraphics
import Foundation

/// When the glass should get out of the way on its own (bd_2026-Code-5wa).
///
/// Nothing noticed a screen share, so the display stayed up in a meeting and
/// showed a room what the person had asked their assistant. Nothing let a
/// person say "never over this app" either, and a full-screen app got the
/// overlay on top with no way out but hiding it by hand every time.
///
/// `sharing` reads the window list for the windows sharing apps put up while
/// they share; `DenyList` is `~/.bob/hud-deny.txt`. The app checks both every
/// `interval` and on every app switch, and hides the layer while either says
/// so, bringing it back as it was when they stop.
///
/// Excluding the window from capture is not the answer: `sharingType = .none`
/// was tried and ScreenCaptureKit ignores it (see `OverlayWindow`).
public enum ScreenShare {
    /// One on-screen window, as the window server describes it.
    public struct Window: Equatable, Sendable {
        public let owner: String
        public let title: String
        public let bounds: CGRect
        public let pid: Int32
        public let layer: Int

        public init(owner: String, title: String, bounds: CGRect = .zero, pid: Int32 = 0, layer: Int = 0) {
            self.owner = owner
            self.title = title
            self.bounds = bounds
            self.pid = pid
            self.layer = layer
        }
    }

    /// A window that only exists while its app is sharing the screen.
    struct Signature: Sendable {
        /// Matched against the owning app's name, case-insensitively, as a
        /// substring, so "Google Chrome" and "Google Chrome Beta" both count.
        let owners: [String]
        /// Matched against the window title the same way.
        let title: String
        /// Where the title was found. Each is a string read out of the app's
        /// own bundle on 2026-10-10; none has been seen on a live share yet.
        let evidence: String
    }

    static let signatures: [Signature] = [
        Signature(
            owners: ["zoom.us"], title: "zoom share statusbar window",
            evidence: "zVideoUI.bundle and CptHost in zoom.us.app"),
        Signature(
            owners: ["zoom.us"], title: "zoom share toolbar window",
            evidence: "zVideoUI.bundle and CptHost in zoom.us.app"),
        // Chromium's capture bar: "meet.google.com is sharing your screen."
        // English only: another language's bar does not match.
        Signature(
            owners: ["Chrome", "Chromium", "Brave", "Edge", "Arc", "Vivaldi", "Opera"],
            title: " is sharing your screen",
            evidence: "Chrome 154 en.lproj/locale.pak"),
        Signature(
            owners: ["Chrome", "Chromium", "Brave", "Edge", "Arc", "Vivaldi", "Opera"],
            title: " is sharing a window",
            evidence: "Chrome 154 en.lproj/locale.pak"),
    ]

    /// How often the window list is read. A share that starts is hidden from
    /// within this long; reading the list costs a few milliseconds. Guessed,
    /// never measured.
    public static let interval: TimeInterval = 2

    /// The app that is sharing the screen, or nil. `session` is the login
    /// session's dictionary, where macOS's own Screen Sharing sets
    /// `CGSSessionScreenIsShared` while someone is watching (a key reported
    /// by others and absent from this Mac's session on 2026-10-10, when
    /// nobody was).
    public static func sharing(_ windows: [Window], session: [String: Any] = [:]) -> String? {
        if (session["CGSSessionScreenIsShared"] as? Bool) == true
            || (session["CGSSessionScreenIsShared"] as? Int) == 1 {
            return "Screen Sharing"
        }
        for window in windows {
            let owner = window.owner.lowercased()
            let title = window.title.lowercased()
            guard !title.isEmpty else { continue }
            for signature in signatures
            where signature.owners.contains(where: { owner.contains($0.lowercased()) })
                && title.contains(signature.title.lowercased()) {
                return window.owner
            }
        }
        return nil
    }

    /// Every on-screen window. Titles of other apps' windows are only
    /// readable with Screen Recording, which Kyber has (granted 2026-10-03);
    /// without it every title is empty and only the session check works.
    public static func onScreen() -> [Window] {
        let list = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return list.map { info in
            let bounds = (info[kCGWindowBounds as String] as? NSDictionary)
                .flatMap { CGRect(dictionaryRepresentation: $0) } ?? .zero
            return Window(
                owner: info[kCGWindowOwnerName as String] as? String ?? "",
                title: info[kCGWindowName as String] as? String ?? "",
                bounds: bounds,
                pid: info[kCGWindowOwnerPID as String] as? Int32 ?? 0,
                layer: info[kCGWindowLayer as String] as? Int ?? 0)
        }
    }

    /// The login session's dictionary.
    public static func session() -> [String: Any] {
        CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    }
}

/// Apps the glass hides itself over: `~/.bob/hud-deny.txt`, one per line, an
/// app's name or bundle id, `#` for a comment. The word `fullscreen` on its
/// own line hides it over any app filling the whole screen.
///
/// ```
/// # never over these
/// Keynote
/// com.apple.FaceTime
/// fullscreen
/// ```
public struct DenyList: Equatable, Sendable {
    public let apps: Set<String>
    public let fullScreen: Bool

    public init(_ text: String) {
        var apps: Set<String> = []
        var fullScreen = false
        for raw in text.split(whereSeparator: \.isNewline) {
            let line = raw.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
                .first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
            guard !line.isEmpty else { continue }
            if line.lowercased() == "fullscreen" { fullScreen = true } else { apps.insert(line.lowercased()) }
        }
        self.apps = apps
        self.fullScreen = fullScreen
    }

    public static var path: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".bob/hud-deny.txt")
    }

    /// The list on disk, or an empty one.
    public static func load(from url: URL = path) -> DenyList {
        DenyList((try? String(contentsOf: url, encoding: .utf8)) ?? "")
    }

    /// Whether the glass should hide while this app is in front.
    /// `filling` is whether its front window covers the whole screen.
    public func denies(name: String?, bundle: String?, filling: Bool) -> Bool {
        if fullScreen && filling { return true }
        if let name, apps.contains(name.lowercased()) { return true }
        if let bundle, apps.contains(bundle.lowercased()) { return true }
        return false
    }
}
