import SwiftUI

/// Identity for the rows of a List, Table or Events, and the button a row can
/// carry.
///
/// Rows used to be keyed by position (List, Table) or by a fresh UUID on every
/// render (Events). Both make a live update wrong in the same visible way: one
/// new message at the top of a list changed the text of every row in place,
/// and Events tore down and rebuilt every row, so a `d` that added one item
/// flashed the whole panel. Keyed by what the row is, the rows already there
/// stay still and only the new one moves.
enum RowKeys {
    /// One stable key per item: its `id` when it has one, otherwise its
    /// content. A repeated key gets `#2`, `#3`, so two identical rows are
    /// still two rows rather than a ForEach identity collision.
    static func keys(_ items: [JSON]) -> [String] {
        var seen: [String: Int] = [:]
        return items.map { item in
            let base = id(of: item) ?? content(of: item)
            let count = seen[base, default: 0] + 1
            seen[base] = count
            return count == 1 ? base : "\(base)#\(count)"
        }
    }

    /// The item's own id, which is what a row action reports.
    static func id(of item: JSON) -> String? {
        guard let value = item.objectValue?["id"] else { return nil }
        let text = value.display
        return text.isEmpty ? nil : text
    }

    private static func content(of item: JSON) -> String {
        if case .object = item { return OutboundEvent.value(item) }
        return item.display
    }

    /// How a row arrives and leaves. A new row comes down from above, where
    /// newest-first lists put it; a removed one only fades, because a row
    /// that slides away drags the eye after something that no longer matters.
    @MainActor
    static func transition(reduced: Bool) -> AnyTransition {
        reduced
            ? .opacity
            : .asymmetric(
                insertion: .move(edge: .top).combined(with: .opacity),
                removal: .opacity)
    }
}

/// What a row's button needs: the action to send and its label. Nil on a
/// component with no `action` prop, which is most of them.
struct RowAction {
    let name: String
    let label: String
    let send: (String) -> Void

    init?(_ props: [String: JSON], send: @escaping (String) -> Void) {
        guard let name = props["action"]?.stringValue, !name.isEmpty else { return nil }
        self.name = name
        self.label = props["actionLabel"]?.display ?? name.capitalized
        self.send = send
    }
}

/// The button at the end of a row. The capsule is small so a list still reads
/// as a list; the target around it is 44 points tall, Apple's minimum, so it
/// can be hit by someone who is not aiming carefully.
struct RowActionButton: View {
    let action: RowAction
    let row: String

    var body: some View {
        Button {
            action.send(row)
        } label: {
            Text(action.label)
                .font(.system(size: 11, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(.quaternary, in: Capsule())
                .frame(minWidth: 44, minHeight: HitTarget.minimum)
                .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .accessibilityLabel("\(action.label), \(row)")
    }
}

/// The smallest a pointer target may be. 44 points is the HIG's floor for
/// anything pressed, and the backlog item (bd_2026-Code-cnr) that set it
/// found the close button at 18.
enum HitTarget {
    static let minimum: CGFloat = 44
}
