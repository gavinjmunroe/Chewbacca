import Testing

@testable import KyberKit

/// The agent card's IDE pieces that live in Swift: Keep and Reject on each
/// hunk of a Diff (bin/lib/surfaces/agent_hunks.py).
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
}
