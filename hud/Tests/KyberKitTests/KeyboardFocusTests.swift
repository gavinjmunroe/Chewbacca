import AppKit
import Foundation
import Testing

@testable import KyberKit

/// The glass by keyboard (bd_2026-Code-yw6): a fixed order through every
/// control, a press that does what a click does, and a way out.
@Suite("Keyboard focus")
@MainActor
struct KeyboardFocusTests {
    final class Box { var lines: [String] = [] }

    private func model(_ lines: [String]) throws -> (OverlayModel, Box) {
        let model = OverlayModel()
        let box = Box()
        model.onEvent = { box.lines.append($0.line) }
        for line in lines { model.apply(try #require(try LineParser.parse(line))) }
        return (model, box)
    }

    private let form = [
        "@ form at=topLeft w=320",
        "c s Screen title=\"FORM\"",
        "c go Button label=\"Send\" action=send",
        "c u Checkbox label=\"Urgent\" bind=/draft/urgent",
        "c st Select label=\"Status\" bind=/draft/status options=[\"Todo\",\"Done\"]",
        "c n Field label=\"Note\" bind=/draft/note",
        "> s n u st go",
        "r s",
    ]

    @Test("tree order inside a surface, then its close")
    func order() throws {
        let (model, _) = try model(form)
        #expect(model.focusOrder.map(\.component) == ["n", "u", "st", "go", FocusTarget.closeID])
    }

    @Test("surfaces go top to bottom, then left to right")
    func surfaceOrder() throws {
        let (model, _) = try model(form + [
            "@ side at=topRight w=320", "c s2 Screen title=\"SIDE\"",
            "c b2 Button label=\"Go\" action=go", "> s2 b2", "r s2",
            "@ low at=bottomLeft w=320", "c s3 Screen title=\"LOW\"",
            "c b3 Button label=\"Low\" action=low", "> s3 b3", "r s3",
        ])
        let surfaces = model.focusOrder.map(\.surface).reduce(into: [String]()) {
            if $0.last != $1 { $0.append($1) }
        }
        #expect(surfaces == ["form", "side", "low"])
    }

    @Test("entering focuses the newest surface; Tab wraps both ways")
    func moving() throws {
        let (model, _) = try model(form + [
            "@ side at=topRight w=320", "c s2 Screen title=\"SIDE\"",
            "c b2 Button label=\"Go\" action=go", "> s2 b2", "r s2",
        ])
        #expect(model.enterKeyboard())
        #expect(model.keyboardFocus?.component == "b2")
        let order = model.focusOrder
        model.moveFocus(by: 2)
        #expect(model.keyboardFocus == order[0])
        model.moveFocus(by: -1)
        #expect(model.keyboardFocus == order.last)
    }

    @Test("Return does what a click does")
    func activating() throws {
        let (model, box) = try model(form)
        let store = try #require(model.surfaces.first?.store)
        model.enterKeyboard()
        // Field: takes the keys.
        #expect(model.keyboardFocus?.component == "n")
        model.activateFocus()
        #expect(model.editingField)
        #expect(model.escapeKeyboard())
        #expect(!model.editingField)
        // Checkbox toggles.
        model.moveFocus(by: 1)
        model.activateFocus()
        #expect(Pointer.get(store.spec.data, "/draft/urgent") == .bool(true))
        model.activateFocus()
        #expect(Pointer.get(store.spec.data, "/draft/urgent") == .bool(false))
        // Select steps through its options.
        model.moveFocus(by: 1)
        model.activateFocus()
        #expect(Pointer.get(store.spec.data, "/draft/status") == .string("Todo"))
        model.activateFocus()
        #expect(Pointer.get(store.spec.data, "/draft/status") == .string("Done"))
        // Button sends its action, with its surface.
        model.moveFocus(by: 1)
        model.activateFocus()
        #expect(box.lines.contains { $0.hasPrefix("e send go") && $0.contains("surface=\"form\"") })
    }

    @Test("a row's action is a stop of its own and sends that row")
    func rows() throws {
        let (model, box) = try model([
            "@ msgs at=right w=320", "c s Screen title=\"MESSAGES\"",
            "c t Events caption=\"Needs a reply\" action=reply items=@/threads",
            "d /threads [{\"id\":\"thread:a\",\"text\":\"Sam\"},{\"id\":\"thread:b\",\"text\":\"Ava\"}]",
            "> s t", "r s",
        ])
        #expect(model.focusOrder.map(\.row) == ["thread:a", "thread:b", nil])
        model.enterKeyboard()
        model.moveFocus(by: 1)
        model.activateFocus()
        #expect(box.lines.contains("e action reply row=\"thread:b\" surface=\"msgs\""))
    }

    @Test("Command-W and the focused close take the surface down and focus what is left")
    func closing() throws {
        let (model, box) = try model(form + [
            "@ side at=topRight w=320", "c s2 Screen title=\"SIDE\"",
            "c b2 Button label=\"Go\" action=go", "> s2 b2", "r s2",
        ])
        model.enterKeyboard()
        model.closeFocused()
        #expect(!model.surfaces.contains { $0.id == "side" })
        #expect(box.lines.contains { $0.hasPrefix("e closed side") })
        #expect(model.keyboardFocus?.surface == "form")
        // Through to the close button, and press it.
        while model.keyboardFocus?.isClose != true { model.moveFocus(by: 1) }
        model.activateFocus()
        #expect(model.surfaces.isEmpty)
        #expect(model.keyboardFocus == nil)
    }

    @Test("nothing on the glass, nothing to enter")
    func empty() {
        #expect(!OverlayModel().enterKeyboard())
    }

    @Test("the keys: entry, moving, pressing, closing and leaving")
    func keys() {
        typealias K = KeyboardFocus.Keys
        #expect(KeyboardFocus.isEntry(keyCode: K.returnKey, flags: [.command, .option]))
        #expect(!KeyboardFocus.isEntry(keyCode: K.returnKey, flags: [.command]))
        #expect(KeyboardFocus.command(keyCode: K.tab, flags: [], editing: false) == .next)
        #expect(KeyboardFocus.command(keyCode: K.tab, flags: .shift, editing: true) == .previous)
        #expect(KeyboardFocus.command(keyCode: K.space, flags: [], editing: false) == .activate)
        // In a field, Space and Return are the field's.
        #expect(KeyboardFocus.command(keyCode: K.space, flags: [], editing: true) == nil)
        #expect(KeyboardFocus.command(keyCode: K.returnKey, flags: [], editing: true) == nil)
        #expect(KeyboardFocus.command(keyCode: K.escape, flags: [], editing: true) == .leave)
        #expect(KeyboardFocus.command(keyCode: K.w, flags: .command, editing: false) == .close)
        #expect(KeyboardFocus.command(keyCode: K.w, flags: [], editing: false) == nil)
    }
}
