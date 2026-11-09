import AppKit
import Foundation
import Testing

@testable import KyberKit

/// Editing a file from the glass without losing anybody's work
/// (bd_2026-Code-vz4): a file changed on disk is not overwritten silently,
/// the replaced version is kept, a close with unsaved edits asks first and
/// keeps the draft, and Command-Z reaches the editor.
@Suite("File safety")
@MainActor
struct FileSafetyTests {
    /// A scratch folder per test, and the drafts and backups of anything
    /// that does not pass a folder pointed into one, never at `~/.bob`.
    private static let root: URL = {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("kyber-file-safety-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        setenv("KYBER_FILE_SAFETY_DIR", url.path, 1)
        return url
    }()

    private func scratch() throws -> URL {
        let url = Self.root.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("a file changed on disk since it was read is not overwritten")
    func conflict() throws {
        let dir = try scratch()
        let file = dir.appendingPathComponent("notes.md")
        try "first".write(to: file, atomically: true, encoding: .utf8)
        let read = try #require(FileSafety.Stamp.current(file))
        try "someone else's edit".write(to: file, atomically: true, encoding: .utf8)

        let outcome = FileSafety.save(
            "mine", to: file, expecting: read, backups: dir.appendingPathComponent("b"))
        guard case .conflict(let current) = outcome else {
            Issue.record("expected a conflict, got \(outcome)")
            return
        }
        #expect(current == FileSafety.Stamp.current(file))
        #expect(try String(contentsOf: file, encoding: .utf8) == "someone else's edit")
    }

    @Test("a save keeps the version it replaces, and the next save checks the new one")
    func backup() throws {
        let dir = try scratch()
        let backups = dir.appendingPathComponent("b")
        let file = dir.appendingPathComponent("notes.md")
        try "first".write(to: file, atomically: true, encoding: .utf8)
        let read = FileSafety.Stamp.current(file)

        guard case .saved(let stamp, let kept?) = FileSafety.save(
            "second", to: file, expecting: read, backups: backups) else {
            Issue.record("expected a save with a backup")
            return
        }
        #expect(try String(contentsOf: file, encoding: .utf8) == "second")
        #expect(try String(contentsOf: kept, encoding: .utf8) == "first")
        #expect(kept.deletingLastPathComponent().path == backups.path)
        // Saving again against the stamp it was handed back works.
        guard case .saved = FileSafety.save("third", to: file, expecting: stamp, backups: backups) else {
            Issue.record("a second save against the returned stamp should go through")
            return
        }
    }

    @Test("overwriting on purpose still keeps what it replaced")
    func force() throws {
        let dir = try scratch()
        let backups = dir.appendingPathComponent("b")
        let file = dir.appendingPathComponent("a.txt")
        try "theirs".write(to: file, atomically: true, encoding: .utf8)
        guard case .saved(_, let kept?) = FileSafety.save(
            "mine", to: file, expecting: FileSafety.Stamp(data: Data("old".utf8)),
            force: true, backups: backups) else {
            Issue.record("a forced save should write")
            return
        }
        #expect(try String(contentsOf: file, encoding: .utf8) == "mine")
        #expect(try String(contentsOf: kept, encoding: .utf8) == "theirs")
    }

    @Test("a file that appeared since the editor opened on nothing is a conflict too")
    func appeared() throws {
        let dir = try scratch()
        let file = dir.appendingPathComponent("new.txt")
        guard case .saved(_, nil) = FileSafety.save(
            "x", to: file, expecting: nil, backups: dir) else {
            Issue.record("a new file should save with nothing to back up")
            return
        }
        let other = dir.appendingPathComponent("other.txt")
        try "y".write(to: other, atomically: true, encoding: .utf8)
        guard case .conflict = FileSafety.save("z", to: other, expecting: nil, backups: dir) else {
            Issue.record("a file that appeared underneath should be a conflict")
            return
        }
    }

    @Test("backups of one file stop at the kept count, newest kept")
    func pruning() throws {
        let dir = try scratch()
        let backups = dir.appendingPathComponent("b")
        let file = dir.appendingPathComponent("log.txt")
        try "0".write(to: file, atomically: true, encoding: .utf8)
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        for index in 1...(FileSafety.keptBackups + 3) {
            _ = FileSafety.save(
                "\(index)", to: file, expecting: FileSafety.Stamp.current(file),
                backups: backups, now: start.addingTimeInterval(Double(index)))
        }
        let kept = try FileManager.default.contentsOfDirectory(atPath: backups.path)
        #expect(kept.count == FileSafety.keptBackups)
        let newest = try #require(kept.sorted(by: >).first)
        #expect(try String(contentsOf: backups.appendingPathComponent(newest), encoding: .utf8)
            == "\(FileSafety.keptBackups + 2)")
    }

    @Test("rescued drafts round trip, one per path even when the names match")
    func drafts() throws {
        let dir = try scratch()
        FileSafety.rescue(draft: "a", of: "/x/notes.md", in: dir)
        FileSafety.rescue(draft: "b", of: "/y/notes.md", in: dir)
        #expect(FileSafety.rescued("/x/notes.md", in: dir) == "a")
        #expect(FileSafety.rescued("/y/notes.md", in: dir) == "b")
        FileSafety.forget("/x/notes.md", in: dir)
        #expect(FileSafety.rescued("/x/notes.md", in: dir) == nil)
        #expect(FileSafety.rescued("/y/notes.md", in: dir) == "b")
    }

    @Test("the store refuses a stale save and says so up the socket")
    func storeConflictEvent() throws {
        let dir = try scratch()
        let file = dir.appendingPathComponent("doc.txt")
        try "v1".write(to: file, atomically: true, encoding: .utf8)
        let read = FileSafety.Stamp.current(file)
        try "v2".write(to: file, atomically: true, encoding: .utf8)
        let store = SurfaceStore()
        var lines: [String] = []
        store.onEvent = { lines.append($0.line) }
        _ = store.saveFile(path: file.path, contents: "mine", expecting: read, backups: dir)
        #expect(lines.contains { $0.hasPrefix("e file.conflict File") })
        #expect(try String(contentsOf: file, encoding: .utf8) == "v2")
    }

    // MARK: closing with unsaved edits

    private func editing(_ path: String) throws -> OverlayModel {
        let model = OverlayModel()
        for line in ["@ doc at=right", "c s Screen title=\"DOC\"", "r s"] {
            model.apply(try #require(try LineParser.parse(line)))
        }
        let store = try #require(model.surfaces.first { $0.id == "doc" }?.store)
        store.markUnsaved(path: path, draft: "half-written")
        return model
    }

    @Test("the X asks first when there are unsaved edits, then keeps the draft")
    func closeAsks() throws {
        let path = Self.root.appendingPathComponent("close-asks.md").path
        let model = try editing(path)
        model.dismiss("doc")
        let surface = try #require(model.surfaces.first { $0.id == "doc" })
        #expect(surface.store.closeWarned)
        model.dismiss("doc")
        #expect(!model.surfaces.contains { $0.id == "doc" })
        #expect(FileSafety.rescued(path) == "half-written")
        FileSafety.forget(path)
    }

    @Test("a sender's `-` does not close a panel being typed in; it is told why")
    func socketCloseRefused() throws {
        let path = Self.root.appendingPathComponent("socket-close.md").path
        let model = try editing(path)
        var lines: [String] = []
        model.onEvent = { lines.append($0.line) }
        model.apply(.close(id: "doc"))
        #expect(model.surfaces.contains { $0.id == "doc" })
        #expect(lines.contains { $0.hasPrefix("! ") && $0.contains("unsaved edits") })
    }

    @Test("Escape still clears everything, and the draft is kept")
    func escapeRescues() throws {
        let path = Self.root.appendingPathComponent("escape.md").path
        let model = try editing(path)
        model.reset()
        #expect(model.surfaces.isEmpty)
        #expect(FileSafety.rescued(path) == "half-written")
        FileSafety.forget(path)
    }

    // MARK: the editing keys

    private func key(_ characters: String, _ flags: NSEvent.ModifierFlags) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0,
            windowNumber: 0, context: nil, characters: characters,
            charactersIgnoringModifiers: characters, isARepeat: false, keyCode: 0)!
    }

    @Test("Command-Z and Command-Shift-Z reach the editor's undo stack")
    func undo() throws {
        // Never ordered front: the window only gives the view an undo manager.
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
            styleMask: [.borderless], backing: .buffered, defer: true)
        let view = EditingTextView(frame: NSRect(x: 0, y: 0, width: 200, height: 100))
        view.allowsUndo = true
        window.contentView = view
        view.string = "base"
        view.setSelectedRange(NSRange(location: 4, length: 0))
        view.undoManager?.groupsByEvent = false
        view.undoManager?.beginUndoGrouping()
        view.insertText(" plus", replacementRange: view.selectedRange())
        view.undoManager?.endUndoGrouping()
        #expect(view.string == "base plus")

        #expect(EditingTextView.handleEditingKey(key("z", .command), in: view))
        #expect(view.string == "base")
        #expect(EditingTextView.handleEditingKey(key("z", [.command, .shift]), in: view))
        #expect(view.string == "base plus")
        // Not an editing key: left for everything else.
        #expect(!EditingTextView.handleEditingKey(key("s", .command), in: view))
        #expect(!EditingTextView.handleEditingKey(key("z", []), in: view))
    }
}
