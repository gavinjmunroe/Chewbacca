import AppKit
import Foundation
import SwiftUI
import Testing

@testable import KyberKit

/// Syntax color for the Diff surface and the File editor (CHW-189). The
/// scanner must give every line back unchanged, color what a glance needs,
/// and carry a block comment across lines.
@Suite("Syntax")
@MainActor
struct SyntaxTests {
    private func kinds(_ line: String, _ path: String) -> [(String, Syntax.Kind)] {
        var state = Syntax.State()
        guard let lang = Syntax.language(forPath: path) else { return [] }
        return Syntax.tokens(line, lang, state: &state).map { ($0.text, $0.kind) }
    }

    /// Two AppKit colors as the same sRGB components, within rounding.
    private func same(_ a: Any?, _ b: Color) -> Bool {
        guard let a = (a as? NSColor)?.usingColorSpace(.sRGB),
              let b = NSColor(b).usingColorSpace(.sRGB) else { return false }
        return abs(a.redComponent - b.redComponent) < 0.01 && abs(a.greenComponent - b.greenComponent) < 0.01
            && abs(a.blueComponent - b.blueComponent) < 0.01 && abs(a.alphaComponent - b.alphaComponent) < 0.01
    }

    @Test("a file name picks its language; an unknown one is plain")
    func languages() {
        #expect(Syntax.language(forPath: "hud/Sources/KyberKit/Glass.swift")?.name == "swift")
        #expect(Syntax.language(forPath: "bin/lib/session_tree.py")?.name == "python")
        #expect(Syntax.language(forPath: "app/page.tsx")?.name == "javascript")
        #expect(Syntax.language(forPath: "tests/run.sh")?.name == "shell")
        #expect(Syntax.language(forPath: "README.md") == nil)
        #expect(Syntax.language(forShebang: "#!/usr/bin/env python3")?.name == "python")
        #expect(Syntax.language(forShebang: "import x") == nil)
    }

    @Test("tokens join back to the exact line")
    func lossless() throws {
        let lang = try #require(Syntax.language(forPath: "x.swift"))
        for line in [#"let x = "a \"q\" b" // note"#, "    @MainActor func f() -> Int { 0x1F }", "", "\t/* open",
                     "é = 1 // ünicode"] {
            var state = Syntax.State()
            #expect(Syntax.tokens(line, lang, state: &state).map(\.text).joined() == line)
        }
    }

