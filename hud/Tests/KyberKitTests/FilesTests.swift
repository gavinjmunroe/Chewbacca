import AppKit
import Foundation
import SwiftUI
import Testing

@testable import KyberKit

/// Files on the glass (CHW-198): a folder's newest few things as a surface,
/// and every way it leaves. Runs against throwaway temp folders only, and
/// swaps out the effect so nothing here opens Finder or Preview.
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

    /// Writes `name` with a modification time `age` seconds ago, so the
    /// newest-first order is fixed rather than racing the clock.
    @discardableResult
    private func touch(_ name: String, in folder: URL, age: TimeInterval, folderItem: Bool = false) throws -> URL {
        let url = folder.appendingPathComponent(name)
        if folderItem {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        } else {
            try Data("x".utf8).write(to: url)
        }
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-age)], ofItemAtPath: url.path)
        return url
    }

    /// A model with the folder on it and every effect recorded, not done.
    private func glass(_ path: String) -> (OverlayModel, Box) {
        let model = OverlayModel()
        let box = Box()
        model.filesEffect = { box.effects.append($0) }
        model.onEvent = { box.events.append($0.line) }
        model.apply(.openFiles(path: path))
        return (model, box)
    }

    final class Box {
        var effects: [FilesGlass.Effect] = []
        var events: [String] = []
    }

    /// A listing hands back `/private/var/...` where the fixture says
    /// `/var/...`: the same file, so compare what the links resolve to.
    private func real(_ url: URL?) -> String? { url?.resolvingSymlinksInPath().path }

    private func real(_ effect: FilesGlass.Effect) -> String {
        switch effect {
        case .none: return "none"
        case .openDocument(let url): return "open " + (real(url) ?? "")
        case .reveal(let url): return "reveal " + (real(url) ?? "")
        }
    }

    private func store(_ model: OverlayModel) throws -> SurfaceStore {
        try #require(model.surfaces.first { $0.id == FilesGlass.id }).store
    }

    private func names(_ model: OverlayModel) throws -> [String] {
        let rows = Pointer.get(try store(model).spec.data, "/disk/rows")?.arrayValue ?? []
        return rows.compactMap { $0.objectValue?["id"]?.stringValue }
    }

    // MARK: The verb

    @Test("`files` opens, takes one path, and `files off` closes")
    func verb() throws {
        #expect(try LineParser.parse("files") == .openFiles(path: nil))
        #expect(try LineParser.parse("files off") == .closeFiles)
        #expect(try LineParser.parse("files ~/Downloads") == .openFiles(path: "~/Downloads"))
        #expect(try LineParser.parse(#"files "/Volumes/My Disk""#) == .openFiles(path: "/Volumes/My Disk"))
        #expect(throws: LineParseError.self) { try LineParser.parse("files /a /b") }
    }

    // MARK: What it lists

    @Test("Newest first, at most seven, hidden and half-downloaded files left out")
    func listing() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        for i in 0..<9 { try touch("file-\(i).txt", in: root, age: TimeInterval(100 * i)) }
        try touch(".secret", in: root, age: 0)
        try touch("movie.mp4.crdownload", in: root, age: 0)
        let state = FilesGlass(path: root.path)
        #expect(state.rows.map(\.name) == (0..<7).map { "file-\($0).txt" })
        #expect(state.note == FileFormat.display(root))
    }

    @Test("An empty or unreadable folder says so instead of drawing nothing")
    func emptyAndMissing() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(FilesGlass(path: root.path).note == "\(root.lastPathComponent) is empty.")
        let gone = FilesGlass(path: root.appendingPathComponent("nope").path)
        #expect(gone.rows.isEmpty)
        #expect(gone.note.hasPrefix("Can't read nope"))
    }

    @Test("No path is Downloads; a file opens its folder with it previewed")
    func paths() throws {
        let home = try scratch()
        defer { try? FileManager.default.removeItem(at: home) }
        let downloads = home.appendingPathComponent("Downloads")
        try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
        let pdf = try touch("resume.pdf", in: downloads, age: 10)
        #expect(FilesGlass(path: nil, home: home).folder.path == downloads.path)
        #expect(FilesGlass(path: "Downloads", home: home).folder.path == downloads.path)
        let onFile = FilesGlass(path: pdf.path, home: home)
        #expect(onFile.folder.path == downloads.path)
        #expect(real(onFile.previewed) == real(pdf))
    }

    // MARK: Pressing a row

    @Test("Look steps into a folder, Up comes back and stops at the folder asked for")
    func folders() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let inner = try touch("School", in: root, age: 5, folderItem: true)
        try touch("lab.pdf", in: inner, age: 5)
        var state = FilesGlass(path: root.path)
        #expect(state.look(FilesGlass.up) == .none)
        #expect(state.folder.path == root.path)
        #expect(state.look("School") == .none)
        #expect(state.folder.path == inner.path)
        #expect(state.rows.map(\.name) == ["lab.pdf"])
        #expect(state.lines().contains { $0.contains(#""id":"..""#) })
        #expect(state.look(FilesGlass.up) == .none)
        #expect(state.folder.path == root.path)
        #expect(!state.lines().contains { $0.contains(#""id":"..""#) })
    }

    @Test("A document previews in place; anything else is only shown in Finder")
    func documents() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let pdf = try touch("invoice.pdf", in: root, age: 1)
        let app = try touch("Setup.command", in: root, age: 2)
        var state = FilesGlass(path: root.path)
        #expect(state.look("invoice.pdf") == .none)
        #expect(real(state.previewed) == real(pdf))
        #expect(real(state.go()) == real(.openDocument(pdf)))
        #expect(real(state.look("Setup.command")) == real(.reveal(app)))
        #expect(state.status.contains("shown in Finder"))
        #expect(state.look("not-there.pdf") == .none)
        #expect(state.status == "That isn't on the list any more.")
    }

    @Test("A link dressed as a document is never opened")
    func symlink() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let target = try touch("Run.command", in: root, age: 3)
        let link = root.appendingPathComponent("cv.pdf")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        var state = FilesGlass(path: root.path)
        // The link itself is revealed, never what it points at.
        guard case .reveal(let shown) = state.look("cv.pdf") else {
            Issue.record("a link was not just revealed")
            return
        }
        #expect(shown.lastPathComponent == "cv.pdf")
        #expect(state.previewed == nil)
        #expect(real(state.go()) == real(.reveal(root)))
    }

    // MARK: On the glass

    @Test("`files <path>` draws a surface every line of which parses")
    func draws() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        try touch("a.pdf", in: root, age: 1)
        try touch("b.txt", in: root, age: 2)
        for line in FilesGlass(path: root.path).lines() {
            #expect(throws: Never.self) { try LineParser.parse(line) }
        }
        let (model, _) = glass(root.path)
        #expect(try names(model) == ["a.pdf", "b.txt"])
        #expect(try store(model).isReady)
        // Drawing it does not steal `current` from whoever was streaming: a
        // bare `c` afterwards still lands on the main surface, not in here.
        model.apply(try #require(try LineParser.parse(#"c late Text value="hi""#)))
        #expect(try store(model).spec.elements["late"] == nil)
        #expect(model.surfaces.contains { $0.id == "main" })
    }

    @Test("A press is answered here, never sent up the socket as someone else's")
    func pressIsLocal() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let pdf = try touch("a.pdf", in: root, age: 1)
        try touch("Tool.command", in: root, age: 2)
        let (model, box) = glass(root.path)
        let store = try store(model)
        store.fireRow(FilesGlass.lookAction, row: "a.pdf")
        #expect(real(Pointer.get(store.spec.data, "/disk/path")?.stringValue.map(URL.init(fileURLWithPath:))) == real(pdf))
        #expect(Pointer.get(store.spec.data, "/disk/go")?.stringValue == "Open")
        store.fire(FilesGlass.goAction, from: "disk-go")
        store.fireRow(FilesGlass.lookAction, row: "Tool.command")
        #expect(box.effects.map(real) == [
            "none", real(.openDocument(pdf)), real(.reveal(root.appendingPathComponent("Tool.command"))),
        ])
        #expect(!box.events.contains { $0.contains("disk-look") || $0.contains("disk-go") })
    }

    @Test("`files off` takes it down and tells the listeners")
    func off() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let (model, box) = glass(root.path)
        #expect(model.files != nil)
        model.apply(try #require(try LineParser.parse("files off")))
        #expect(!model.surfaces.contains { $0.id == FilesGlass.id })
        #expect(model.files == nil)
        #expect(box.events.contains { $0.hasPrefix("e closed disk") })
        // Off with nothing up is a no-op, not an error.
        model.apply(.closeFiles)
    }

    @Test("Escape clears it: the reset Escape runs takes the folder with it")
    func escape() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let (model, _) = glass(root.path)
        // main.swift's escape() -> dismissAll() -> model.reset().
        model.reset()
        #expect(model.surfaces.isEmpty)
        #expect(model.files == nil)
    }

    @Test("A click off the card takes it down; a click on it does not")
    func clickAway() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let (model, box) = glass(root.path)
        let surface = try #require(model.surfaces.first { $0.id == FilesGlass.id })
        let card = model.frame(of: surface)
        model.clickedAway(at: CGPoint(x: card.midX, y: card.midY))
        #expect(model.files != nil)
        model.clickedAway(at: CGPoint(x: card.maxX + 200, y: card.maxY + 200))
        #expect(model.files == nil)
        #expect(!model.surfaces.contains { $0.id == FilesGlass.id })
        #expect(box.events.contains { $0.hasPrefix("e closed disk") })
    }

    @Test("`- disk` and the X close it like any surface")
    func closeLikeAnySurface() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let (model, _) = glass(root.path)
        model.apply(try #require(try LineParser.parse("- disk")))
        #expect(model.files == nil)
        let (again, _) = glass(root.path)
        again.dismiss(FilesGlass.id)
        #expect(again.files == nil)
    }

    // MARK: Render

    /// Draws the surface offscreen and proves it drew. Set `HUD_SNAPSHOT_DIR`
    /// to keep the image.
    @Test("The surface renders its rows over the glass")
    func render() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        for (i, name) in ["invoice-october.pdf", "hud-demo.mov", "lab-2-prelab.docx", "notes.txt"].enumerated() {
            try touch(name, in: root, age: TimeInterval(600 * i))
        }
        try touch("Screenshots", in: root, age: 4_000, folderItem: true)
        let (model, _) = glass(root.path)
        let store = try store(model)
        store.fireRow(FilesGlass.lookAction, row: "notes.txt")
        let view = ZStack {
            Color(red: 0.16, green: 0.20, blue: 0.34)
            SurfaceView(store: store).frame(width: 420)
        }
        .frame(width: 480, height: 560)
        .environment(\.hudOffscreen, true)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try #require(renderer.cgImage)
        #expect(image.width == 960)
        if let dir = ProcessInfo.processInfo.environment["HUD_SNAPSHOT_DIR"],
           let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
            try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("files-glass.png"))
        }
    }
}
