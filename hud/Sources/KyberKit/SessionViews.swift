import SwiftUI

/// A coding session's conversation, on a card like any other.
///
/// `items` are `{"id","role","text"}` with role `user`, `assistant`, `tool`
/// or `error`; a tool row may carry `"tool"` and `"open": true`. Everything in
/// it came from a transcript and is untrusted: it is drawn as plain text,
/// never as markdown links or anything that can be pressed, except the one
/// fold on a tool row, which sends `e action open row=<id>` for its owner to
/// decide what to show.
///
/// The shape follows the conversation in Carlton Aikins' realm (read as a
/// design reference; no code from it): the person's turns stand apart, the
/// agent's prose reads as prose, and its tool calls fold to one line each so
/// a long run is a scan, not a scroll.
struct TranscriptView: View {
    struct Item: Identifiable, Equatable {
        let id: String
        let role: String
        let text: String
        let tool: String
        let canOpen: Bool
    }

    let items: [Item]
    let onOpen: ((String) -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static func items(_ json: [JSON]) -> [Item] {
        json.compactMap { entry in
            guard let o = entry.objectValue, let id = o["id"]?.display, !id.isEmpty else { return nil }
            return Item(
                id: id,
                role: o["role"]?.stringValue ?? "assistant",
                text: String((o["text"]?.display ?? "").prefix(4000)),
                tool: o["tool"]?.stringValue ?? "",
                canOpen: o["open"] == .bool(true))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if items.isEmpty {
                Text("No turns yet")
                    .font(.system(size: 12))
                    .foregroundStyle(HUD.faint)
            }
            ForEach(items) { item in
                row(item)
                    .transition(RowKeys.transition(reduced: reduceMotion))
            }
        }
    }

    @ViewBuilder
    private func row(_ item: Item) -> some View {
        switch item.role {
        case "user":
            Text(item.text)
                .font(.system(size: 12.5))
                .foregroundStyle(HUD.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 40)
                .accessibilityLabel("You: \(item.text)")
        case "tool":
            toolRow(item)
        case "error":
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "xmark.octagon.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(HUD.bad)
                Text(item.text)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(HUD.dim)
                    .lineLimit(3)
            }
        default:
            Text(item.text)
                .font(.system(size: 12.5))
                .foregroundStyle(HUD.ink.opacity(0.92))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func toolRow(_ item: Item) -> some View {
        HStack(spacing: 6) {
            Image(systemName: Self.symbol(item.tool))
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(HUD.accent.opacity(0.85))
                .frame(width: 14)
            Text(item.text)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(HUD.dim)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 4)
            if item.canOpen, let onOpen {
                Button { onOpen(item.id) } label: {
                    Text(item.tool == "Read" ? "Open" : "Diff")
                        .font(.system(size: 10.5, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.quaternary, in: Capsule())
                        .frame(minWidth: 44, minHeight: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityLabel("\(item.tool == "Read" ? "Open" : "Diff") \(item.text)")
            }
        }
        .padding(.vertical, 1)
    }

    static func symbol(_ tool: String) -> String {
        switch tool {
        case "Bash": return "terminal"
        case "Read": return "doc.text"
        case "Edit", "MultiEdit", "Write": return "pencil"
        case "Grep", "Glob": return "magnifyingglass"
        case "WebFetch", "WebSearch": return "globe"
        case "Agent", "Task": return "person.2"
        default: return "wrench.and.screwdriver"
        }
    }
}

/// Read-only text shown as a diff: added lines green, removed red, hunk
/// headers in the accent, everything else plain. Also what test output and
/// `git status` are drawn in, monospaced and selectable.
struct DiffView: View {
    let text: String

    /// Drawn lines are capped: a 20,000-line diff is not read on a HUD, and
    /// laying it out stalls the glass. The tail is kept, where a test run's
    /// verdict is. Guessed, never measured.
    static let maxLines = 600

    enum Kind: Equatable { case added, removed, hunk, header, plain }

    static func kind(_ line: Substring) -> Kind {
        if line.hasPrefix("+++") || line.hasPrefix("---") { return .header }
        if line.hasPrefix("+") { return .added }
        if line.hasPrefix("-") { return .removed }
        if line.hasPrefix("@@") { return .hunk }
        return .plain
    }

    private var lines: [(Int, Substring)] {
        let all = text.split(separator: "\n", omittingEmptySubsequences: false)
        return Array(all.suffix(Self.maxLines).enumerated())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(lines, id: \.0) { _, line in
                let kind = Self.kind(line)
                Text(line.isEmpty ? " " : String(line))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(color(kind))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .background(background(kind))
            }
        }
        .textSelection(.enabled)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func color(_ kind: Kind) -> Color {
        switch kind {
        case .added: return HUD.good
        case .removed: return HUD.bad
        case .hunk: return HUD.accent
        case .header: return HUD.ink
        case .plain: return HUD.ink.opacity(0.82)
        }
    }

    private func background(_ kind: Kind) -> Color {
        switch kind {
        case .added: return HUD.good.opacity(0.12)
        case .removed: return HUD.bad.opacity(0.12)
        default: return .clear
        }
    }
}
