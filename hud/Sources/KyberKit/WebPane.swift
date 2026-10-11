import SwiftUI
import WebKit

/// A live web page inside a card: an agent's browser pane on the glass.
///
/// Realm's own browser pane is an Electron `WebContentsView` driven from the
/// desktop app's main process; the headless engine Kyber runs keeps only the
/// pane's row (its address and title, `browsers.get`). This draws that
/// address as a real page, scrollable and clickable, inside the card that
/// asked for it, never as a window of its own.
///
/// The address comes from the engine, which an agent can steer, so it is
/// untrusted: only http and https load, every navigation after the first is
/// held to the same rule, and the page gets a fresh non-persistent data store,
/// so it never sees a cookie, a login or storage from anything else on the Mac.
struct WebPaneView: View {
    let url: String

    /// The pane's height in a 460-point card. Guessed, never measured on the
    /// glass: tall enough to read a page's first screen, short enough to
    /// leave the card's conversation above it in view.
    static let height: CGFloat = 300

    var body: some View {
        if let page = Self.allowed(url) {
            WebPane(url: page)
                .frame(height: Self.height)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                .accessibilityLabel("Web page, \(page.host ?? "")")
        }
    }

    /// The address as a URL the pane may load: http or https with a host,
    /// nothing else (no file, javascript, data or custom schemes).
    static func allowed(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let page = URL(string: trimmed), let scheme = page.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = page.host, !host.isEmpty else { return nil }
        return page
    }

    /// Whether a navigation inside the page may go ahead. A blank frame is
    /// how pages start; anything but the web is refused.
    static func mayNavigate(to url: URL?) -> Bool {
        guard let url else { return false }
        if url.absoluteString == "about:blank" { return true }
        return allowed(url.absoluteString) != nil
    }
}

private struct WebPane: NSViewRepresentable {
    let url: URL

    func makeCoordinator() -> Guard { Guard() }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        context.coordinator.loaded = url
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        // Only a new address reloads: a redraw of the card must not throw
        // away where the person scrolled to.
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        view.load(URLRequest(url: url))
    }

    @MainActor
    final class Guard: NSObject, WKNavigationDelegate {
        var loaded: URL?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async
            -> WKNavigationActionPolicy {
            WebPaneView.mayNavigate(to: navigationAction.request.url) ? .allow : .cancel
        }
    }
}
