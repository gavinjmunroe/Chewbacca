import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// Coding sessions on the glass: the conversation panel addressed to one,
/// the private line that carries what the person typed, and the two views a
/// session card is drawn with. The daemon side is tests/test_kyber_sessions.py.
@Suite("Sessions")
@MainActor
struct SessionTests {
    private func height(_ view: some View) -> CGFloat {
        NSHostingView(rootView: view.frame(width: 520)).fittingSize.height
    }

    @Test("`to` addresses the panel, `to off` takes it back")
    func toParses() throws {
        let op = try #require(try LineParser.parse(#"to s-6d901cd1 label="lemma session""#))
        #expect(op == .chatTarget(surface: "s-6d901cd1", label: "lemma session"))
        #expect(try LineParser.parse("to off") == .chatTarget(surface: nil, label: ""))
        #expect(throws: LineParseError.self) { try LineParser.parse("to") }
    }

    @Test("typed while addressed, the text goes as one private line to that surface")
    func sendGoesToTarget() throws {
        let model = OverlayModel()
        var sent: [String] = []
        model.onEvent = { sent.append($0.line) }
        model.apply(try #require(try LineParser.parse("@ s-abc at=center")))
        #expect(!model.sendToTarget("hello"), "nothing addressed: the caller asks the assistant")
        model.apply(try #require(try LineParser.parse(#"to s-abc label="lemma session""#)))
        #expect(model.chatTarget == ChatTarget(surface: "s-abc", label: "lemma session"))
        #expect(model.sendToTarget(#"run the tests, then "push""#))
        #expect(sent.last == #"e action send row="s-abc" surface="s-abc" text="run the tests, then \"push\"""#)
        #expect(OutboundEvent.isPrivate(sent.last ?? ""))
    }

    @Test("closing the card sends `closed` to its owner and drops the address")
    func closeTellsOwner() throws {
        let model = OverlayModel()
        var sent: [String] = []
        model.onEvent = { sent.append($0.line) }
        model.apply(try #require(try LineParser.parse("@ s-abc")))
        model.apply(try #require(try LineParser.parse("to s-abc label=x")))
        model.dismiss("s-abc")
        #expect(model.chatTarget == nil)
        #expect(sent.contains(#"e closed s-abc surface="s-abc""#))
        // With the card gone, a send goes nowhere rather than to the assistant.
        model.apply(try #require(try LineParser.parse("to s-abc label=x")))
        #expect(model.sendToTarget("late"))
        #expect(!sent.contains { $0.contains("late") })
    }

    @Test("a surface's events go to the client that drew it, private ones never broadcast")
    func socketRouting() {
        let subs: Set<Int32> = [4, 7]
        let owners: [String: Int32] = ["s-abc": 7, "gone": 9]
        let send = #"e action send row="s-abc" surface="s-abc" text="hi""#
        #expect(SocketServer.recipients(for: send, subscribers: subs, owners: owners) == [7])
        // Owner gone: a private line is dropped, never handed to hud-listen.
        let orphan = #"e action send row="gone" surface="gone" text="hi""#
        #expect(SocketServer.recipients(for: orphan, subscribers: subs, owners: owners).isEmpty)
        // An ordinary press on a surface nobody owns still reaches everyone.
        let press = #"e go b surface="notes""#
        #expect(SocketServer.recipients(for: press, subscribers: subs, owners: owners) == subs)
        #expect(SocketServer.recipients(for: "h \"hello\"", subscribers: subs, owners: owners) == subs)
        #expect(SocketServer.owner(of: "@ s-abc at=center w=560") == "s-abc")
        #expect(SocketServer.owner(of: "c s Screen") == nil)
        #expect(OutboundEvent.surface(in: #"e x y surface="has space""#) == "has space")
    }

    @Test("a transcript folds tool calls to one line and keeps the turns")
    func transcriptItems() {
        let items = TranscriptView.items([
            .object(["id": .string("1"), "role": .string("user"), "text": .string("make it glass")]),
            .object(["id": .string("2"), "role": .string("assistant"), "text": .string("On it.")]),
            .object(["id": .string("3"), "role": .string("tool"), "tool": .string("Edit"),
                     "text": .string("Edit: /x/Glass.swift"), "open": .bool(true)]),
            .object(["role": .string("assistant"), "text": .string("no id, dropped")]),
        ])
        #expect(items.map(\.role) == ["user", "assistant", "tool"])
        #expect(items[2].canOpen)
        let view = TranscriptView(items: items, onOpen: { _ in }).environment(\.hudOffscreen, true)
        // Three rows: a bubble, a line of prose and a 28-point tool row.
        #expect(height(view) > 60)
        #expect(TranscriptView.symbol("Bash") == "terminal")
    }

    @Test("a diff colours by line, and keeps only the tail of a huge one")
    func diffLines() {
        #expect(DiffView.kind("+added") == .added)
        #expect(DiffView.kind("-removed") == .removed)
        #expect(DiffView.kind("--- a/x") == .header)
        #expect(DiffView.kind("@@ -1 +1 @@") == .hunk)
        #expect(DiffView.kind(" context") == .plain)
        let huge = (0..<5000).map { "+line \($0)" }.joined(separator: "\n")
        let h = height(DiffView(text: huge))
        #expect(h < CGFloat(DiffView.maxLines) * 20, "drew \(h) points of a 5000-line diff")
    }

    @Test("the wash thickens over a light page and stays put over a dark one")
    func washFollowsGround() {
        for urgency in Urgency.allCases {
            #expect(urgency.wash(over: nil) == urgency.wash)
            #expect(urgency.wash(over: 0.1) == urgency.wash, "a dark ground needs nothing added")
            #expect(urgency.wash(over: 0.95) > urgency.wash(over: 0.5))
            #expect(urgency.wash(over: 1) <= 0.7, "never a black slab")
        }
        // Over white, normal glass reaches the ~0.6 that faint text needed
        // in the 2026-10-04 measurement.
        #expect(Urgency.normal.wash(over: 0.95) >= 0.6)
    }

    @Test("the ground under a card is its bright parts, not its mean")
    func groundIsBright() {
        // A page of black text on white: mostly white with dark runs.
        var page = [Double](repeating: 1, count: 70)
        page += [Double](repeating: 0, count: 30)
        #expect(BackdropSampler.percentile(page, 0.8) == 1)
        #expect(BackdropSampler.percentile([], 0.8) == nil)
    }

    @Test("a closed name reopened is a new card, never the old one's identity")
    func reopenIsNewIdentity() throws {
        let model = OverlayModel()
        model.apply(try #require(try LineParser.parse("@ genui at=topRight")))
        let first = try #require(model.surfaces.first?.viewID)
        model.apply(try #require(try LineParser.parse("- genui")))
        model.apply(try #require(try LineParser.parse("@ genui at=topRight")))
        model.apply(try #require(try LineParser.parse("@ genui at=left")))
        #expect(model.surfaces.count == 1)
        #expect(model.surfaces.first?.viewID != first)
        // Re-addressing an open one keeps its identity: it moves, it is not
        // replaced.
        let second = model.surfaces.first?.viewID
        model.apply(try #require(try LineParser.parse("@ genui at=right")))
        #expect(model.surfaces.first?.viewID == second)
        model.apply(try #require(try LineParser.parse("- genui")))
        #expect(model.surfaces.isEmpty)
    }

    /// The documented `bind=` form and the older `value=@` form both write,
    /// typed into a real AppKit field in a real window.
    @Test("typing into a Field writes to its pointer", arguments: ["bind=/draft/note", "value=@/draft/note"])
    func fieldTakesTyping(form: String) throws {
        let store = SurfaceStore()
        var events: [String] = []
        store.onEvent = { events.append($0.line) }
        for line in ["c s Screen title=\"NOTE\"", "c n Field label=\"Note\" \(form)", "> s n", "r s",
                     "d /draft/note \"hi\""] {
            store.apply([try #require(try LineParser.parse(line))])
        }
        let host = NSHostingView(rootView: SurfaceView(store: store).frame(width: 360, height: 200))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 200),
            styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        func fields(_ view: NSView) -> [NSTextField] {
            (view as? NSTextField).map { [$0] } ?? view.subviews.flatMap(fields)
        }
        let field = try #require(fields(host).first { $0.isEditable }, "no editable field drawn")
        #expect(field.stringValue == "hi", "the bound value is not shown")
        window.makeFirstResponder(field)
        let editor = try #require(field.currentEditor() as? NSTextView)
        editor.selectAll(nil)
        editor.insertText("typed", replacementRange: editor.selectedRange())
        #expect(store.spec.data["draft"]?.objectValue?["note"] == .string("typed"))
        #expect(events.contains(#"v /draft/note "typed""#))
    }

    @Test("the card glass has 16-point corners")
    func cornerRadius() {
        #expect(SurfaceChrome.radius == 16)
    }
}
