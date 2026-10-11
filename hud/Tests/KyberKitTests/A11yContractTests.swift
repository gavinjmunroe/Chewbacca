import AppKit
import Foundation
import SwiftUI
import Testing

@testable import KyberKit

/// The accessibility contract (bd_2026-Code-apw): every component has a
/// role and a name source, and adding one without them fails here.
@Suite("Accessibility contract")
@MainActor
struct A11yContractTests {
    private static let hud = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    /// The component names in hud/CLAUDE.md's vocabulary: `- **Name**` lines
    /// under "## The vocabulary", up to the next `## `.
    static func catalog() throws -> [String] {
        let doc = try String(
            contentsOf: hud.appendingPathComponent("CLAUDE.md"), encoding: .utf8)
        guard let start = doc.range(of: "\n## The vocabulary\n") else { return [] }
        let rest = doc[start.upperBound...]
        let section = rest.range(of: "\n## ").map { rest[..<$0.lowerBound] } ?? rest
        return section.split(separator: "\n").compactMap { line in
            guard line.hasPrefix("- **"), let end = line.dropFirst(4).firstIndex(of: "*") else { return nil }
            return String(line[line.index(line.startIndex, offsetBy: 4)..<end])
        }
    }

    /// Every component type the renderer switches on.
    static func rendered() throws -> Set<String> {
        let source = try String(
            contentsOf: hud.appendingPathComponent("Sources/KyberKit/SurfaceView.swift"), encoding: .utf8)
        let pattern = try NSRegularExpression(pattern: #"case ((?:"[A-Z][A-Za-z]+"(?:, )?)+):"#)
        var names: Set<String> = []
        for match in pattern.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
            guard let range = Range(match.range(at: 1), in: source) else { continue }
            for part in source[range].split(separator: ",") {
                names.insert(part.trimmingCharacters(in: CharacterSet(charactersIn: " \"")))
            }
        }
        return names
    }

    @Test("every component in the documented vocabulary has a row")
    func catalogCovered() throws {
        let names = try Self.catalog()
        // The vocabulary lists eighteen today; fewer means the parse broke,
        // not that the catalog shrank.
        #expect(names.count >= 18)
        for name in names {
            #expect(A11yContract.table[name] != nil, "\(name) is in the catalog with no accessibility row")
        }
    }

    @Test("every component the renderer draws has a row")
    func rendererCovered() throws {
        let names = try Self.rendered()
        #expect(names.contains("Screen") && names.contains("Rail"))
        for name in names {
            #expect(A11yContract.table[name] != nil, "\(name) is drawn with no accessibility row")
        }
    }

    @Test("names come from the declared props, in order, and a path is its file name")
    func names() {
        #expect(A11yContract.name("Field", ["label": .string("Note")]) == "Note")
        #expect(A11yContract.name("Field", ["placeholder": .string("Type")]) == "Type")
        #expect(A11yContract.name("Field", ["label": .string(""), "placeholder": .string("Type")]) == "Type")
        #expect(A11yContract.name("File", ["path": .string("~/Downloads/resume.pdf")]) == "resume.pdf")
        #expect(A11yContract.name("Screen", [:]) == nil)
        #expect(A11yContract.name("Nope", ["label": .string("x")]) == nil)
    }

    // Not here: a walk of the rendered accessibility tree. Hosted in an
    // offscreen window in this test bundle, SwiftUI hands AppKit three empty
    // elements and none of the surface (tried 2026-10-10, with a display
    // pass, the run loop turning and NSApplication created). The live tree is
    // read from the running app instead: `chewie app see Kyber` with a
    // surface drawn, which bd_2026-Code-gp6 and bd_2026-Code-jii cover.
}
