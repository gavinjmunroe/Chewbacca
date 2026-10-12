import AppKit
import Foundation
import SwiftUI
import Testing

@testable import KyberKit

/// Realm's own interface on the glass (AppPane.swift): only this Mac's
/// loopback loads, links out go to the browser, and the pipe token comes from
/// the private state file, never from the page's own server.
@Suite("App pane")
struct AppPaneTests {
    @Test("only http on 127.0.0.1 or localhost with a port loads")
    func loopbackOnly() {
        #expect(AppPaneView.allowed(" http://127.0.0.1:47317/ ")?.port == 47317)
        #expect(AppPaneView.allowed("http://localhost:47317/")?.host == "localhost")
        for bad in ["", "https://127.0.0.1:47317/", "http://127.0.0.1/", "http://example.com:80/",
                    "http://127.0.0.1.evil.test:47317/", "file:///etc/passwd", "javascript:alert(1)"] {
            #expect(AppPaneView.allowed(bad) == nil, "\(bad) loaded")
        }
    }

    @Test("a navigation stays only on the app's own origin; links out go to the browser, web only")
    func navigation() {
        let app = URL(string: "http://127.0.0.1:47317/")!
        #expect(AppPaneView.staysInApp(URL(string: "http://127.0.0.1:47317/session/abc"), app: app))
        #expect(AppPaneView.staysInApp(URL(string: "about:blank"), app: app))
        #expect(!AppPaneView.staysInApp(URL(string: "http://127.0.0.1:5173/"), app: app))
        #expect(!AppPaneView.staysInApp(URL(string: "https://github.com/"), app: app))
        #expect(!AppPaneView.staysInApp(nil, app: app))
        #expect(AppPaneView.outside(URL(string: "https://github.com/31Carlton7/realm")) != nil)
        #expect(AppPaneView.outside(URL(string: "file:///Users")) == nil)
        #expect(AppPaneView.outside(URL(string: "vscode://open")) == nil)
    }

