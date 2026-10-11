import SwiftUI

/// Reaching the glass without a pointer (bd_2026-Code-yw6).
///
/// The overlay never takes key on its own, by design, so a surface with a
/// button was usable only with a pointer: nothing could be focused, nothing
/// showed focus, and there was no order to move in.
///
/// Option-Command-Return now takes the glass into keyboard mode. Tab and
/// Shift-Tab (or the down and up arrows) move through every control on every
/// surface in a fixed order, a ring shows where focus is, Return or Space
/// presses it, Command-W closes the surface it is on, and Escape gives the
/// keyboard back. The order is computed here, from the specs, rather than
/// left to SwiftUI's key view loop, so it is the same every time and is tested
/// without a screen: surfaces top to bottom then left to right as drawn, and
/// inside each one the components in the order the tree lists them, then the
/// surface's close button last.
public struct FocusTarget: Equatable, Hashable, Sendable {
    public let surface: String
    public let component: ComponentID
    /// The row's id, for a row's action button.
    public let row: String?

    /// The close button of `surface`.
    public static func close(_ surface: String) -> FocusTarget {
        FocusTarget(surface: surface, component: closeID, row: nil)
    }

    /// Not a valid component id (`__` is reserved), so it cannot collide.
    public static let closeID = "__close"

    public var isClose: Bool { component == Self.closeID }
}

public enum KeyboardFocus {
    /// What one key does in keyboard mode.
    public enum Command: Equatable, Sendable {
        case next, previous, activate, close, leave
    }

    /// Option-Command-Return, from anywhere: into keyboard mode, or out.
    public static func isEntry(keyCode: UInt16, flags: NSEvent.ModifierFlags) -> Bool {
        let held = flags.intersection([.command, .option, .control, .shift])
        return keyCode == Keys.returnKey && held == [.command, .option]
    }

    /// The key's meaning in keyboard mode, or nil to let it through. While a
    /// Field is taking the keys only Tab, Shift-Tab and Escape are read, so
    /// typing a space or pressing Return reaches the field.
    public static func command(
        keyCode: UInt16, flags: NSEvent.ModifierFlags, editing: Bool
    ) -> Command? {
        let held = flags.intersection([.command, .option, .control, .shift])
        switch keyCode {
        case Keys.tab: return held.contains(.shift) ? .previous : (held.isEmpty ? .next : nil)
        case Keys.escape: return held.isEmpty ? .leave : nil
        case _ where editing: return nil
        case Keys.down where held.isEmpty: return .next
        case Keys.up where held.isEmpty: return .previous
        case Keys.returnKey where held.isEmpty, Keys.space where held.isEmpty: return .activate
        case Keys.w where held == .command: return .close
        default: return nil
        }
    }

    /// Virtual key codes, US layout positions, from HIToolbox's Events.h.
    enum Keys {
        static let returnKey: UInt16 = 36
        static let tab: UInt16 = 48
        static let space: UInt16 = 49
        static let escape: UInt16 = 53
        static let w: UInt16 = 13
        static let down: UInt16 = 125
        static let up: UInt16 = 126
    }

    /// Rows of the screen first, so two cards side by side at the top come
    /// before anything under them; left to right inside a row.
    static func readsBefore(_ a: CGRect, _ b: CGRect) -> Bool {
        let gap: CGFloat = abs(a.minY - b.minY)
        if gap > sameRow { return a.minY < b.minY }
        return a.minX < b.minX
    }

    /// Two cards whose tops are this close are on one row. Guessed, never
    /// measured.
    static let sameRow: CGFloat = 24

    /// The component types a keyboard can operate.
    static let controls: Set<String> = ["Button", "Checkbox", "Select", "Field"]
    /// The types that carry a button per row when they have `action=`.
    static let rowed: [String: String] = ["List": "items", "Table": "rows", "Events": "items"]

    /// Every target on one surface, in tree order, then its close.
    @MainActor
    static func targets(in store: SurfaceStore, surface: String, closable: Bool) -> [FocusTarget] {
        var out: [FocusTarget] = []
        var seen: Set<ComponentID> = []
        func visit(_ id: ComponentID) {
            guard !seen.contains(id), let node = store.spec.elements[id] else { return }
            seen.insert(id)
            if controls.contains(node.type) {
                out.append(FocusTarget(surface: surface, component: id, row: nil))
            } else if let key = rowed[node.type] {
                let props = store.resolved(node)
                if let action = props["action"]?.stringValue, !action.isEmpty {
                    let items = props[key]?.arrayValue ?? []
                    for (item, fallback) in zip(items, RowKeys.keys(items))
                    where item.objectValue != nil || item.stringValue != nil {
                        out.append(FocusTarget(
                            surface: surface, component: id, row: RowKeys.id(of: item) ?? fallback))
                    }
                }
            }
            for child in node.children { visit(child) }
        }
        if store.isReady, let root = store.spec.root { visit(root) }
        if closable { out.append(.close(surface)) }
        return out
    }
}

