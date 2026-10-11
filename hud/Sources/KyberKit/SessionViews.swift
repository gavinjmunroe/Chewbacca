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

/// Read-only text shown as a diff: added lines on a green wash, removed on a
/// red one, hunk headers in the accent. The code inside a diff line is syntax
/// colored by the language its `+++` header names (or `path`, when the text
/// has no header), so the wash says what changed and the color says what it
/// is. Also what test output and `git status` are drawn in, monospaced and
/// selectable; text in no known language stays plain.
struct DiffView: View {
    let text: String
    var path: String = ""
    /// Terminal output: every line plain, no wash and no syntax, since a
    /// shell line starting with `-` or `+` is not a removal or an addition.
    var plain: Bool = false

    /// Drawn lines are capped: a 20,000-line diff is not read on a HUD, and
    /// laying it out stalls the glass. The tail is kept, where a test run's
    /// verdict is. Guessed, never measured.
    static let maxLines = 600

    enum Kind: Equatable { case added, removed, hunk, header, plain }

    struct Line: Identifiable {
        let id: Int
        let kind: Kind
        let body: AttributedString
    }

    static func kind(_ line: Substring) -> Kind {
        if line.hasPrefix("+++") || line.hasPrefix("---") { return .header }
        if line.hasPrefix("+") { return .added }
        if line.hasPrefix("-") { return .removed }
        if line.hasPrefix("@@") { return .hunk }
        return .plain
    }

    /// The file a header line names: `+++ b/x.swift`, `--- path`, or
    /// `diff --git a/x b/x`. Nil for any other line.
    static func headerPath(_ line: Substring) -> String? {
        if line.hasPrefix("diff --git ") {
            return line.split(separator: " ").last.map(String.init)
        }
        guard line.hasPrefix("+++ ") || line.hasPrefix("--- ") else { return nil }
        let rest = line.dropFirst(4).split(separator: "\t").first.map(String.init) ?? ""
        return rest == "/dev/null" ? nil : rest
    }

