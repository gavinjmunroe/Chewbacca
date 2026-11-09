import Foundation
import Testing

@testable import KyberKit

/// The agent card's IDE pieces that live in Swift: Keep and Reject on each
/// hunk of a Diff (bin/lib/surfaces/agent_hunks.py), and the File editor's
/// tabs keeping each file's draft and version check (agent_ide.py).
@Suite("Agent card IDE")
@MainActor
struct IdeTests {
    @Test("each @@ line is numbered over the whole text, so a cut top keeps the words on their hunk")
    func hunkOrdinals() {
        let filler = (0..<DiffView.maxLines).map { " ctx \($0)" }
        let text = (["@@ -1,1 +1,1 @@ first", "-a", "+b"] + filler + ["@@ -900,1 +900,1 @@ second", "-c", "+d"])
            .joined(separator: "\n")
        let lines = DiffView.lines(text, path: "x.py")
        let numbered = lines.compactMap(\.hunk)
        // The first hunk's line was cut; the one drawn is the second, and
        // it is numbered 1, not 0.
        #expect(numbered == [1])
        #expect(lines.first { $0.hunk == 1 }?.kind == .hunk)
    }

    @Test("hunk verbs parse with their ids, and a row with no id is dropped")
    func hunkVerbsParse() throws {
        let items = try #require(JSONDecoding.parse(#"[{"id":"2:0:ab","keep":"Keep","reject":"Reject","where":"lines 1-6"},{"keep":"Keep"}]"#)?.arrayValue)
        let verbs = DiffView.HunkVerbs.parse(items)
        #expect(verbs == [DiffView.HunkVerbs(id: "2:0:ab", keep: "Keep", reject: "Reject", place: "lines 1-6")])
    }

    @Test("a plain diff (terminal output) numbers no hunks")
    func plainHasNoHunks() {
        #expect(DiffView.lines("@@ not a hunk\n+x", path: "", plain: true).allSatisfy { $0.hunk == nil })
    }

    @Test("file tabs parse, and a tab with no path is dropped")
    func fileTabsParse() throws {
        let items = try #require(JSONDecoding.parse(#"[{"id":"tab:/r/a.py","path":"/r/a.py","name":"a.py"},{"id":"tab:x"}]"#)?.arrayValue)
        #expect(FileView.FileTab.parse(items) == [FileView.FileTab(id: "tab:/r/a.py", path: "/r/a.py", name: "a.py")])
    }

    @Test("a switched-away editor is kept with its version, and unsaved marks flip per path")
    func keptEditors() {
        let store = SurfaceStore()
        let stamp = FileSafety.Stamp(data: Data("on disk".utf8))
        store.markUnsaved(path: "/r/a.py", draft: "half")
        store.keepEditor(path: "/r/a.py", FileSafety.Kept(draft: "half", baseline: "on disk", stamp: stamp))
        store.markUnsaved(path: "/r/b.py", draft: "other")
        #expect(store.unsavedPaths == ["/r/a.py", "/r/b.py"])
        #expect(store.keptEditors["/r/a.py"]?.stamp == stamp)
        #expect(store.keptEditors["/r/a.py"]?.draft == "half")
        store.markUnsaved(path: "/r/b.py", draft: nil)
        #expect(store.unsavedPaths == ["/r/a.py"])
        // Closing the surface rescues the drafts to disk and forgets the
        // kept editors, so a reopened surface starts from the files.
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("kept-\(UUID().uuidString)")
        store.rescueUnsaved(in: folder)
        #expect(store.unsavedPaths.isEmpty && store.keptEditors.isEmpty)
        try? FileManager.default.removeItem(at: folder)
    }
}
