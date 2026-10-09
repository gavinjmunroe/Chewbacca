import AppKit
import Foundation
import SwiftUI
import Testing

@testable import KyberKit

/// The file manager: the pane state machine, and the operations that write,
/// against throwaway temp folders only. Nothing here touches a real folder
/// except the Trash test, which removes what it put there.
@Suite("Files")
@MainActor
struct FilesTests {
    // MARK: Fixtures

    /// A fresh folder under the system temp directory, removed by the caller.
    private func scratch() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("kyber-files-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url.resolvingSymlinksInPath()
    }

    private func write(_ text: String, to url: URL) throws {
        try Data(text.utf8).write(to: url)
    }

    private func read(_ url: URL) throws -> String {
        String(decoding: try Data(contentsOf: url), as: UTF8.self)
    }

    private func items(_ names: [String]) -> [FileItem] {
        names.map {
            FileItem(url: URL(fileURLWithPath: "/tmp/x/\($0)"), name: $0, isDirectory: $0.hasSuffix("/"))
        }
    }

    // MARK: State machine

    @Test("Tab toggles the active pane and back")
    func tabToggles() {
        var state = FileManagerState(left: URL(fileURLWithPath: "/"), right: URL(fileURLWithPath: "/tmp"))
        #expect(state.active == .left)
        state.toggle()
        #expect(state.active == .right)
        #expect(state.inactivePane.directory.path == "/")
        state.toggle()
        #expect(state.active == .left)
    }

    @Test("Selection clamps at both ends and never wraps")
    func selectionBounds() {
        var pane = PaneState(directory: URL(fileURLWithPath: "/tmp"), items: items(["a", "b", "c"]))
        #expect(pane.selected == 0)
        pane.move(by: -1)
        #expect(pane.selected == 0)
        pane.move(by: 2)
        #expect(pane.selected == 2)
        pane.move(by: 1)
        #expect(pane.selected == 2)
        pane.move(by: 1_000)
        #expect(pane.selected == 2)
        pane.select(-5)
        #expect(pane.selected == 0)

        var empty = PaneState(directory: URL(fileURLWithPath: "/tmp"))
        empty.move(by: 1)
        #expect(empty.selected == 0)
        #expect(empty.selection == nil)

        // Shrinking the list pulls the pick back inside it.
        pane.select(2)
        pane.replace(items: items(["only"]))
        #expect(pane.selected == 0)
        #expect(pane.selection?.name == "only")
    }

    @Test("Up/Down move only the active pane")
    func selectionIsPerPane() {
        var state = FileManagerState(left: URL(fileURLWithPath: "/a"), right: URL(fileURLWithPath: "/b"))
        state.left.replace(items: items(["1", "2", "3"]))
        state.right.replace(items: items(["x", "y"]))
        state.moveSelection(by: 1)
        #expect(state.left.selected == 1)
        #expect(state.right.selected == 0)
        state.toggle()
        state.moveSelection(by: 5)
        #expect(state.right.selected == 1)
        #expect(state.left.selected == 1)
    }

    @Test("Backspace at / stays at /, and from a folder goes up one")
    func parentNavigation() {
        var state = FileManagerState(left: URL(fileURLWithPath: "/"), right: URL(fileURLWithPath: "/tmp"))
        #expect(state.left.parent == nil)
        #expect(state.goToParent() == nil)
        #expect(state.left.directory.path == "/")

        state.navigate(to: URL(fileURLWithPath: "/Users/someone/Documents"))
        let left = state.goToParent()
        #expect(left?.path == "/Users/someone/Documents")
        #expect(state.left.directory.path == "/Users/someone")
        state.goToParent()
        state.goToParent()
        #expect(state.left.directory.path == "/")
        #expect(state.goToParent() == nil)
    }