extension OverlayModel {
    /// Every keyboard target on the glass, in order.
    public var focusOrder: [FocusTarget] {
        var placed: [(surface: OverlaySurface, frame: CGRect)] = []
        for surface in surfaces where !surface.compact {
            placed.append((surface, frame(of: surface)))
        }
        placed.sort { a, b in KeyboardFocus.readsBefore(a.frame, b.frame) }
        var order: [FocusTarget] = []
        for entry in placed {
            order += KeyboardFocus.targets(
                in: entry.surface.store, surface: entry.surface.id, closable: !entry.surface.isRail)
        }
        return order
    }

    /// Option-Command-Return: focus the first control of the surface most
    /// recently opened or touched. False when there is nothing to focus.
    @discardableResult
    public func enterKeyboard() -> Bool {
        let order = focusOrder
        guard !order.isEmpty else { return false }
        let newest = surfaces.max { $0.touched < $1.touched }?.id
        keyboardFocus = order.first { $0.surface == newest } ?? order[0]
        return true
    }

    /// Escape in keyboard mode: out of a Field being typed in first, then out
    /// of keyboard mode. Answers whether the mode is still on.
    @discardableResult
    public func escapeKeyboard() -> Bool {
        if editingField {
            editingField = false
            return true
        }
        leaveKeyboard()
        return false
    }

    /// Give the keyboard back.
    public func leaveKeyboard() {
        keyboardFocus = nil
        editingField = false
    }

    /// Tab is +1, Shift-Tab -1. Wraps at both ends.
    public func moveFocus(by step: Int) {
        let order = focusOrder
        guard !order.isEmpty else { keyboardFocus = nil; return }
        editingField = false
        guard let current = keyboardFocus, let index = order.firstIndex(of: current) else {
            keyboardFocus = order[0]
            return
        }
        keyboardFocus = order[(index + step % order.count + order.count) % order.count]
    }

    /// Return or Space on the focused target: what a click would have done.
    @discardableResult
    public func activateFocus() -> Bool {
        guard let target = keyboardFocus,
              let surface = surfaces.first(where: { $0.id == target.surface }) else { return false }
        if target.isClose {
            dismiss(target.surface)
            // Focus moves on to what is left rather than off the glass.
            if !enterKeyboard() { leaveKeyboard() }
            return true
        }
        let store = surface.store
        guard let node = store.spec.elements[target.component] else { return false }
        let props = store.resolved(node)
        if let row = target.row {
            guard let action = props["action"]?.stringValue else { return false }
            store.fireRow(action, row: row)
            return true
        }
        switch node.type {
        case "Button":
            var payload: [String: JSON] = [:]
            if let collection = props["collection"] { payload["collection"] = collection }
            store.fire(props["action"]?.stringValue ?? "", from: node.id, payload: payload)
        case "Checkbox":
            guard let pointer = store.pointer(of: node) else { return false }
            store.write(pointer, .bool(Pointer.get(store.spec.data, pointer) != .bool(true)))
        case "Select":
            // Each press picks the next option, round to the first: a pop-up
            // menu cannot be opened from a key monitor without taking focus.
            guard let pointer = store.pointer(of: node) else { return false }
            let options = (props["options"]?.arrayValue ?? []).map(\.display)
            guard !options.isEmpty else { return false }
            let now = Pointer.get(store.spec.data, pointer)?.display ?? ""
            let next = options.firstIndex(of: now).map { (index: Int) in (index + 1) % options.count } ?? 0
            store.write(pointer, .string(options[next]))
        case "Field":
            // The field takes the keys until Escape or Tab.
            editingField = true
        default:
            return false
        }
        return true
    }

    /// Command-W: close the surface focus is on, then focus what is left.
    public func closeFocused() {
        guard let target = keyboardFocus else { return }
        dismiss(target.surface)
        if !enterKeyboard() { leaveKeyboard() }
    }
}

extension SurfaceStore {
    /// Where a control writes, read the same three ways the renderer reads
    /// it: `bind=/pointer`, `bind=@/pointer`, then `value=@/pointer`.
    func pointer(of node: ComponentNode) -> String? {
        switch node.props["bind"] {
        case .literal(.string(let pointer))? where pointer.hasPrefix("/"):
            return pointer
        case .binding(let binding)?:
            return binding.pointer
        default:
            return binding(node, "value")
        }
    }
}

/// The ring around whatever has keyboard focus. Drawn outside the control,
/// so nothing inside moves when focus arrives.
struct KeyboardRing: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        content.overlay {
            if active {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(HUD.accent, lineWidth: 2)
                    .padding(-3)
                    .allowsHitTesting(false)
            }
        }
    }
}

private struct KeyboardFocusKey: EnvironmentKey {
    static let defaultValue: FocusTarget? = nil
}

private struct EditingFieldKey: EnvironmentKey {
    static let defaultValue = false
}

private struct FocusedRowKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    /// The keyboard focus on the glass, for the card that holds it.
    var hudKeyboardFocus: FocusTarget? {
        get { self[KeyboardFocusKey.self] }
        set { self[KeyboardFocusKey.self] = newValue }
    }

    /// The row id whose action button has keyboard focus, set on the one
    /// component that holds it.
    var hudFocusedRow: String? {
        get { self[FocusedRowKey.self] }
        set { self[FocusedRowKey.self] = newValue }
    }

    /// Whether the focused Field has been pressed and is taking the keys.
    var hudEditingField: Bool {
        get { self[EditingFieldKey.self] }
        set { self[EditingFieldKey.self] = newValue }
    }
}
