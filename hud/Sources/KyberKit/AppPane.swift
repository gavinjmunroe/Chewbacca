import AppKit
import SwiftUI
import WebKit

/// A whole local web app on the glass: Realm's own desktop interface.
///
/// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm). Its
/// renderer is built as a static bundle and served on 127.0.0.1 by
/// bin/lib/realm_ui/server.mjs, which also pipes its WebSocket to the engine
/// Kyber already runs (bin/realm-ui). This draws that page as the surface's
/// content, so the sessions list, session view, editor, diff, terminal and
/// command palette are Carlton's, not a rebuild of them.
///
/// It is not a window: it lives inside a glass surface, comes up when the
/// surface opens and goes with it. Escape inside the page closes the surface
/// when the page had nothing of its own open to close (a palette, a menu, a
/// dialog), which the bridge decides in the page and posts here as `dismiss`.
///
/// Only loopback loads. A link in a transcript that leaves the app's origin
/// is opened in the person's browser in the background and never replaces
/// the app, and nothing but http on 127.0.0.1 or localhost is ever loaded.
struct AppPaneView: View {
    let url: String
    /// Points. Nil fills the surface's ceiling less the card's own padding.
    let height: CGFloat?

    @Environment(\.hudDismiss) private var dismiss

    /// What the card spends around its content, so the pane plus the card
    /// stays under the ceiling. Guessed, never measured on the glass: two
    /// rows of padding with room to spare.
    static let cardInset: CGFloat = 40
    /// The shortest the app is drawn. Realm's own window refuses to go below
    /// 900 x 600 (apps/desktop/src/main/index.ts, minWidth and minHeight at
    /// 59afd9e4), so smaller is a layout it was never designed for.
    static let minHeight: CGFloat = 600

    var body: some View {
        if let page = Self.allowed(url) {
            AppPane(url: page, onDismiss: dismiss)
                .frame(height: Self.resolvedHeight(height, ceiling: OverlaySurface.ceiling))
                .clipShape(RoundedRectangle(cornerRadius: Realm.Radius.card, style: .continuous))
                .accessibilityLabel("Realm")
        }
    }

    static func resolvedHeight(_ asked: CGFloat?, ceiling: CGFloat) -> CGFloat {
        let room = max(minHeight, ceiling - cardInset)
        guard let asked, asked > 0 else { return room }
        return min(max(asked, minHeight), room)
    }

    /// The address as a URL the pane may load: http on this Mac, with a
    /// port, nothing else. The server binds 127.0.0.1 only.
    nonisolated static func allowed(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let page = URL(string: trimmed), page.scheme?.lowercased() == "http",
              let host = page.host?.lowercased(), host == "127.0.0.1" || host == "localhost",
              page.port != nil else { return nil }
        return page
    }

    /// Whether a navigation stays in the app: same scheme, host and port as
    /// the page it loaded. A blank frame is how pages start.
    nonisolated static func staysInApp(_ target: URL?, app: URL) -> Bool {
        guard let target else { return false }
        if target.absoluteString == "about:blank" { return true }
        return target.scheme?.lowercased() == app.scheme?.lowercased()
            && target.host?.lowercased() == app.host?.lowercased()
            && target.port == app.port
    }

    /// Where a link that leaves the app may go instead: the person's own
    /// browser, for http and https only. A file, javascript or custom scheme
    /// from a transcript goes nowhere.
    nonisolated static func outside(_ target: URL?) -> URL? {
        guard let target, let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https",
              target.host?.isEmpty == false else { return nil }
        return target
    }

    /// The server's state file (bin/lib/realm_ui, server.json, mode 0600).
    nonisolated static var stateFile: URL {
        if let home = ProcessInfo.processInfo.environment["CHEWBACCA_REALM_UI_HOME"], !home.isEmpty {
            return URL(fileURLWithPath: (home as NSString).expandingTildeInPath).appendingPathComponent("server.json")
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".chewbacca/realm-ui/server.json")
    }

    /// The pipe's token for the server at `page`, read from the state file
    /// only this account can read. server.mjs never serves it over http, so
    /// another account on the Mac that can reach the port cannot learn it.
    /// Nil when the file is missing or names a different port.
    nonisolated static func pipeToken(for page: URL, file: URL = stateFile) -> String? {
        guard let data = try? Data(contentsOf: file),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = state["token"] as? String, !token.isEmpty,
              let port = state["port"] as? Int, port == page.port else { return nil }
        return token
    }