    /// Every drawn line with its color worked out once. A line of code in a
    /// known language becomes its marker (`+`, `-`, or the context space)
    /// followed by syntax-colored tokens.
    static func lines(_ text: String, path: String, plain: Bool = false) -> [Line] {
        let all = text.split(separator: "\n", omittingEmptySubsequences: false)
        if plain {
            let start = max(0, all.count - maxLines)
            return all.enumerated().dropFirst(start).map { index, line in
                var body = AttributedString(line.isEmpty ? " " : String(line))
                body.foregroundColor = color(.plain)
                return Line(id: index, kind: .plain, body: body)
            }
        }
        var language = Syntax.language(forPath: path)
        var state = Syntax.State()
        var out: [Line] = []
        let start = max(0, all.count - maxLines)
        for (index, line) in all.enumerated() {
            let kind = Self.kind(line)
            if let named = headerPath(line) {
                language = Syntax.language(forPath: named) ?? language
                state = Syntax.State()
            }
            if kind == .hunk { state = Syntax.State() }
            // Scanned even when not drawn, so a block comment opened above
            // the cut still closes in the right place.
            var body: AttributedString
            if let language, kind == .added || kind == .removed || (kind == .plain && line.hasPrefix(" ")) {
                let code = String(line.dropFirst())
                var marker = AttributedString(String(line.prefix(1)))
                marker.foregroundColor = kind == .added ? HUD.good : kind == .removed ? HUD.bad : HUD.faint
                body = marker + Syntax.attributed(Syntax.tokens(code, language, state: &state))
            } else {
                body = AttributedString(line.isEmpty ? " " : String(line))
                body.foregroundColor = color(kind)
            }
            if index >= start { out.append(Line(id: index, kind: kind, body: body)) }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.lines(text, path: path, plain: plain)) { line in
                Text(line.body)
                    .font(.system(size: 11, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
                    .background(Self.background(line.kind))
            }
        }
        .textSelection(.enabled)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    static func color(_ kind: Kind) -> Color {
        switch kind {
        case .added: return HUD.good
        case .removed: return HUD.bad
        case .hunk: return HUD.accent
        case .header: return HUD.ink
        case .plain: return HUD.ink.opacity(0.82)
        }
    }

    static func background(_ kind: Kind) -> Color {
        switch kind {
        case .added: return HUD.good.opacity(0.14)
        case .removed: return HUD.bad.opacity(0.14)
        default: return .clear
        }
    }
}

/// The tree beside a session card: what the session touched plus one level
/// of context, never the whole repo (docs/plans/NO-APPS.md, "The HUD IDE").
///
/// `items` are `{"id","name","depth","dir"}` with optional `"mark"` (git's
/// status letters, or `edited` / `read` from the transcript), `"collapsed"`
/// on a folder drawn shut, and `"note"` on the closing "N more" line. A file
/// row is a press that sends `e action <action> row=<id>`; folders and the
/// note are not pressable. Names came from a repo and a transcript, so they
/// are drawn as plain text and nothing else.
struct TreeView: View {
    struct Row: Identifiable, Equatable {
        let id: String
        let name: String
        let depth: Int
        let isDir: Bool
        let mark: String
        let collapsed: Bool
        let note: Bool
    }

    let rows: [Row]
    let onOpen: ((String) -> Void)?

    /// Indent per level. Twelve points keeps eight levels inside a 320-point
    /// panel with the name still readable. Guessed, never measured.
    static let indent: CGFloat = 12

    static func rows(_ json: [JSON]) -> [Row] {
        json.compactMap { entry in
            guard let o = entry.objectValue, let id = o["id"]?.display, !id.isEmpty else { return nil }
            return Row(
                id: id,
                name: String((o["name"]?.display ?? "").prefix(120)),
                depth: min(max(Int(o["depth"]?.doubleValue ?? 0), 0), 16),
                isDir: o["dir"] == .bool(true),
                mark: String((o["mark"]?.display ?? "").prefix(8)),
                collapsed: o["collapsed"] == .bool(true),
                note: o["note"] == .bool(true))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if rows.isEmpty {
                Text("Nothing touched yet")
                    .font(.system(size: 12))
                    .foregroundStyle(HUD.faint)
            }
            ForEach(rows) { row in
                if row.isDir || row.note || onOpen == nil {
                    label(row)
                } else if let onOpen {
                    Button { onOpen(row.id) } label: { label(row).contentShape(Rectangle()) }
                        .buttonStyle(RowButtonStyle())
                        .accessibilityLabel("Open \(row.name)\(row.mark.isEmpty ? "" : ", \(Self.markWords(row.mark))")")
                }
            }
        }
    }

    private func label(_ row: Row) -> some View {
        HStack(spacing: 5) {
            Image(systemName: row.note ? "ellipsis" : row.isDir ? (row.collapsed ? "folder" : "folder.fill") : "doc.text")
                .font(.system(size: 9.5))
                .foregroundStyle(row.isDir ? HUD.accent.opacity(0.8) : HUD.faint)
                .frame(width: 13)
            Text(row.name + (row.isDir ? "/" : ""))
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(row.note ? HUD.faint : row.mark.isEmpty ? HUD.dim : HUD.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 4)
            if !row.mark.isEmpty {
                Text(Self.markLabel(row.mark))
                    .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Self.markColor(row.mark))
            }
        }
        .padding(.leading, CGFloat(row.depth) * Self.indent)
        .padding(.vertical, 3)
        .frame(minHeight: 22)
    }

    static func markLabel(_ mark: String) -> String {
        switch mark {
        case "edited": return "edit"
        case "read": return "read"
        default: return mark
        }
    }

    static func markWords(_ mark: String) -> String {
        switch mark {
        case "edited": return "edited by the session"
        case "read": return "read by the session"
        case "?", "??", "A": return "new"
        case "D": return "deleted"
        default: return "changed"
        }
    }

    static func markColor(_ mark: String) -> Color {
        switch mark {
        case "read": return HUD.faint
        case "edited": return HUD.accent
        case "?", "??", "A": return HUD.good
        case "D": return HUD.bad
        default: return HUD.warn
        }
    }
}
