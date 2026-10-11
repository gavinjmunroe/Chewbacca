import SwiftUI

/// Agents as tiles, and the providers as chips: what the agents surface
/// (bin/lib/surfaces/agents.py) draws instead of rows of text.
///
/// Caleb, 2026-10-10, of the agents panel drawn from Events rows and Metrics:
/// "how is anyone supposed to be able to comprehend this 1 dimensional ah
/// ui/ux". A row says one thing in one colour; an agent has four facts worth a
/// glance (who runs it, what it is, whether it needs you, what it is doing),
/// and a tile gives each its own place, so the eye finds the one that needs it
/// without reading.
///
///     c t Tiles items=@/agents/tiles counts=@/agents/counts action=ks-pick
///     d /agents/tiles [{"id":"s1","title":"Fix the rail","detail":"Bash: npm test",
///                       "state":"needs","provider":"claude","name":"Claude","meta":"chewbacca · 2m"}]
///     c c Chips options=@/agents/kinds value=@/agents/agent action=ks-agent
///
/// A press on a tile sends the row-action line with the tile's id, as a row's
/// button does, so the daemon reads one format.
///
/// COLOUR. Two kinds, never mixed. The provider's own colour is on its mark
/// only (a filled circle with its initial), so the same agent looks the same
/// everywhere. The state's colour is on the chip and, for a tile that needs
/// the person, on its edge and glow; it uses the HUD's own tones, so needs
/// you is the same amber here as on a Metric. Text stays ink.
enum AgentPalette {
    /// Each provider's mark. Brand-near, lightened until each holds 3:1 as a
    /// graphic against the glass's worst documented ground (Glass.swift,
    /// L 0.087 over a white page); `AgentTilesTests` measures them.
    static let providers: [String: (red: Double, green: Double, blue: Double)] = [
        "claude": (0.93, 0.56, 0.42),
        "codex": (0.30, 0.80, 0.62),
        "acp:gemini": (0.52, 0.68, 1.00),
        "acp:cursor": (0.85, 0.86, 0.88),
        "acp:copilot": (0.74, 0.62, 1.00),
        "acp:grok": (0.95, 0.95, 0.95),
        "acp:qwen": (0.70, 0.66, 1.00),
        "acp:opencode": (0.98, 0.78, 0.40),
        "acp:goose": (0.98, 0.98, 0.78),
    ]

    static func provider(_ key: String) -> Color {
        if let c = providers[key] { return Color(red: c.red, green: c.green, blue: c.blue) }
        // An agent added later: a light hue from its name, never dim.
        return Color(hue: AvatarView.hue(key), saturation: 0.45, brightness: 0.98)
    }

    /// A state's tone, its word for a reader who does not see colour, and
    /// its symbol.
    static func state(_ name: String) -> (tone: Color, word: String, symbol: String) {
        switch name {
        case "needs": return (HUD.warn, "Needs you", "exclamationmark.triangle.fill")
        case "failed": return (HUD.warn, "Failed", "xmark.circle.fill")
        case "running": return (HUD.accent, "Working", "circle.dotted")
        default: return (HUD.good, "Done", "checkmark.circle.fill")
        }
    }

