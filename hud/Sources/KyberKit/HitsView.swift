import SwiftUI

/// Search results that show why each row is there: Realm's ⌘P and ⌘⇧F rows,
/// re-drawn for the glass (RealmTokens.swift says what was learned from his
/// app and what changed). The agents card draws its file finder, its code
/// search and its `@` picker with it.
///
///     c files Hits caption=@/findFilesCap items=@/findFiles action=ks-open
///     d /findFiles [{"id":"f1:0","kind":"file","where":"bin/lib/surfaces",
///                    "segments":[{"text":"agents","match":true},{"text":".py","match":false}]}]
///
/// A row is `{id, kind, segments, where, selected}`. `segments` is the
/// engine's own answer (realm's `SearchSnippet`): the text in runs, each
/// marked matched or not, so the matched characters are lit and the reader
/// sees why the row ranked. `kind` is `file` (a name; `where` is its folder),
/// `line` (a line of code, drawn mono; `where` is its path and line), a
/// history row (`checkpoint`, `ship`, `pr`), or a space row (`review`, `run`,
/// `schedule`, `mcp`, `memory`), a `branch`, each with its own glyph.
/// `selected` is the row whose file is open below, drawn with one lit line
/// on its leading edge (hud/CLAUDE.md, "Past the window" 11).
///
/// The row IS the press (rule 2): no "Open" beside it. A press sends
/// `e action <action> row=<id> surface=<surface>`, the row-action line.
struct HitRow: Identifiable, Equatable {
    struct Run: Equatable {
        let text: String
        let match: Bool
    }

    let id: String
    let kind: String
    let runs: [Run]
    let place: String
    let selected: Bool

    var isLine: Bool { kind == "line" }

    /// What kind of thing the row is, by its glyph (design.md: a section's
    /// rows are "found by shape before they are read").
    var symbol: String {
        switch kind {
        case "line": return "text.alignleft"
        case "checkpoint": return "clock.arrow.circlepath"
        case "ship": return "arrow.up.circle"
        case "pr": return "arrow.triangle.pull"
        case "review": return "checklist"
        case "run": return "exclamationmark.triangle"
        case "schedule": return "calendar.badge.clock"
        case "mcp": return "point.3.connected.trianglepath.dotted"
        case "memory": return "brain"
        case "branch": return "arrow.triangle.branch"
        default: return "doc.text"
        }
    }
    var plain: String { runs.map(\.text).joined() }

    static func parse(_ items: [JSON]) -> [HitRow] {
        zip(items, RowKeys.keys(items)).compactMap { item, key in
            guard let o = item.objectValue else { return nil }
            let runs = (o["segments"]?.arrayValue ?? []).compactMap { seg -> Run? in
                guard let s = seg.objectValue, let text = s["text"]?.display, !text.isEmpty else { return nil }
                return Run(text: text, match: s["match"] == .bool(true))
            }
            guard !runs.isEmpty else { return nil }
            return HitRow(
                id: RowKeys.id(of: item) ?? key,
                kind: o["kind"]?.display ?? "file",
                runs: runs,
                place: o["where"]?.display ?? "",
                selected: o["selected"] == .bool(true))
        }
    }

    /// The runs as one attributed line: matched characters in the accent
    /// ink at medium weight, the rest in the row's own ink. Colour is not the
    /// only signal: the weight changes too (design.md, Accessibility).
    func attributed(size: CGFloat, mono: Bool) -> AttributedString {
        var out = AttributedString()
        for run in runs {
            var part = AttributedString(run.text)
            part.font = Realm.font(size, run.match ? Realm.Weight.title : Realm.Weight.label, mono: mono)
            part.foregroundColor = run.match ? Realm.accentInk : (isLine ? Realm.ink2 : Realm.ink)
            out += part
        }
        return out
    }
}

struct HitsView: View {
    let caption: String
    let rows: [HitRow]
    let onOpen: ((String) -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // Say nothing when there is nothing (rule 6): no caption over no rows.
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                if !caption.isEmpty {
                    // A section's name at the caption rung, in sentence case,
                    // never tracked capitals (design.md, Typography).
                    Text(caption)
                        .font(Realm.font(Realm.Size.caption, Realm.Weight.medium))
                        .kerning(Realm.tracking(Realm.Size.caption))
                        .foregroundStyle(Realm.ink3)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 2)
                }
                ForEach(rows) { row in
                    HitRowView(row: row, onOpen: onOpen)
                        .rowAnchor(row.id)
                        .transition(RowKeys.transition(reduced: reduceMotion))
                }
            }
            // A new answer swaps rows in place; matched by id, so a row that
            // stays does not move (motion rule 13).
            .animation(reduceMotion ? nil : Realm.fade(Realm.Duration.swap), value: rows)
        }
    }
}

struct HitRowView: View {
    let row: HitRow
    let onOpen: ((String) -> Void)?
    @Environment(\.hudFocusedRow) private var focusedRow
    @State private var hovering = false

    var body: some View {
        Button {
            onOpen?(row.id)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: row.symbol)
                    .font(.system(size: Realm.Size.tiny, weight: .semibold))
                    .foregroundStyle(row.selected ? Realm.accentInk : Realm.ink3)
                    .frame(width: 14)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.attributed(size: row.isLine ? Realm.Size.caption : Realm.Size.small, mono: row.isLine))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if !row.place.isEmpty {
                        // A path is operational data: mono, quiet, and cut in
                        // the middle so both its root and its file survive.
                        Text(row.place)
                            .font(Realm.font(Realm.Size.tiny, mono: true))
                            .foregroundStyle(Realm.ink3)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, minHeight: HitTarget.minimum, alignment: .leading)
            .background {
                // Hover arrives at once and only its release fades
                // (design.md, Controls: "a highlight that eases in is the
                // window making the pointer wait").
                RoundedRectangle(cornerRadius: Realm.Radius.control, style: .continuous)
                    .fill(hovering ? Realm.hoverFill : .clear)
                    .animation(hovering ? nil : .easeOut(duration: Realm.Duration.hover), value: hovering)
            }
            .overlay(alignment: .leading) {
                // The open file's row keeps one lit line on its leading
                // edge, the same light the card opens with.
                if row.selected {
                    RoundedRectangle(cornerRadius: Realm.Radius.tick)
                        .fill(Realm.accent)
                        .frame(width: 2)
                        .padding(.vertical, 8)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: Realm.Radius.control, style: .continuous))
        }
        .buttonStyle(RowButtonStyle())
        .disabled(onOpen == nil)
        .onHover { hovering = $0 }
        .modifier(KeyboardRing(active: focusedRow == row.id))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.plain)
        .accessibilityValue(row.place)
        .accessibilityAddTraits(row.selected ? [.isButton, .isSelected] : .isButton)
    }
}
