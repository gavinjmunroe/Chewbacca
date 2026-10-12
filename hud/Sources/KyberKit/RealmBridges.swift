import AppKit
import Foundation
import WebKit

/// What Realm's Electron shell gives its page and a web view can't, answered
/// by Kyber for the Realm page on the glass (AppPane.swift).
///
/// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm). In
/// his desktop app, main/index.ts answers `pick-files` with a system open
/// dialog, the preload's `pathForFile` reads a dropped file's path through
/// Electron's `webUtils`, links leave through `shell.openExternal`, and
/// notifications are Electron `Notification`s. On the glass the page is a
/// WKWebView with none of that, so before this a press on his composer's
/// attach did nothing, a file dropped on the page arrived with no path (the
/// morning rehearsal, 2026-10-11: "dropping a folder on his sheet does nothing
/// on the glass"), a link opened a browser behind the glass, and a turn that
/// settled while the glass was down said so to nobody.
///
/// The page side is bin/lib/realm_ui/bridge.js and glass/attach.ts; this is
/// the native half. Nothing here needs a permission Caleb has to grant: an
/// open panel is the person choosing files themselves, and a drop is too.
enum RealmBridges {
    /// The channel the page asks on and gets an answer back from.
    static let askChannel = "realmGlassAsk"

    /// What the page may ask. Anything else is ignored.
    enum Ask: Equatable {
        case pickFiles
        case notify(title: String, body: String)
    }

    /// The page's message, read as one of the asks, or nil.
    static func ask(from body: Any) -> Ask? {
        guard let dict = body as? [String: Any], let kind = dict["ask"] as? String else { return nil }
        switch kind {
        case "pickFiles":
            return .pickFiles
        case "notify":
            let title = clip(dict["title"] as? String ?? "")
            guard !title.isEmpty else { return nil }
            return .notify(title: title, body: clip(dict["body"] as? String ?? ""))
        default:
            return nil
        }
    }

    /// A notification line long enough to name the turn, short enough to be
    /// one line of a card. Guessed from Realm's own titles ("Claude finished
    /// in org-app", under 60 characters), never measured on the glass.
    static let maxText = 160

    private static func clip(_ text: String) -> String {
        let flat = text.split(whereSeparator: \.isNewline).joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        return flat.count > maxText ? String(flat.prefix(maxText - 1)) + "…" : flat
    }

    /// The surfaces this bridge draws. One of each, re-addressed on reuse, so
    /// a second link or notification replaces the first instead of stacking.
    static let webSurface = "realm-web"
    static let needsSurface = "realm-needs"

    /// A link from the Realm page, drawn as a Web pane on the glass. Only
    /// http and https (WebPaneView's own rule); nil means it isn't one.
    static func webLines(_ url: URL) -> [String]? {
        guard let page = WebPaneView.allowed(url.absoluteString) else { return nil }
        let s = webSurface
        return [
            "@ \(s) at=right w=560",
            "c \(s)-s Screen title=\(json(page.host ?? page.absoluteString))",
            "c \(s)-page Web url=\(json(page.absoluteString))",
            "> \(s)-s \(s)-page",
            "r \(s)-s",
        ]
    }

    /// How long a needs-you notice stays without a press. Guessed: a minute
    /// is long enough to look up from another app, and the agent's tile keeps
    /// saying it after the notice goes.
    static let needsLife = 60

    /// A Realm notification as a HUD needs-you notice: the title Realm wrote
    /// and its body, alert urgency, gone after `needsLife` seconds.
    static func needsLines(title: String, body: String) -> [String] {
        let s = needsSurface
        var lines = [
            "@ \(s) at=topRight w=360 urgency=alert life=\(needsLife)",
            "c \(s)-s Screen title=\(json("NEEDS YOU"))",
            "c \(s)-title Text value=\(json(title))",
        ]
        var children = ["\(s)-title"]
        if !body.isEmpty {
            lines.append("c \(s)-body Text value=\(json(body)) tone=\"muted\"")
            children.append("\(s)-body")
        }
        lines += ["> \(s)-s " + children.joined(separator: " "), "r \(s)-s"]
        return lines
    }

    /// The file paths a drag carries, in order. A drop with no file in it
    /// (text, a link) carries none.
    static func droppedPaths(_ board: NSPasteboard) -> [String] {
        let urls = board.readObjects(forClasses: [NSURL.self],
                                     options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        return urls.filter(\.isFileURL).map(\.path)
    }

    /// Script that hands the page a drop's paths before WebKit delivers the
    /// drop itself; bridge.js's `pathForFile` matches each dropped File to
    /// one by name, since a web view's File carries no path.
    static func dropScript(_ paths: [String]) -> String {
        let items = paths.map { path -> [String: Any] in
            let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)??.intValue
            return ["path": path, "name": (path as NSString).lastPathComponent, "size": size ?? -1]
        }
        let data = (try? JSONSerialization.data(withJSONObject: items)) ?? Data("[]".utf8)
        return "window.__realmGlassDrop = \(String(decoding: data, as: UTF8.self)); 0"
    }

    /// A string as one JSON value, for a line's prop.
    static func json(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text], options: [.withoutEscapingSlashes]))
            ?? Data("[\"\"]".utf8)
        return String(String(decoding: data, as: UTF8.self).dropFirst().dropLast())
    }

    /// The system open panel for his composer's attach: files only, several
    /// at once, the paths he chose. Empty when he cancels.
    @MainActor
    static func pickFiles() async -> [String] {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Attach"
        // Kyber is an agent app whose glass doesn't take key on its own; the
        // panel is what he pressed for, so it comes forward.
        NSApp.activate(ignoringOtherApps: true)
        let answer = await withCheckedContinuation { (done: CheckedContinuation<NSApplication.ModalResponse, Never>) in
            panel.begin { done.resume(returning: $0) }
        }
        return answer == .OK ? panel.urls.map(\.path) : []
    }
}

/// Where the bridges draw on the glass. Kyber's launch sets this to its own
/// model (main.swift); unset, a link goes to the browser in the background as
/// before and a notification is dropped.
@MainActor
public enum RealmGlassLines {
    static var draw: (([String]) -> Void)?
}

extension AppPaneGuard: WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        // Only the app's own top page may ask.
        guard message.frameInfo.isMainFrame,
              AppPaneView.staysInApp(message.frameInfo.request.url, app: app),
              let ask = RealmBridges.ask(from: message.body) else {
            replyHandler(nil, "not asked")
            return
        }
        switch ask {
        case .pickFiles:
            Task { @MainActor in replyHandler(await RealmBridges.pickFiles(), nil) }
        case .notify(let title, let body):
            // While the glass shows the page, its tiles already say it.
            guard !shown, let draw = RealmGlassLines.draw else {
                replyHandler(false, nil)
                return
            }
            draw(RealmBridges.needsLines(title: title, body: body))
            replyHandler(true, nil)
        }
    }
}