    @Test("Going up picks the folder you came out of")
    func parentReselects() {
        var pane = PaneState(directory: URL(fileURLWithPath: "/tmp/x"))
        pane.replace(items: items(["a", "b", "came-from", "z"]), prefer: URL(fileURLWithPath: "/tmp/x/came-from"))
        #expect(pane.selection?.name == "came-from")
        // A reload keeps the pick by URL even when rows are added above it.
        pane.replace(items: items(["0", "a", "b", "came-from", "z"]))
        #expect(pane.selection?.name == "came-from")
    }

    @Test("Enter navigates a folder and opens a file")
    func activation() {
        var state = FileManagerState(left: URL(fileURLWithPath: "/tmp/x"), right: URL(fileURLWithPath: "/"))
        state.left.replace(items: items(["dir/", "file.txt"]))
        #expect(state.activation() == .navigate(URL(fileURLWithPath: "/tmp/x/dir/")))
        state.moveSelection(by: 1)
        #expect(state.activation() == .open(URL(fileURLWithPath: "/tmp/x/file.txt")))
        state.left.replace(items: [])
        #expect(state.activation() == nil)
    }

    @Test("The controller's keys drive the same machine, and refuse past /")
    func controllerKeys() {
        let controller = FilesController(
            left: URL(fileURLWithPath: "/"), right: URL(fileURLWithPath: "/tmp"), autoload: false)
        #expect(controller.handle(.tab))
        #expect(controller.state.active == .right)
        #expect(controller.pathText == "/tmp")
        controller.handle(.tab)
        controller.handle(.back)
        #expect(controller.state.left.directory.path == "/")
        #expect(controller.status?.text == "Already at the top of the disk.")
        #expect(!controller.handle(.other))
        controller.handle(.function(7))
        #expect(controller.newFolderName == "New Folder")
        controller.handle(.escape)
        #expect(controller.newFolderName == nil)
    }

