import AppKit
import Foundation
import Testing

@testable import KyberKit

/// What Kyber answers for the Realm page that Electron answered for it
/// (RealmBridges.swift): attach, drop, links and notifications.
@Suite("Realm bridges")
struct RealmBridgesTests {
    @Test("the page may ask for files or post a notification, and nothing else")
    func asks() {
        #expect(RealmBridges.ask(from: ["ask": "pickFiles"]) == .pickFiles)
        #expect(RealmBridges.ask(from: ["ask": "notify", "title": "Claude finished", "body": "in org-app"])
            == .notify(title: "Claude finished", body: "in org-app"))
        for bad: Any in ["pickFiles", ["ask": "openFile", "path": "/etc/passwd"], ["ask": "notify"],
                         ["ask": "notify", "title": "  "], ["nope": 1], 42] {
            #expect(RealmBridges.ask(from: bad) == nil, "\(bad) was taken as an ask")
        }
    }

    @Test("a notification is one line each, clipped, never a wall")
    func clipped() {
        let long = String(repeating: "word ", count: 200)
        guard case .notify(let title, let body) = RealmBridges.ask(from: ["ask": "notify", "title": "a\nb", "body": long]) else {
            Issue.record("not a notify")
            return
        }
        #expect(title == "a b")
        #expect(body.count == RealmBridges.maxText)
    }

    @Test("a link opens as a Web pane on the glass, web only")
    func links() throws {
        let lines = try #require(RealmBridges.webLines(URL(string: "https://github.com/31Carlton7/realm")!))
        #expect(lines.first == "@ realm-web at=right w=560")
        #expect(lines.contains(#"c realm-web-page Web url="https://github.com/31Carlton7/realm""#))
        for line in lines { #expect((try? LineParser.parse(line)) != nil, "\(line) doesn't parse") }
        #expect(RealmBridges.webLines(URL(string: "file:///etc/passwd")!) == nil)
        #expect(RealmBridges.webLines(URL(string: "vscode://open")!) == nil)
    }

    @Test("a notification is a needs-you notice that goes by itself")
    func needs() {
        let lines = RealmBridges.needsLines(title: "Allow Bash?", body: "settings-app")
        #expect(lines.first == "@ realm-needs at=topRight w=360 urgency=alert life=\(RealmBridges.needsLife)")
        #expect(lines.contains(#"c realm-needs-title Text value="Allow Bash?""#))
        for line in lines { #expect((try? LineParser.parse(line)) != nil, "\(line) doesn't parse") }
        #expect(!RealmBridges.needsLines(title: "Done", body: "").contains { $0.contains("realm-needs-body") })
    }

    @Test("a drop's paths reach the page as data, never as script")
    func drop() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("bridges-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent(#"a"b<script>.txt"#)
        try "hello".write(to: file, atomically: true, encoding: .utf8)
        let board = NSPasteboard(name: NSPasteboard.Name("bridges-\(UUID().uuidString)"))
        board.clearContents()
        board.writeObjects([file as NSURL])
        let paths = RealmBridges.droppedPaths(board)
        #expect(paths == [file.path])
        let script = RealmBridges.dropScript(paths)
        #expect(script.hasPrefix("window.__realmGlassDrop = ["))
        let json = String(script.dropFirst("window.__realmGlassDrop = ".count).dropLast(3))
        let items = try #require(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]])
        #expect(items.first?["path"] as? String == file.path)
        #expect(items.first?["size"] as? Int == 5)
    }
}