    /// WCAG relative luminance of an sRGB colour, for the tests.
    static func luminance(_ r: Double, _ g: Double, _ b: Double) -> Double {
        func lin(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
}

struct AgentTile: Identifiable, Equatable {
    let id: String
    let title: String
    let detail: String
    let state: String
    let provider: String
    let name: String
    let meta: String
    let selected: Bool

    var initial: String { String(name.first.map { String($0).uppercased() } ?? "?") }

    static func parse(_ items: [JSON]) -> [AgentTile] {
        zip(items, RowKeys.keys(items)).compactMap { item, key in
            guard let o = item.objectValue else { return nil }
            return AgentTile(
                id: RowKeys.id(of: item) ?? key,
                title: o["title"]?.display ?? "",
                detail: o["detail"]?.display ?? "",
                state: o["state"]?.display ?? "done",
                provider: o["provider"]?.display ?? "",
                name: o["name"]?.display ?? "Agent",
                meta: o["meta"]?.display ?? "",
                selected: o["selected"] == .bool(true))
        }
    }
}

struct AgentTilesView: View {
    let tiles: [AgentTile]
    /// needs, running, done: drawn as one line of toned counts over the
    /// grid, each only when it is above zero.
    let counts: [String: Int]
    let onOpen: ((String) -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let columns = [GridItem(.flexible(), spacing: 8, alignment: .top),
                                  GridItem(.flexible(), spacing: 8, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            let shown = [("needs", "need you"), ("running", "working"), ("done", "done")]
                .filter { (counts[$0.0] ?? 0) > 0 }
            if !shown.isEmpty {
                HStack(spacing: 14) {
                    ForEach(shown, id: \.0) { key, word in
                        let tone = AgentPalette.state(key).tone
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(counts[key] ?? 0)")
                                .font(.system(size: 20, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(tone)
                                .contentTransition(.numericText())
                            Text(word)
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(HUD.dim)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            LazyVGrid(columns: Self.columns, alignment: .leading, spacing: 8) {
                ForEach(tiles) { tile in
                    TileView(tile: tile, onOpen: onOpen)
                        .transition(RowKeys.transition(reduced: reduceMotion))
                }
            }
        }
        .animation(Motion.snappy(reduced: reduceMotion), value: tiles)
    }
}

struct TileView: View {
    let tile: AgentTile
    let onOpen: ((String) -> Void)?
    @Environment(\.hudFocusedRow) private var focusedRow
    @State private var hovering = false

    private var loud: Bool { tile.state == "needs" || tile.state == "failed" }

    var body: some View {
        let state = AgentPalette.state(tile.state)
        Button {
            onOpen?(tile.id)
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(AgentPalette.provider(tile.provider))
                        .frame(width: 18, height: 18)
                        .overlay {
                            Text(tile.initial)
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundStyle(Color.black.opacity(0.85))
                        }
                    Text(tile.name)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(HUD.dim)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    HStack(spacing: 3) {
                        Image(systemName: state.symbol).font(.system(size: 10, weight: .semibold))
                        Text(state.word).font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(state.tone)
                    .lineLimit(1)
                }
                Text(tile.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(HUD.ink)
                    .lineLimit(1)
                if !tile.detail.isEmpty {
                    Text(tile.detail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(loud ? HUD.ink.opacity(0.9) : HUD.dim)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !tile.meta.isEmpty {
                    Text(tile.meta)
                        .font(.system(size: 11))
                        .foregroundStyle(HUD.faint)
                        .lineLimit(1)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: HitTarget.minimum, alignment: .topLeading)
            .background {
                // Dark, not light: a lighter fill lifts the ground under the
                // state word, and amber on it fell under 4.5:1 in the sums.
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.black.opacity(hovering ? 0.10 : 0.18))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        loud ? state.tone.opacity(0.9) : (tile.selected ? Color.white.opacity(0.35) : .clear),
                        lineWidth: loud ? 1.5 : 1)
            }
            .shadow(color: loud ? state.tone.opacity(0.35) : .clear, radius: 8)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(RowButtonStyle())
        .disabled(onOpen == nil)
        .onHover { hovering = $0 }
        .modifier(KeyboardRing(active: focusedRow == tile.id))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(tile.title), \(tile.name), \(state.word)")
        .accessibilityValue([tile.detail, tile.meta].filter { !$0.isEmpty }.joined(separator: ". "))
        .accessibilityAddTraits(.isButton)
    }
}

/// The installed agents, one small chip each with the provider's colour. A
/// press writes the pick locally, so it shows at once, and sends the
/// row-action line with the chip's id.
struct AgentChip: Identifiable, Equatable {
    let id: String
    let label: String

    static func parse(_ items: [JSON]) -> [AgentChip] {
        items.compactMap { item in
            if let text = item.stringValue { return AgentChip(id: text, label: text) }
            guard let id = RowKeys.id(of: item) else { return nil }
            return AgentChip(id: id, label: item.objectValue?["label"]?.display ?? id)
        }
    }
}

struct AgentChipsView: View {
    let chips: [AgentChip]
    let selected: String
    let onPick: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudFocusedRow) private var focusedRow

    var body: some View {
        HStack(spacing: 6) {
            ForEach(chips) { chip in
                let on = chip.id == selected
                Button { onPick(chip.id) } label: {
                    HStack(spacing: 5) {
                        Circle().fill(AgentPalette.provider(chip.id)).frame(width: 8, height: 8)
                        Text(chip.label).font(.system(size: 11.5, weight: on ? .semibold : .medium))
                    }
                    .foregroundStyle(on ? HUD.ink : HUD.dim)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(on ? 0.14 : 0.05), in: Capsule())
                    .overlay(Capsule().strokeBorder(
                        on ? AgentPalette.provider(chip.id).opacity(0.8) : .clear, lineWidth: 1))
                    .frame(minHeight: HitTarget.minimum)
                    .contentShape(Rectangle())
                }
                .buttonStyle(RowButtonStyle())
                .modifier(KeyboardRing(active: focusedRow == chip.id))
                .accessibilityLabel(chip.label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .animation(Motion.snappy(reduced: reduceMotion), value: selected)
    }
}