    @Test("A folder that can't be read keeps the old rows and says why")
    func failedReadKeepsRows() {
        let controller = FilesController(
            left: URL(fileURLWithPath: "/tmp/x"), right: URL(fileURLWithPath: "/"), autoload: false)
        controller.apply(.success(items(["keep.txt"])), to: .left)
        controller.state.navigate(to: URL(fileURLWithPath: "/tmp/x/locked"))
        let denied = NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)
        controller.apply(.failure(denied), to: .left, revertTo: URL(fileURLWithPath: "/tmp/x"))
        #expect(controller.state.left.directory.path == "/tmp/x")
        #expect(controller.state.left.items.map(\.name) == ["keep.txt"])
        #expect(controller.status?.tone == .bad)
        #expect(controller.status?.text.contains("Can't read locked") == true)
    }

    // MARK: Listing

    @Test("A listing puts folders first, sorts names like Finder, skips hidden")
    func listing() throws {
        let dir = try scratch()
        defer { try? FileManager.default.removeItem(at: dir) }
        try write("x", to: dir.appendingPathComponent("file 10.txt"))
        try write("x", to: dir.appendingPathComponent("file 2.txt"))
        try write("x", to: dir.appendingPathComponent(".secret"))
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("zeta"), withIntermediateDirectories: false)

        let rows = try DirectoryLoader.list(dir, icons: false)
        #expect(rows.map(\.name) == ["zeta", "file 2.txt", "file 10.txt"])
        #expect(rows[0].isDirectory && rows[0].size == nil)
        #expect(rows[1].size == 1)
        #expect(rows[1].modified != nil)
        #expect(try DirectoryLoader.list(dir, showHidden: true, icons: false).contains { $0.name == ".secret" })
    }

    // MARK: Writing

    @Test("Copy into a folder that already has the name keeps both")
    func copyConflictRenames() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let a = root.appendingPathComponent("a"), b = root.appendingPathComponent("b")
        try FileManager.default.createDirectory(at: a, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: b, withIntermediateDirectories: false)
        try write("new", to: a.appendingPathComponent("report.pdf"))
        try write("old", to: b.appendingPathComponent("report.pdf"))

        let first = try FileOps.copy(a.appendingPathComponent("report.pdf"), into: b)
        #expect(first.lastPathComponent == "report 2.pdf")
        #expect(try read(b.appendingPathComponent("report.pdf")) == "old")
        #expect(try read(first) == "new")
        #expect(try read(a.appendingPathComponent("report.pdf")) == "new")

        let second = try FileOps.copy(a.appendingPathComponent("report.pdf"), into: b)
        #expect(second.lastPathComponent == "report 3.pdf")

        // No clash, no rename.
        try write("n", to: a.appendingPathComponent("notes"))
        #expect(try FileOps.copy(a.appendingPathComponent("notes"), into: b).lastPathComponent == "notes")
    }

    @Test("Move renames on a clash, removes the source, refuses a no-op")
    func moveConflict() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let a = root.appendingPathComponent("a"), b = root.appendingPathComponent("b")
        try FileManager.default.createDirectory(at: a, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: b, withIntermediateDirectories: false)
        try write("mine", to: a.appendingPathComponent("x"))
        try write("theirs", to: b.appendingPathComponent("x"))

        let landed = try FileOps.move(a.appendingPathComponent("x"), into: b)
        #expect(landed.lastPathComponent == "x 2")
        #expect(!FileManager.default.fileExists(atPath: a.appendingPathComponent("x").path))
        #expect(try read(b.appendingPathComponent("x")) == "theirs")
        #expect(try read(landed) == "mine")

        #expect(throws: FileOps.Failure.sameFolder("x")) {
            try FileOps.move(b.appendingPathComponent("x"), into: b)
        }
        #expect(throws: FileOps.Failure.missing("gone")) {
            try FileOps.copy(a.appendingPathComponent("gone"), into: b)
        }
    }

    @Test("A folder can't be copied or moved into itself")
    func intoItself() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let a = root.appendingPathComponent("a")
        let inner = a.appendingPathComponent("inner")
        try FileManager.default.createDirectory(at: inner, withIntermediateDirectories: true)
        #expect(throws: FileOps.Failure.intoItself("a")) { try FileOps.copy(a, into: a) }
        #expect(throws: FileOps.Failure.intoItself("a")) { try FileOps.move(a, into: inner) }
        // A sibling whose name starts the same is not inside it.
        let sibling = root.appendingPathComponent("ab")
        try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: false)
        #expect(try FileOps.copy(a, into: sibling).lastPathComponent == "a")
    }

    @Test("Delete goes to the Trash, never removes in place")
    func trash() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("trash-me-\(UUID().uuidString).txt")
        try write("bye", to: file)
        let landed = try FileOps.trash(file)
        #expect(!FileManager.default.fileExists(atPath: file.path))
        let inTrash = try #require(landed)
        #expect(inTrash.pathComponents.contains(".Trash") || inTrash.path.contains("Trash"))
        #expect(try read(inTrash) == "bye")
        // Only what this test put in the Trash comes back out of it.
        try FileManager.default.removeItem(at: inTrash)

        #expect(throws: FileOps.Failure.missing(file.lastPathComponent)) { try FileOps.trash(file) }
    }

    @Test("New folders get the next free name and refuse a path")
    func newFolder() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(try FileOps.newFolder(named: "New Folder", in: root).lastPathComponent == "New Folder")
        #expect(try FileOps.newFolder(named: "New Folder", in: root).lastPathComponent == "New Folder 2")
        #expect(throws: FileOps.Failure.invalidName("../up")) { try FileOps.newFolder(named: "../up", in: root) }
        #expect(throws: FileOps.Failure.invalidName("  ")) { try FileOps.newFolder(named: "  ", in: root) }
    }

    // MARK: The verb and the formats

    @Test("`files` opens, takes one path, and `files off` closes")
    func verb() throws {
        #expect(try LineParser.parse("files") == .openFiles(path: nil))
        #expect(try LineParser.parse("files off") == .closeFiles)
        #expect(try LineParser.parse("files ~/Downloads") == .openFiles(path: "~/Downloads"))
        #expect(try LineParser.parse(#"files "/Volumes/My Disk""#) == .openFiles(path: "/Volumes/My Disk"))
        #expect(throws: LineParseError.self) { try LineParser.parse("files /a /b") }
    }

    @Test("Paths print with ~ and resolve what was typed")
    func paths() {
        #expect(FileFormat.display(URL(fileURLWithPath: "/Users/me/Downloads"), home: "/Users/me") == "~/Downloads")
        #expect(FileFormat.display(URL(fileURLWithPath: "/Users/me"), home: "/Users/me") == "~")
        #expect(FileFormat.display(URL(fileURLWithPath: "/Users/mel"), home: "/Users/me") == "/Users/mel")
        let base = URL(fileURLWithPath: "/tmp/x")
        #expect(FileFormat.resolve("sub", relativeTo: base).path == "/tmp/x/sub")
        #expect(FileFormat.resolve("/etc", relativeTo: base).path == "/etc")
        #expect(FileFormat.resolve("..", relativeTo: base).path == "/tmp")
        #expect(FileFormat.resolve("~", relativeTo: base).path == NSHomeDirectory())
        #expect(FileFormat.size(nil) == "")
        #expect(FileFormat.size(2_048).isEmpty == false)
    }

    // MARK: Render

    /// Draws the panel offscreen and proves it drew. Set `FILES_SHOT` to a
    /// .png path to keep the image.
    @Test("The panel renders both panes, the path and the key bar")
    func render() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let left = root.appendingPathComponent("Projects")
        let right = root.appendingPathComponent("Downloads")
        for dir in ["kyber", "amber-site", "bisc-101", "spiderverse"] {
            try FileManager.default.createDirectory(
                at: left.appendingPathComponent(dir), withIntermediateDirectories: true)
        }
        try write(String(repeating: "#", count: 3_200), to: left.appendingPathComponent("README.md"))
        try write(String(repeating: "x", count: 48_000), to: left.appendingPathComponent("roadmap.pdf"))
        try FileManager.default.createDirectory(at: right.appendingPathComponent("Screenshots"), withIntermediateDirectories: true)
        for (name, size) in [("invoice-october.pdf", 182_000), ("hud-demo.mov", 24_600_000),
                             ("lab-2-prelab.docx", 41_000), ("photo.heic", 2_300_000), ("notes.txt", 900)] {
            try write(String(repeating: "x", count: min(size, 200_000)), to: right.appendingPathComponent(name))
        }

        let controller = FilesController(left: left, right: right, autoload: false)
        controller.apply(.success(try DirectoryLoader.list(left)), to: .left)
        controller.apply(.success(try DirectoryLoader.list(right)), to: .right)
        controller.handle(.down)
        controller.handle(.tab)
        controller.handle(.down)
        controller.handle(.down)
        controller.say("Copied roadmap.pdf to Downloads.", .good)
        // The fixture lives in a temp folder; show the path a person would see.
        controller.pathText = "~/Downloads"

        let size = CGSize(width: 1180, height: 720)
        let scene = ZStack {
            LinearGradient(
                colors: [Color(red: 0.16, green: 0.20, blue: 0.34), Color(red: 0.42, green: 0.24, blue: 0.40),
                         Color(red: 0.93, green: 0.58, blue: 0.42)],
                startPoint: .topLeading, endPoint: .bottomTrailing)
            FilesView(controller: controller)
                .frame(width: FilesPanel.size.width, height: FilesPanel.size.height)
        }
        .frame(width: size.width, height: size.height)
        .environment(\.hudOffscreen, true)

        let renderer = ImageRenderer(content: scene)
        renderer.scale = 2
        let image = try #require(renderer.cgImage)
        #expect(image.width == Int(size.width * 2))

        if let path = ProcessInfo.processInfo.environment["FILES_SHOT"] {
            let rep = NSBitmapImageRep(cgImage: image)
            let png = try #require(rep.representation(using: .png, properties: [:]))
            try png.write(to: URL(fileURLWithPath: path))
        }
    }
}
