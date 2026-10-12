import Foundation
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
}