    @Test("keywords, strings, comments, numbers, types and attributes are told apart")
    func kindsSwift() {
        let k = kinds(#"@MainActor static let limit: Int = 42 // why"#, "x.swift")
        #expect(k.contains { $0 == ("@MainActor", .attribute) })
        #expect(k.contains { $0 == ("static", .keyword) })
        #expect(k.contains { $0 == ("Int", .type) })
        #expect(k.contains { $0 == ("42", .number) })
        #expect(k.last.map { $0 == ("// why", .comment) } == true)
        let py = kinds(#"def build(cwd: str) -> list:  # the tree"#, "x.py")
        #expect(py.first.map { $0 == ("def", .keyword) } == true)
        #expect(py.last.map { $0.1 == .comment } == true)
        let s = kinds(#"x = 'it''s' + "two""#, "x.py").filter { $0.1 == .string }.map(\.0)
        #expect(s == ["'it'", "'s'", "\"two\""])
    }

    @Test("a number inside a name is not a number, and $# in shell is not a comment")
    func edges() {
        #expect(!kinds("let utf8 = x2", "x.swift").contains { $0.1 == .number })
        #expect(!kinds("echo $# args", "x.sh").contains { $0.1 == .comment })
        #expect(kinds("echo hi # note", "x.sh").last.map { $0.1 == .comment } == true)
    }

    @Test("a block comment carries across lines and closes")
    func blockComment() throws {
        let lang = try #require(Syntax.language(forPath: "x.ts"))
        var state = Syntax.State()
        _ = Syntax.tokens("const a = 1 /* starts", lang, state: &state)
        #expect(state.inBlockComment)
        let middle = Syntax.tokens("still comment", lang, state: &state)
        #expect(middle.allSatisfy { $0.kind == .comment })
        let end = Syntax.tokens("ends */ return 2", lang, state: &state)
        #expect(!state.inBlockComment)
        #expect(end.first?.kind == .comment)
        #expect(end.contains { $0.text == "return" && $0.kind == .keyword })
    }

    /// The colors a drawn diff line carries, by run.
    private func colors(_ line: AttributedString) -> [Color] {
        line.runs.compactMap { $0.foregroundColor }
    }

    @Test("a diff colors the code inside +/- lines by the language its header names")
    func diffColors() {
        let text = """
            diff --git a/bin/x.py b/bin/x.py
            --- a/bin/x.py
            +++ b/bin/x.py
            @@ -1,2 +1,2 @@
             import os
            -def old(): return 1
            +def new(): return "two"  # comment
            """
        let lines = DiffView.lines(text, path: "")
        #expect(lines.map(\.kind) == [.plain, .header, .header, .hunk, .plain, .removed, .added])
        let added = lines[6].body
        #expect(String(added.characters) == #"+def new(): return "two"  # comment"#)
        let drawn = colors(added)
        #expect(drawn.first == HUD.good, "the + marker stays green")
        #expect(drawn.contains(Syntax.color(.keyword)))
        #expect(drawn.contains(Syntax.color(.string)))
        #expect(drawn.contains(Syntax.color(.comment)))
        // Test output and status text have no header: drawn plain, not guessed at.
        let plain = DiffView.lines("$ swift test\nexit 0", path: "")
        #expect(plain.allSatisfy { colors($0.body) == [DiffView.color(.plain)] })
    }

    @Test("`path` colors a diff with no header, such as an Edit call's")
    func diffPath() {
        let lines = DiffView.lines("@@\n-let a = 1\n+let a = 2", path: "Glass.swift")
        #expect(colors(lines[2].body).contains(Syntax.color(.keyword)))
    }

    @Test("the editor paints in UTF-16 ranges, so text after an emoji is colored right")
    func paint() {
        let storage = NSTextStorage(string: "let s = \"\u{1F600}\" // x\nreturn 1")
        let font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        Syntax.paint(storage, Syntax.language(forPath: "a.swift"), font: font)
        let ns = storage.string as NSString
        let keyword = storage.attribute(.foregroundColor, at: ns.range(of: "return").location, effectiveRange: nil)
        #expect(same(keyword, Syntax.color(.keyword)))
        let comment = storage.attribute(.foregroundColor, at: ns.range(of: "// x").location, effectiveRange: nil)
        #expect(same(comment, Syntax.color(.comment)))
    }

    @Test("the tree reads its rows and only file rows are pressable")
    func treeRows() {
        let rows = TreeView.rows([
            .object(["id": .string("t0"), "name": .string("hud"), "depth": .number(0), "dir": .bool(true)]),
            .object(["id": .string("t1"), "name": .string("Glass.swift"), "depth": .number(1),
                     "dir": .bool(false), "mark": .string("M")]),
            .object(["id": .string(""), "name": .string("dropped")]),
        ])
        #expect(rows.map(\.id) == ["t0", "t1"])
        #expect(rows[0].isDir && !rows[1].isDir)
        #expect(rows[1].mark == "M" && rows[1].depth == 1)
        #expect(TreeView.markColor("M") == HUD.warn)
        #expect(TreeView.markColor("??") == HUD.good)
    }

    /// Proof over a real diff, run by hand: `DIFF_PROOF=<file> swift test
    /// --filter Syntax`. Prints, per kind, how many tokens the added and
    /// removed lines were colored as. Skipped when the variable is unset.
    @Test("a real diff, when one is handed in")
    func realDiff() throws {
        guard let file = ProcessInfo.processInfo.environment["DIFF_PROOF"] else { return }
        let text = try String(contentsOfFile: file, encoding: .utf8)
        var counts: [String: Int] = [:]
        var language: Syntax.Language?
        var state = Syntax.State()
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if let named = DiffView.headerPath(line) { language = Syntax.language(forPath: named) ?? language }
            let kind = DiffView.kind(line)
            guard let language, kind == .added || kind == .removed else { continue }
            for token in Syntax.tokens(String(line.dropFirst()), language, state: &state) {
                counts[token.kind.rawValue, default: 0] += 1
            }
        }
        let drawn = DiffView.lines(text, path: "")
        let colored = drawn.filter { Set(colors($0.body)).count > 2 }.count
        print("DIFF_PROOF lines=\(drawn.count) multicolor_lines=\(colored) tokens=\(counts.sorted { $0.key < $1.key })")
        #expect(colored > 0)
    }
}