    /// A JSON string literal, which is also a JavaScript one.
    nonisolated static func jsString(_ text: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              let array = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(array.dropFirst().dropLast())
    }
}

/// WKWebView that takes the keyboard when it is clicked.
///
/// The glass is a non-activating panel that becomes key only for a view that
/// asks for it (`becomesKeyOnlyIfNeeded`, Overlay.swift). A WKWebView does
/// not ask, so the first build of this pane took clicks and dropped every
/// key. Asking makes the panel key without activating Kyber, so the app the
/// person was in stays frontmost.
final class GlassWebView: WKWebView {
    override var needsPanelToBecomeKey: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

private struct AppPane: NSViewRepresentable {
    let url: URL
    let onDismiss: (@MainActor @Sendable () -> Void)?

    /// The page's own storage, kept between openings and apart from every
    /// other web view on the Mac. Realm keeps its layout and theme choices in
    /// localStorage; a fresh store each time made it forget them on every
    /// Escape. Fixed so every opening finds the same store.
    static let storeID = UUID(uuidString: "3D6A1C52-7E0B-4D5F-9C11-52A1E4C0B7A1")!

    func makeCoordinator() -> Guard { Guard(app: url, onDismiss: onDismiss) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: Self.storeID)
        config.userContentController.add(context.coordinator, name: Guard.channel)
        if let token = AppPaneView.pipeToken(for: url) {
            // Before any of the page's scripts, in the top frame only, which
            // the navigation guard keeps on the app's own origin.
            let script = "window.__realmUiToken = \(AppPaneView.jsString(token));"
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let view = GlassWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        // The glass is dark, and Realm follows prefers-color-scheme until the
        // person picks a theme in its settings. Left to the system, a light
        // Mac drew a white app on the glass in the 2026-10-11 offscreen check.
        view.appearance = NSAppearance(named: .darkAqua)
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onDismiss = onDismiss
        // Only a new address reloads: a redraw of the card must not throw
        // away the session the person has open.
        guard context.coordinator.app != url else { return }
        context.coordinator.app = url
        view.load(URLRequest(url: url))
    }

    static func dismantleNSView(_ view: WKWebView, coordinator: Guard) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: Guard.channel)
    }

    @MainActor
    final class Guard: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let channel = "realmGlass"
        var app: URL
        var onDismiss: (@MainActor @Sendable () -> Void)?

        init(app: URL, onDismiss: (@MainActor @Sendable () -> Void)?) {
            self.app = app
            self.onDismiss = onDismiss
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async
            -> WKNavigationActionPolicy {
            // Frames inside the app (Realm's preview and MCP views on other
            // loopback ports) are its own business; only the top page is held.
            guard action.targetFrame?.isMainFrame ?? true else { return .allow }
            if AppPaneView.staysInApp(action.request.url, app: app) { return .allow }
            Self.openOutside(action.request.url)
            return .cancel
        }

        /// A `target=_blank` link: never a second web view, the person's browser.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            Self.openOutside(action.request.url)
            return nil
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            // Only the app's own top page may ask, and only for this.
            guard message.frameInfo.isMainFrame,
                  AppPaneView.staysInApp(message.frameInfo.request.url, app: app),
                  message.body as? String == "dismiss" else { return }
            onDismiss?()
        }

        /// In the background: nothing on the glass takes the screen.
        private static func openOutside(_ target: URL?) {
            guard let target = AppPaneView.outside(target) else { return }
            let config = NSWorkspace.OpenConfiguration()
            config.activates = false
            NSWorkspace.shared.open(target, configuration: config)
        }
    }
}

/// The surface's own close, for a part inside it that can end it (the app
/// pane's Escape). Nil outside a surface card.
struct HUDDismissKey: EnvironmentKey {
    static let defaultValue: (@MainActor @Sendable () -> Void)? = nil
}

extension EnvironmentValues {
    var hudDismiss: (@MainActor @Sendable () -> Void)? {
        get { self[HUDDismissKey.self] }
        set { self[HUDDismissKey.self] = newValue }
    }
}
