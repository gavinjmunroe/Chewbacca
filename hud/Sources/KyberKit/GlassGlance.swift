import SwiftUI

/// The parts a glance is drawn with when its surface has `chrome=glass`:
/// content on the glass, no card, no title bar, no pill buttons.
///
/// Caleb, 2026-10-11 01:17: "The future of UX does not look like macos", and
/// at 01:56 on the meetings card: "1 dimesnional af bro". The card was a
/// frosted box with a title, a purpose line, a state line, a Record pill, two
/// metric tiles and six identical rows each ending in a grey "Open" capsule.
/// Here the rows are the presses, the state is light on the thing that has
/// it, and the space between meetings is the time between them. The rules
/// and their sources are in hud/CLAUDE.md, "Past the window".

/// A word that is a press: lit text, no capsule. The 44-point target is
/// there and invisible (HIG floor, `HitTarget`).
struct GlassWord: View {
    let label: String
    var tone: Color = HUD.accent
    let action: () -> Void

    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                // Full strength always: the hue alone is the 4.63:1 that
                // `HUD.accent` was lifted to hold. Hover adds light around
                // it, never takes contrast away.
                .foregroundStyle(tone)
                .shadow(color: tone.opacity(hovering ? 0.7 : 0), radius: 6)
                .frame(minWidth: HitTarget.minimum, minHeight: HitTarget.minimum)
                .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .onHover { hovering = $0 }
        .animation(Motion.hover(reduced: reduceMotion), value: hovering)
        .accessibilityLabel(label)
    }
}