    @Test("the token is read from the state file only when it names the page's port")
    func token() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("apppane-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("server.json")
        try #"{"pid":1,"port":47317,"token":"abc_DEF-123"}"#.write(to: file, atomically: true, encoding: .utf8)
        #expect(AppPaneView.pipeToken(for: URL(string: "http://127.0.0.1:47317/")!, file: file) == "abc_DEF-123")
        #expect(AppPaneView.pipeToken(for: URL(string: "http://127.0.0.1:9999/")!, file: file) == nil)
        #expect(AppPaneView.pipeToken(for: URL(string: "http://127.0.0.1:47317/")!,
                                      file: dir.appendingPathComponent("missing.json")) == nil)
    }

    @Test("the token is written into the page as a quoted string, so nothing in it can run")
    func quoting() {
        #expect(AppPaneView.jsString("abc") == #""abc""#)
        #expect(AppPaneView.jsString(#"a";alert(1);//"#) == #""a\";alert(1);\/\/""#
            || AppPaneView.jsString(#"a";alert(1);//"#) == #""a\";alert(1);//""#)
    }

    @Test("the pane is never shorter than Realm's 600-point window minimum, nor over the ceiling")
    func height() {
        #expect(AppPaneView.resolvedHeight(nil, ceiling: 900) == 860)
        #expect(AppPaneView.resolvedHeight(300, ceiling: 900) == 600)
        #expect(AppPaneView.resolvedHeight(2000, ceiling: 900) == 860)
        #expect(AppPaneView.resolvedHeight(nil, ceiling: 500) == 600)
    }

    /// A state file naming the page's port with `token`, in its own folder.
    /// Port 9 (discard) has no server: these tests never reach a live Realm.
    static func stateFile(token: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("apppane-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("server.json")
        try #"{"pid":1,"port":9,"url":"http://127.0.0.1:9/","token":"TOKEN"}"#
            .replacingOccurrences(of: "TOKEN", with: token).write(to: file, atomically: true, encoding: .utf8)
        return file
    }

    @Test("closing and reopening the realm App shows the same page and never loads it again")
    @MainActor
    func reopenNeverReloads() throws {
        // Caleb, 2026-10-11: "It takes eternity to load". Each reopen made a
        // new web view and loaded Realm from nothing, 1.6 to 1.8 s every time.
        let file = try Self.stateFile(token: "t1")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let host = AppPaneHost()
        let url = URL(string: "http://127.0.0.1:9/")!
        let first = NSView(), second = NSView(), third = NSView()
        host.attach(url, to: first, onDismiss: nil, stateFile: file)
        let page = try #require(host.webView)
        #expect(page.superview === first)
        host.detach(from: first)
        #expect(page.superview == nil, "a closed surface must let go of the page")
        host.attach(url, to: second, onDismiss: nil, stateFile: file)
        // A reopen can attach before the old card is torn down.
        host.attach(url, to: third, onDismiss: nil, stateFile: file)
        host.detach(from: second)
        #expect(host.webView === page)
        #expect(page.superview === third)
        #expect(host.loads == 1, "the realm App reloaded on reopen")
    }

    @Test("the card itself, closed and opened again through SwiftUI, reuses the page")
    @MainActor
    func reopenThroughSwiftUI() throws {
        let file = try Self.stateFile(token: "t1")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        setenv("CHEWBACCA_REALM_UI_HOME", file.deletingLastPathComponent().path, 1)
        defer { unsetenv("CHEWBACCA_REALM_UI_HOME") }
        let host = AppPaneHost()
        func open() -> NSHostingView<AppPaneView> {
            let card = NSHostingView(rootView: AppPaneView(url: "http://127.0.0.1:9/", height: 600, host: host))
            card.frame = NSRect(x: 0, y: 0, width: 900, height: 600)
            card.layoutSubtreeIfNeeded()
            return card
        }
        var card: NSHostingView<AppPaneView>? = open()
        let page = try #require(host.webView)
        #expect(page.window == nil || page.superview != nil)
        card?.rootView = AppPaneView(url: "", height: 600, host: host)  // closed: nothing to draw
        card?.layoutSubtreeIfNeeded()
        card = nil
        #expect(page.superview == nil)
        let again = open()
        #expect(host.webView === page)
        #expect(page.superview != nil && page.isDescendant(of: again))
        #expect(host.loads == 1, "the realm App reloaded on reopen")
    }

    @Test("a server restart with a new pipe token, or a dead page, loads once more")
    @MainActor
    func reloadsOnlyWhenItMust() throws {
        let file = try Self.stateFile(token: "t1")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let host = AppPaneHost()
        let url = URL(string: "http://127.0.0.1:9/")!
        let box = NSView()
        host.attach(url, to: box, onDismiss: nil, stateFile: file)
        let first = try #require(host.webView)
        host.detach(from: box)
        let restarted = try Self.stateFile(token: "t2")
        defer { try? FileManager.default.removeItem(at: restarted.deletingLastPathComponent()) }
        host.attach(url, to: box, onDismiss: nil, stateFile: restarted)
        #expect(host.loads == 2)
        #expect(host.webView !== first && first.superview == nil)
    }

    @Test("launch warms the page from the state file, and only once")
    @MainActor
    func warm() throws {
        let file = try Self.stateFile(token: "t1")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        #expect(AppPaneView.servedURL(file: file)?.port == 9)
        let host = AppPaneHost()
        host.warmWhenReady(stateFile: file, tries: 1)
        #expect(host.loads == 1 && host.webView?.superview == nil)
        host.warmWhenReady(stateFile: file, tries: 1)
        host.attach(URL(string: "http://127.0.0.1:9/")!, to: NSView(), onDismiss: nil, stateFile: file)
        #expect(host.loads == 1, "the first open after a warm launch loaded the page again")
        let none = AppPaneHost()
        none.warmWhenReady(stateFile: file.deletingLastPathComponent().appendingPathComponent("missing.json"), tries: 1)
        #expect(none.webView == nil)
    }
}
