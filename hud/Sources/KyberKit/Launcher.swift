import AppKit
import SwiftUI

/// Lanes inside a card: Ready 17, Cooking, Stuck 14, Done 8.
///
/// Bound to a pointer like a Select, so a press writes locally at once and
/// the selected lane is drawn before anything answers. It also sends the
/// row-action line, so a daemon can swap the rows under it:
/// `e action <action> row=<option id> surface=<surface>`.
struct SegmentedView: View {
    struct Option: Identifiable, Equatable {
        let id: String
        let label: String
        let count: String?
    }

    let options: [Option]
    let selected: String
    let onPick: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var lane

    static func options(_ json: [JSON]) -> [Option] {
        json.compactMap { item in
            if let text = item.stringValue { return Option(id: text, label: text, count: nil) }
            guard let object = item.objectValue else { return nil }
            let label = object["label"]?.display ?? object["id"]?.display ?? ""
            let id = object["id"]?.display ?? label
            guard !id.isEmpty else { return nil }
            let count = object["count"].map(\.display).flatMap { $0.isEmpty ? nil : $0 }
            return Option(id: id, label: label, count: count)
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options) { option in
                let isOn = option.id == selected
                Button { onPick(option.id) } label: {
                    HStack(spacing: 5) {
                        Text(option.label)
                            .font(.system(size: 11.5, weight: isOn ? .semibold : .medium))
                        if let count = option.count {
                            Text(count)
                                .font(.system(size: 10, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(isOn ? HUD.ink : HUD.faint)
                                .contentTransition(.numericText())
                        }
                    }
                    .foregroundStyle(isOn ? HUD.ink : HUD.dim)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: HitTarget.minimum)
                    .background {
                        // One selection pill that travels between lanes,
                        // rather than each lane fading its own in: the eye
                        // follows one thing moving.
                        if isOn {
                            Capsule()
                                .fill(.white.opacity(0.14))
                                .padding(.vertical, 8)
                                .matchedGeometryEffect(id: "lane", in: lane)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityLabel(option.count.map { "\(option.label), \($0)" } ?? option.label)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
        .padding(.horizontal, 2)
        .background(.white.opacity(0.05), in: Capsule())
        .animation(Motion.snappy(reduced: reduceMotion), value: selected)
    }
}

/// A person, as initials in a circle, or their picture when there is one.
///
/// Small on purpose: an avatar on a HUD row says who in the time it takes
/// to read a name, and anything bigger is decoration.
struct AvatarView: View {
    let name: String
    let image: String?
    let size: CGFloat

    /// "Sam Lee" is SL, "ava" is A, "Mac & Cheese" is MC. Two letters at
    /// most, so a long name does not overflow a 24-point circle.
    static func initials(_ name: String) -> String {
        let words = name.split { !$0.isLetter && !$0.isNumber }.filter { !$0.isEmpty }
        let letters = words.prefix(2).compactMap(\.first).map { String($0).uppercased() }
        return letters.joined()
    }

    /// A hue from the name, so the same person is always the same colour
    /// and two people next to each other usually are not. Muted, because a
    /// row of saturated circles is louder than the rows they label.
    static func hue(_ name: String) -> Double {
        let sum = name.unicodeScalars.reduce(UInt32(7)) { ($0 &* 31) &+ $1.value }
        return Double(sum % 360) / 360
    }

    private var picture: NSImage? {
        guard let image, !image.isEmpty else { return nil }
        return NSImage(contentsOfFile: (image as NSString).expandingTildeInPath)
    }

    var body: some View {
        Group {
            if let picture {
                Image(nsImage: picture).resizable().scaledToFill()
            } else {
                Circle()
                    .fill(Color(hue: Self.hue(name), saturation: 0.35, brightness: 0.55))
                    .overlay {
                        Text(Self.initials(name))
                            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
                            .foregroundStyle(HUD.ink)
                    }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
    }
}

/// The launcher: a vertical rail of surfaces on one frosted capsule, each an
/// icon in a well with an optional count, meant for the right edge:
/// `@ rail at=right w=52 chrome=bare`. No text on the rail; the name shows
/// beside it on hover. `selected` fills a well, `open` puts a dot under it.
///
/// Every badge is bound to `/badges/<id>` in the rail's own data, so the
/// daemon keeps a count current with one short `d` line. A press sends
/// `e action open row=<id> surface=<surface>`, and the daemon opens that
/// surface; the rail itself opens nothing.
struct RailView: View {
    struct Entry: Identifiable {
        let id: String
        let label: String
        let symbol: String
        let badge: String?
        let isOpen: Bool
        var isSelected = false
    }

    let entries: [Entry]
    let onOpen: (String) -> Void

    /// `open` on an item (`{"id":"mail","open":true}`) lights it: the rail
    /// cannot see other surfaces, so whoever opens them says so.
    static func entries(_ items: [JSON], data: [String: JSON]) -> [Entry] {
        items.compactMap { item in
            guard let object = item.objectValue,
                  let id = object["id"]?.display, !id.isEmpty
            else { return nil }
            let badge = badgeCount(Pointer.get(data, "/badges/\(id)")).map(String.init)
            return Entry(
                id: id,
                label: object["label"]?.display ?? id.capitalized,
                symbol: object["symbol"]?.stringValue ?? "square.grid.2x2",
                badge: badge,
                isOpen: object["open"] == .bool(true) || object["selected"] == .bool(true),
                isSelected: object["selected"] == .bool(true))
        }
    }

    /// Where the pointer is, for the label that appears beside the rail.
    @State private var hovered: String?
    /// Folded to a slim handle while nobody is using it, so an idle rail
    /// never sits over the text of the window under it. Hovering the handle
    /// opens it; a badge going up opens it for a moment.
    @State private var tucked = false
    @State private var idleTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudOffscreen) private var offscreen

    /// How long an untouched rail stays open before it tucks away. Guessed,
    /// never measured: long enough to read a new badge, short enough that it
    /// is gone before the eye goes back to the work.
    static let idleTuck: Duration = .seconds(4)
    /// The well: a rounded square, inside the 44-point floor once the gap
    /// between wells is counted.
    static let well: CGFloat = 38
    static let radius: CGFloat = 16

    var body: some View {
        Group {
            if tucked && !offscreen {
                handle
            } else {
                wells
            }
        }
        // Two more below and above than beside: an open dot under the last
        // well sat on the rim at 7 (offscreen render, 2026-10-04).
        .padding(.horizontal, tucked && !offscreen ? 4 : 7)
        .padding(.vertical, tucked && !offscreen ? 4 : 10)
        .background { capsule }
        .overlay(alignment: .leading) { hoverLabel }
        .onHover { inside in
            if inside {
                idleTask?.cancel()
                withAnimation(Motion.snappy(reduced: reduceMotion)) { tucked = false }
            } else {
                hovered = nil
                scheduleTuck()
            }
        }
        .onAppear { scheduleTuck() }
        .onChange(of: entries.map(\.badgeCount)) { old, new in
            // A count went up: show it, then tuck again.
            guard zip(old, new).contains(where: { ($1 ?? 0) > ($0 ?? 0) }) else { return }
            withAnimation(Motion.snappy(reduced: reduceMotion)) { tucked = false }
            scheduleTuck()
        }
        .animation(Motion.snappy(reduced: reduceMotion), value: tucked)
    }

    private func scheduleTuck() {
        idleTask?.cancel()
        idleTask = Task { @MainActor in
            try? await Task.sleep(for: Self.idleTuck)
            guard !Task.isCancelled else { return }
            withAnimation(Motion.smooth(reduced: reduceMotion)) { tucked = true }
        }
    }

    /// One frosted capsule with a light rim, the glass the rest of the
    /// HUD is made of, so the icons stand on a surface instead of floating
    /// over whatever window is under them (Caleb, 2026-10-04: "Ts so ugly").
    private var capsule: some View {
        let shape = RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
        return ZStack {
            VisualEffect(material: .hudWindow, blending: .behindWindow)
            Color.black.opacity(0.42)
        }
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(
                LinearGradient(
                    colors: [.white.opacity(0.32), .white.opacity(0.08), .white.opacity(0.18)],
                    startPoint: .top, endPoint: .bottom),
                lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
        .environment(\.colorScheme, .dark)
    }

    /// Tucked: a slim bar with one dot if anything wants attention.
    private var handle: some View {
        VStack(spacing: 5) {
            Capsule().fill(.white.opacity(0.45)).frame(width: 3, height: 28)
            if entries.contains(where: { $0.badgeCount != nil }) {
                Circle().fill(HUD.accent).frame(width: 5, height: 5)
            }
        }
        .frame(width: 10)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .accessibilityLabel("Surfaces")
    }

    private var wells: some View {
        VStack(spacing: 8) {
            ForEach(entries) { entry in
                Button { onOpen(entry.id) } label: { well(entry) }
                    .buttonStyle(RowButtonStyle())
                    .onHover { inside in hovered = inside ? entry.id : (hovered == entry.id ? nil : hovered) }
                    .help(entry.label)
                    .accessibilityLabel(
                        entry.badgeCount.map { "\(entry.label), \($0)" } ?? entry.label)
                    .accessibilityAddTraits(entry.isSelected ? .isSelected : [])
            }
        }
    }

    private func well(_ entry: Entry) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return Image(systemName: entry.symbol)
            .font(.system(size: 16, weight: .medium))
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(entry.isSelected ? HUD.ink : HUD.dim)
            .frame(width: Self.well, height: Self.well)
            .background {
                shape.fill(.white.opacity(entry.isSelected ? 0.2 : (hovered == entry.id ? 0.1 : 0)))
            }
            // The badge sits on the well's own corner, inside the rail's
            // padding, so it never reaches the next well.
            .overlay(alignment: .topTrailing) {
                if let count = entry.badgeCount {
                    Text(RailView.badgeText(count))
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.black.opacity(0.85))
                        .padding(.horizontal, 3.5)
                        .frame(minWidth: 14, minHeight: 14)
                        .background(HUD.accent, in: Capsule())
                        .offset(x: 4, y: -4)
                        .contentTransition(.numericText(value: Double(count)))
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
            }
            // Open but not the one in front: a dot under the well.
            .overlay(alignment: .bottom) {
                if entry.isOpen && !entry.isSelected {
                    Circle().fill(HUD.ink.opacity(0.75)).frame(width: 4, height: 4).offset(y: 5)
                }
            }
            .contentShape(Rectangle())
    }

    /// The name of the well under the pointer, beside the rail, not on it.
    @ViewBuilder
    private var hoverLabel: some View {
        if let id = hovered, let entry = entries.first(where: { $0.id == id }), !tucked {
            Text(entry.label)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(HUD.ink)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background {
                    Capsule().fill(.black.opacity(0.78))
                        .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 0.5))
                }
                .fixedSize()
                .alignmentGuide(.leading) { $0.width + 8 }
                .transition(.opacity)
                .allowsHitTesting(false)
        }
    }

    /// A count as a badge reads it: up to 9, then "9+".
    static func badgeText(_ count: Int) -> String { count > 9 ? "9+" : String(count) }

    /// A badge only for a whole number above zero. 0, null, "no", a
    /// fraction or an error string all hide it: on 2026-10-04 a badge
    /// read "no" on the glass.
    static func badgeCount(_ value: JSON?) -> Int? {
        let number: Double?
        switch value {
        case .number(let n)?: number = n
        case .string(let s)?: number = Int(s.trimmingCharacters(in: .whitespaces)).map(Double.init)
        default: number = nil
        }
        guard let n = number, n >= 1, n == n.rounded(), n < 1e9 else { return nil }
        return Int(n)
    }
}

extension RailView.Entry {
    var badgeCount: Int? { badge.flatMap(Int.init) }
}