/// A count as a figure set in the text, not a tile: "6 calls this week".
struct GlassMetric: View {
    let label: String
    let value: String
    var tone: Color?
    var number: Double?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(value)
                .font(.system(size: 30, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tone ?? HUD.ink)
                // A toned count is lit: it glows in its meaning's hue.
                .shadow(color: (tone ?? .clear).opacity(0.55), radius: 10)
                .contentTransition(.numericText(value: number ?? 0))
            Text(label)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(tone ?? HUD.dim)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(value) \(label)")
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// Things in time, on one line of light, spaced by the time between them.
///
/// Each row is its own press: its name opens it (`action=` whose label is
/// Open). A row whose action changes something (Go) keeps that verb as a lit
/// word at its end instead, because a press on a sentence must never do more
/// than navigate. `day` names the day only where it changes, `clock` is the
/// time of day, `gap` (0 to 1) is the room above the row, and `tone` is the
/// light on its node (`needs`, `running`, `done`, `recording`).
struct GlassRail: View {
    let items: [JSON]
    var rowAction: RowAction?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudFocusedRow) private var focusedRow

    /// The most room one gap adds above a row: an hour apart is close, three
    /// days apart is a visible break. Guessed, never measured.
    static let gapStep: CGFloat = 22
    /// A row's own height: with the 2 points the press reaches past it on
    /// each side, the target is 44 (HitTarget.minimum).
    static let rowHeight: CGFloat = 40
    /// "YESTERDAY" at 9.5 points with its tracking measured 61 and was cut
    /// to "YESTERD..." at 62 in the first snapshot.
    static let dayGutter: CGFloat = 74
    static let nodeColumn: CGFloat = 16
    /// The length a full span draws: most of a 420-point glance's name
    /// column. Guessed, never measured.
    static let spanWidth: CGFloat = 220

    struct Row: Identifiable {
        let id: String
        let row: String
        let text: String
        let clock: String
        let day: String
        let gap: Double
        let tone: String?
        /// How long it ran, 0 to 1 of the row: the second axis.
        let span: Double
        let marked: Bool
        let hidden: Bool
    }

    static func rows(_ items: [JSON]) -> [Row] {
        zip(items, RowKeys.keys(items)).compactMap { item, key in
            guard let o = item.objectValue else {
                guard let text = item.stringValue else { return nil }
                return Row(id: key, row: key, text: text, clock: "", day: "", gap: 0, tone: nil, span: 0,
                           marked: false, hidden: false)
            }
            let tone = o["tone"]?.stringValue
            return Row(
                id: key, row: RowKeys.id(of: item) ?? key,
                text: o["text"]?.display ?? "",
                clock: (o["clock"]?.display).flatMap { $0.isEmpty ? nil : $0 } ?? o["time"]?.display ?? "",
                day: o["day"]?.display ?? "",
                gap: min(max(o["gap"]?.doubleValue ?? 0, 0), 1),
                tone: (tone?.isEmpty ?? true) ? nil : tone,
                span: min(max(o["span"]?.doubleValue ?? 0, 0), 1),
                marked: o["accent"] == .bool(true),
                hidden: o["private"] == .bool(true))
        }
    }

    /// Navigation is the content itself; anything else keeps its verb.
    var navigates: Bool {
        guard let rowAction else { return false }
        return rowAction.label.lowercased() == "open"
    }

    var body: some View {
        let rows = Self.rows(items)
        let gutter = rows.contains { !$0.day.isEmpty } ? Self.dayGutter : 0
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                line(row, gutter: gutter)
                    .padding(.top, index == 0 ? 0 : CGFloat(row.gap) * Self.gapStep)
                    .transition(RowKeys.transition(reduced: reduceMotion))
            }
        }
        // The rail: one hairline of light through every node, from the first
        // to the last, never dangling past either.
        .background(alignment: .topLeading) {
            if rows.count > 1 {
                LinearGradient(colors: [HUD.accent.opacity(0.35), HUD.accent.opacity(0.08)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(width: 1)
                    .padding(.vertical, Self.rowHeight / 2)
                    .offset(x: gutter + Self.nodeColumn / 2 - 0.5)
                    .accessibilityHidden(true)
            }
        }
    }

    @ViewBuilder
    private func line(_ row: Row, gutter: CGFloat) -> some View {
        let content = RailLine(row: row, gutter: gutter, pressable: navigates,
                               focused: focusedRow == row.row,
                               verb: navigates ? nil : rowAction)
            .frame(minHeight: Self.rowHeight)
            .rowAnchor(row.row)
        if navigates, let rowAction {
            Button { rowAction.send(row.row) } label: {
                content.contentShape(Rectangle().inset(by: -(HitTarget.minimum - Self.rowHeight) / 2))
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityLabel([row.day, row.text, row.clock].filter { !$0.isEmpty }.joined(separator: ", "))
            .accessibilityHint("Opens it")
        } else {
            content
        }
    }
}

/// One row of the rail: day, node, name, clock.
private struct RailLine: View {
    let row: GlassRail.Row
    let gutter: CGFloat
    let pressable: Bool
    let focused: Bool
    let verb: RowAction?

    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var lit: Color? {
        if let meaning = HUD.meaning(row.tone) { return meaning }
        return row.marked ? HUD.accent : nil
    }

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            if gutter > 0 {
                Text(row.day.uppercased())
                    .font(.system(size: 9.5, weight: .semibold))
                    .kerning(0.7)
                    .foregroundStyle(HUD.faint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(width: gutter, alignment: .leading)
            }
            // The node is where the state is: a lit point in its meaning's
            // hue, or a dim one. Nothing else on the row is coloured.
            Circle()
                .fill(lit ?? HUD.ink.opacity(hovering ? 0.8 : 0.42))
                .frame(width: lit == nil ? 5 : 7, height: lit == nil ? 5 : 7)
                .shadow(color: (lit ?? .clear).opacity(0.85), radius: 5)
                .frame(width: GlassRail.nodeColumn)
            Text(row.text)
                .font(.system(size: 13.5, weight: row.marked ? .semibold : .regular))
                .italic(row.hidden)
                .foregroundStyle(row.hidden ? HUD.dim : HUD.ink.opacity(row.marked || hovering ? 1 : 0.88))
                .lineLimit(1)
                .padding(.leading, 6)
                // How long it ran, as a line of light under its name: a
                // second axis, so the rail is a picture of the week and not
                // a list of names.
                .background(alignment: .bottomLeading) {
                    if row.span > 0 {
                        GeometryReader { box in
                            Capsule()
                                .fill(LinearGradient(colors: [(lit ?? HUD.accent).opacity(0.55), .clear],
                                                     startPoint: .leading, endPoint: .trailing))
                                .frame(width: max(8, GlassRail.spanWidth * row.span), height: 2)
                                .offset(x: 6, y: box.size.height + 3)
                        }
                        .accessibilityHidden(true)
                    }
                }
            Spacer(minLength: 10)
            if !row.clock.isEmpty {
                Text(row.clock)
                    .font(.system(size: 10.5))
                    .monospacedDigit()
                    .foregroundStyle(HUD.faint)
                    .lineLimit(1)
            }
            if let verb {
                GlassWord(label: verb.label) { verb.send(row.row) }
                    .padding(.leading, 4)
            }
        }
        // Under the pointer a row answers with light along its name, not a
        // grey highlight box.
        .background(alignment: .leading) {
            if pressable {
                LinearGradient(colors: [HUD.accent.opacity(0.14), .clear], startPoint: .leading,
                               endPoint: .trailing)
                    .frame(height: 1)
                    .offset(y: 13)
                    .padding(.leading, gutter + GlassRail.nodeColumn)
                    .opacity(hovering ? 1 : 0)
            }
        }
        .modifier(KeyboardRing(active: focused))
        .onHover { hovering = pressable && $0 }
        .animation(Motion.hover(reduced: reduceMotion), value: hovering)
    }
}
