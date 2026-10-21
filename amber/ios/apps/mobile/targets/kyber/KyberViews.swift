import SwiftUI

// KYBER'S FACE. Amber's warm palette (lib/theme.ts), sized for a keyboard: every
// tap target is at least 34 pt tall and the primary action in each tab is the
// one filled amber control on screen.

struct KTheme {
    let dark: Bool
    var bg: Color { dark ? Color(red: 0.086, green: 0.071, blue: 0.059) : Color(red: 0.953, green: 0.929, blue: 0.898) }
    var card: Color { dark ? Color(red: 0.141, green: 0.118, blue: 0.098) : .white }
    var key: Color { dark ? Color(red: 0.227, green: 0.196, blue: 0.169) : .white }
    var keyAlt: Color { dark ? Color(red: 0.165, green: 0.137, blue: 0.118) : Color(red: 0.863, green: 0.827, blue: 0.784) }
    var ink: Color { dark ? Color(red: 0.961, green: 0.937, blue: 0.909) : Color(red: 0.102, green: 0.086, blue: 0.071) }
    var muted: Color { dark ? Color(red: 0.612, green: 0.565, blue: 0.525) : Color(red: 0.541, green: 0.498, blue: 0.455) }
    var line: Color { dark ? Color.white.opacity(0.08) : Color.black.opacity(0.07) }
    static let warm = Color(red: 0.910, green: 0.584, blue: 0.290)
    static let bright = Color(red: 0.961, green: 0.663, blue: 0.384)
    static let onAmber = Color(red: 0.059, green: 0.051, blue: 0.043)
    static var amber: LinearGradient {
        LinearGradient(colors: [bright, warm], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - The crystal

/// A kyber crystal: a long hexagon, cut facets, amber light. Pulses while Amber
/// is working, which is the one motion in the keyboard that means "wait".
struct Crystal: View {
    var size: CGFloat = 18
    var pulsing = false
    @State private var glow = false

    var body: some View {
        ZStack {
            CrystalShape()
                .fill(KTheme.amber)
                .shadow(color: KTheme.warm.opacity(glow ? 0.9 : 0.35), radius: glow ? 6 : 2)
            CrystalShape()
                .stroke(Color.white.opacity(0.55), lineWidth: 0.6)
            Path { p in
                p.move(to: CGPoint(x: size * 0.36, y: size * 0.5))
                p.addLine(to: CGPoint(x: size * 0.36 * 0.55 + size * 0.32, y: size * 0.18))
                p.addLine(to: CGPoint(x: size * 0.5, y: size * 0.04))
            }
            .stroke(Color.white.opacity(0.7), lineWidth: 0.8)
        }
        .frame(width: size * 0.72, height: size)
        .onAppear { if pulsing { withAnimation(.easeInOut(duration: 0.8).repeatForever()) { glow = true } } }
        .accessibilityHidden(true)
    }
}

struct CrystalShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY + r.height * 0.22))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY + r.height * 0.78))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + r.height * 0.78))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + r.height * 0.22))
        p.closeSubpath()
        return p
    }
}

// MARK: - Shared controls

struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

struct AmberButton: View {
    let title: String
    var symbol: String?
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 13, weight: .bold)) }
                Text(title).font(.system(size: 15, weight: .semibold, design: .rounded))
            }
            .foregroundColor(KTheme.onAmber)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .background(KTheme.amber)
            .clipShape(Capsule())
        }
        .buttonStyle(PressStyle())
    }
}

struct QuietButton: View {
    let t: KTheme
    let title: String
    var symbol: String?
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 12, weight: .semibold)) }
                Text(title).font(.system(size: 14, weight: .medium, design: .rounded)).lineLimit(1).fixedSize()
            }
            .foregroundColor(t.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .background(t.card)
            .overlay(Capsule().stroke(t.line, lineWidth: 1))
            .clipShape(Capsule())
        }
        .buttonStyle(PressStyle())
    }
}

struct Avatar: View {
    let person: KPerson
    var size: CGFloat = 40
    var body: some View {
        Text(person.initials)
            .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
            .foregroundColor(.white)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [Color(hue: person.hue, saturation: 0.55, brightness: 0.92),
                                        Color(hue: person.hue, saturation: 0.7, brightness: 0.72)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .clipShape(Circle())
    }
}

// MARK: - Root

struct KyberRoot: View {
    @ObservedObject var model: KyberModel
    var t: KTheme { KTheme(dark: model.dark) }

    var body: some View {
        VStack(spacing: 0) {
            Rail(model: model, t: t)
            ZStack {
                switch model.tab {
                case .ask: AskView(model: model, t: t)
                case .people: PeopleView(model: model, t: t)
                case .plans: PlansView(model: model, t: t)
                case .split: SplitView(model: model, t: t)
                }
                if model.tab != .split, model.gate != .ok { GateView(model: model, t: t) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(t.bg)
        .overlay(alignment: .top) {
            if let toast = model.toast {
                Text(toast)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundColor(KTheme.onAmber)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(KTheme.amber).clipShape(Capsule())
                    .padding(.top, 46)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: model.toast)
        .preferredColorScheme(model.dark ? .dark : .light)
    }
}

struct Rail: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    var body: some View {
        HStack(spacing: 6) {
            Crystal(size: 18).padding(.leading, 10).padding(.trailing, 2)
            ForEach(KyberTab.allCases) { tab in
                let on = model.tab == tab
                Button { model.select(tab) } label: {
                    // Only the current tab is labelled: four labels and a globe do
                    // not fit a 375 pt phone ("People" rendered as "Peo...").
                    HStack(spacing: 4) {
                        Image(systemName: tab.symbol).font(.system(size: 13, weight: .bold))
                        if on { Text(tab.rawValue).font(.system(size: 13, weight: .semibold, design: .rounded)) }
                    }
                    .foregroundColor(on ? KTheme.onAmber : t.muted)
                    .padding(.horizontal, on ? 12 : 9)
                    .frame(minWidth: 38, minHeight: 32)
                    .background(on ? AnyShapeStyle(KTheme.amber) : AnyShapeStyle(Color.clear))
                    .clipShape(Capsule())
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel(tab.rawValue)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
            Spacer(minLength: 0)
            if model.needsGlobe {
                Button(action: model.nextKeyboard) {
                    Image(systemName: "globe").font(.system(size: 17)).foregroundColor(t.muted)
                        .frame(width: 40, height: 36)
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel("Next keyboard")
            }
        }
        .frame(height: 44)
    }
}

struct GateView: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    var body: some View {
        VStack(spacing: 10) {
            Crystal(size: 30)
            if model.gate == .needsFullAccess {
                Text("Turn on Full Access").font(.system(size: 17, weight: .bold, design: .rounded)).foregroundColor(t.ink)
                Text("Settings › General › Keyboard › Keyboards › Kyber › Allow Full Access. Kyber only talks to your own Amber account, and it never sees what you type unless you ask.")
                    .font(.system(size: 13)).foregroundColor(t.muted).multilineTextAlignment(.center)
            } else {
                Text("Sign in to Amber first").font(.system(size: 17, weight: .bold, design: .rounded)).foregroundColor(t.ink)
                Text("Open the Amber app once. Kyber uses the same account, so there's nothing else to set up.")
                    .font(.system(size: 13)).foregroundColor(t.muted).multilineTextAlignment(.center)
            }
            QuietButton(t: t, title: "Split a bill meanwhile", symbol: "dollarsign.circle") { model.select(.split) }
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(t.bg)
    }
}

// MARK: - Ask

struct AskView: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    var body: some View {
        if model.showingResult { AnswerView(model: model, t: t) } else { AskInput(model: model, t: t) }
    }
}

struct AskInput: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Group {
                    if model.query.isEmpty {
                        Text(model.draftPreview.isEmpty ? "Ask Amber, or tell it something to remember" : "Ask about what you wrote")
                            .foregroundColor(t.muted)
                    } else {
                        Text(model.query).foregroundColor(t.ink) + Text("|").foregroundColor(KTheme.warm)
                    }
                }
                .font(.system(size: 15, design: .rounded))
                .lineLimit(1)
                .truncationMode(.head)
                Spacer(minLength: 0)
                if !model.query.isEmpty {
                    Button { model.query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(t.muted)
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("Clear")
                } else if !model.draftPreview.isEmpty {
                    Button(action: model.askAboutDraft) {
                        Text("Use it").font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundColor(KTheme.onAmber).padding(.horizontal, 10).frame(height: 26)
                            .background(KTheme.amber).clipShape(Capsule())
                    }
                    .buttonStyle(PressStyle())
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(t.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 8)
            MiniKeys(t: t, text: $model.query, haptic: model.haptic, onAsk: { model.ask() }, onRemind: { model.remind() })
        }
    }
}

/// A compact QWERTY that types into Kyber's own question, not into the chat.
struct MiniKeys: View {
    let t: KTheme
    @Binding var text: String
    let haptic: () -> Void
    let onAsk: () -> Void
    let onRemind: () -> Void
    @State private var shift = true
    @State private var numbers = false

    private static let letters: [[String]] = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map { $0.map { String($0) } }
    private static let digits: [[String]] = [
        "1234567890".map { String($0) },
        ["-", "/", ":", ";", "(", ")", "$", "&", "@"],
        [".", ",", "?", "!", "'", "\""],
    ]

    var body: some View {
        VStack(spacing: 7) {
            ForEach(0..<3, id: \.self) { i in row(i) }
            bottomRow
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 4)
    }

    private func row(_ i: Int) -> some View {
        let keys: [String] = (numbers ? Self.digits : Self.letters)[i]
        let upper = shift && !numbers
        let shiftLabel = numbers ? "#+=" : (shift ? "shift.fill" : "shift")
        return HStack(spacing: 5) {
            if i == 2 {
                special(shiftLabel, symbol: !numbers, width: 42) {
                    if !numbers { shift.toggle() }
                }
            }
            ForEach(keys, id: \.self) { k in
                key(upper ? k.uppercased() : k)
            }
            if i == 2 {
                special("delete.left", symbol: true, width: 42) {
                    if !text.isEmpty { text.removeLast() }
                }
            }
        }
    }

    private var bottomRow: some View {
            HStack(spacing: 5) {
                special(numbers ? "ABC" : "123", symbol: false, width: 48) { numbers.toggle() }
                Button { tap(" ") } label: {
                    Text("space").font(.system(size: 14, design: .rounded)).foregroundColor(t.ink)
                        .frame(maxWidth: .infinity, minHeight: 38).background(t.key)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                }
                .buttonStyle(PressStyle())
                special("Remind", symbol: false, width: 66, action: onRemind)
                Button(action: onAsk) {
                    HStack(spacing: 3) {
                        Text("Ask").font(.system(size: 15, weight: .bold, design: .rounded))
                        Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold))
                    }
                    .foregroundColor(KTheme.onAmber).frame(width: 66, height: 38).background(KTheme.amber)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                }
                .buttonStyle(PressStyle())
            }
    }

    private func tap(_ s: String) {
        haptic()
        text += s
        if shift && !numbers && s != " " { shift = false }
        if s == "." || s == "?" || s == "!" { shift = true }
    }

    private func key(_ k: String) -> some View {
        Button { tap(k) } label: {
            Text(k).font(.system(size: 19, design: .rounded)).foregroundColor(t.ink)
                .frame(maxWidth: .infinity, minHeight: 38).background(t.key)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .shadow(color: .black.opacity(t.dark ? 0 : 0.12), radius: 0, y: 1)
        }
        .buttonStyle(PressStyle())
    }

    private func special(_ label: String, symbol: Bool, width: CGFloat, action: @escaping () -> Void) -> some View {
        Button { haptic(); action() } label: {
            Group {
                if symbol { Image(systemName: label).font(.system(size: 15, weight: .medium)) }
                else { Text(label).font(.system(size: 14, weight: .medium, design: .rounded)) }
            }
            .foregroundColor(t.ink).frame(width: width, height: 38).background(t.keyAlt)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(PressStyle())
    }
}

struct AnswerView: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 10) {
                    if let stage = model.stage {
                        HStack(spacing: 8) {
                            Crystal(size: 16, pulsing: true)
                            Text(stage).font(.system(size: 13, weight: .medium, design: .rounded)).foregroundColor(t.muted)
                        }
                    }
                    if let error = model.error {
                        Text(error).font(.system(size: 14)).foregroundColor(t.ink)
                    }
                    if let c = model.clarify {
                        Text(c.question).font(.system(size: 14, weight: .semibold)).foregroundColor(t.ink)
                        Flow(spacing: 6) {
                            ForEach(c.candidates) { p in QuietButton(t: t, title: p.name) { model.pick(p) } }
                        }
                    }
                    if !model.answer.isEmpty {
                        Text(model.insertableAnswer)
                            .font(.system(size: 15))
                            .foregroundColor(t.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    if !model.saved.isEmpty {
                        ForEach(model.saved) { r in
                            HStack(spacing: 8) {
                                Image(systemName: "bell.fill").foregroundColor(KTheme.warm)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(r.title).font(.system(size: 14, weight: .semibold)).foregroundColor(t.ink)
                                    Text(r.when?.formatted(date: .abbreviated, time: .shortened) ?? "On your list").font(.system(size: 12)).foregroundColor(t.muted)
                                }
                            }
                        }
                        Text("Saved to Amber. It'll ping you.").font(.system(size: 12)).foregroundColor(t.muted)
                    }
                    if !model.people.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(model.people) { p in
                                    Button { model.shareCard(p) } label: {
                                        HStack(spacing: 6) {
                                            Avatar(person: p, size: 24)
                                            Text(p.name).font(.system(size: 13, weight: .medium)).foregroundColor(t.ink)
                                            Image(systemName: "plus.circle.fill").font(.system(size: 12)).foregroundColor(KTheme.warm)
                                        }
                                        .padding(.leading, 4).padding(.trailing, 10).frame(height: 34)
                                        .background(t.card).clipShape(Capsule())
                                    }
                                    .buttonStyle(PressStyle())
                                    .accessibilityLabel("Insert \(p.name)")
                                }
                            }
                        }
                    }
                    ForEach(model.places) { place in
                        Button {
                            model.put([place.name, place.address, place.url].compactMap { $0 }.joined(separator: ", "))
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "mappin.circle.fill").font(.system(size: 20)).foregroundColor(KTheme.warm)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(place.name).font(.system(size: 14, weight: .semibold)).foregroundColor(t.ink)
                                    if let d = place.detail ?? place.address {
                                        Text(d).font(.system(size: 12)).foregroundColor(t.muted).lineLimit(1)
                                    }
                                }
                                Spacer()
                                Image(systemName: "arrow.down.to.line").font(.system(size: 12, weight: .semibold)).foregroundColor(t.muted)
                            }
                            .padding(10).background(t.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(PressStyle())
                    }
                    if !model.sources.isEmpty {
                        Text(model.sources.prefix(3).map(\.title).joined(separator: " · "))
                            .font(.system(size: 11)).foregroundColor(t.muted).lineLimit(2)
                    }
                    if !model.chips.isEmpty && !model.answering {
                        Flow(spacing: 6) {
                            ForEach(model.chips) { c in
                                QuietButton(t: t, title: c.label, symbol: "arrow.turn.down.right") { model.ask(c.prompt, followUp: true) }
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
            }
            HStack(spacing: 8) {
                QuietButton(t: t, title: "New", symbol: "chevron.left", action: model.backToInput)
                Spacer()
                if !model.answer.isEmpty && !model.answering {
                    AmberButton(title: "Insert", symbol: "arrow.down.to.line") { model.put(model.insertableAnswer) }
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
        }
    }
}

/// Wrapping row for chips, since a keyboard is too narrow for one line of them.
struct Flow: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
        }
        return CGSize(width: width, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

// MARK: - People

struct PeopleView: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 5)

    var body: some View {
        VStack(spacing: 6) {
            if let a = model.introFrom {
                HStack(spacing: 8) {
                    Image(systemName: "point.3.connected.trianglepath.dotted").foregroundColor(KTheme.warm)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Intro \(KyberGraph.firstName(a.name)) to…").font(.system(size: 14, weight: .semibold)).foregroundColor(t.ink)
                        Text("People outside their circles come first").font(.system(size: 11)).foregroundColor(t.muted)
                    }
                    Spacer()
                    QuietButton(t: t, title: "Cancel") { model.introFrom = nil }
                }
                .padding(.horizontal, 10)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        filter("Favorites", id: nil)
                        ForEach(model.circles) { c in filter(c.name, id: c.id) }
                        QuietButton(t: t, title: "My link", symbol: "link", action: model.shareMyLink)
                    }
                    .padding(.horizontal, 8)
                }
            }

            ZStack(alignment: .bottom) {
                ScrollView(showsIndicators: false) {
                    if model.introFrom != nil {
                        LazyVGrid(columns: columns, spacing: 8) {
                            ForEach(model.introOrder, id: \.person.id) { item in cell(item.person, bridge: item.bridge) }
                        }
                        .padding(.horizontal, 6)
                    } else if model.visiblePeople.isEmpty {
                        VStack(spacing: 6) {
                            if model.peopleLoading { Crystal(size: 22, pulsing: true) }
                            Text(model.peopleLoading ? "Loading your people" : (model.circleFilter == nil ? "Star people in Amber and they show up here." : "Nobody in this circle yet."))
                                .font(.system(size: 13)).foregroundColor(t.muted)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        LazyVGrid(columns: columns, spacing: 8) {
                            ForEach(model.visiblePeople) { p in cell(p, bridge: false) }
                        }
                        .padding(.horizontal, 6)
                        .padding(.bottom, model.selected == nil ? 0 : 90)
                    }
                }
                if let p = model.selected { tray(p) }
            }
        }
        .padding(.top, 2)
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: model.selected)
    }

    private func filter(_ title: String, id: String?) -> some View {
        let on = model.circleFilter == id
        return Button { model.haptic(); model.circleFilter = id; model.selected = nil } label: {
            Text(title).font(.system(size: 13, weight: .semibold, design: .rounded)).lineLimit(1).fixedSize()
                .foregroundColor(on ? KTheme.onAmber : t.ink)
                .padding(.horizontal, 12).frame(height: 32)
                .background(on ? AnyShapeStyle(KTheme.amber) : AnyShapeStyle(t.card))
                .clipShape(Capsule())
        }
        .buttonStyle(PressStyle())
    }

    private func cell(_ p: KPerson, bridge: Bool) -> some View {
        Button { model.tap(p) } label: {
            VStack(spacing: 3) {
                ZStack(alignment: .bottomTrailing) {
                    Avatar(person: p, size: 44)
                        .overlay(Circle().stroke(model.selected == p ? KTheme.warm : .clear, lineWidth: 2.5).padding(-3))
                    if bridge {
                        Image(systemName: "link.circle.fill").font(.system(size: 15))
                            .foregroundColor(KTheme.warm).background(Circle().fill(t.bg))
                    }
                }
                Text(KyberGraph.firstName(p.name)).font(.system(size: 11, weight: .medium)).foregroundColor(t.ink).lineLimit(1)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(bridge ? "\(p.name), outside their circles" : p.name)
    }

    private func tray(_ p: KPerson) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Avatar(person: p, size: 30)
                VStack(alignment: .leading, spacing: 0) {
                    Text(p.name).font(.system(size: 15, weight: .semibold)).foregroundColor(t.ink)
                    if let about = p.about { Text(about).font(.system(size: 12)).foregroundColor(t.muted).lineLimit(1) }
                }
                Spacer()
            }
            HStack(spacing: 6) {
                AmberButton(title: "Share", symbol: "arrow.down.to.line") { model.shareCard(p) }
                QuietButton(t: t, title: "Intro", symbol: "person.line.dotted.person") { model.startIntro(p) }
                QuietButton(t: t, title: "Ask", symbol: "sparkle") { model.askAbout(p) }
                QuietButton(t: t, title: "Later", symbol: "bell") { model.followUp(p) }
            }
        }
        .padding(10)
        .background(t.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 10, y: -2)
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// MARK: - Plans

struct PlansView: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("When you're free").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(t.ink)
                        Spacer()
                        Button { Task { await model.loadPlans(force: true) } } label: {
                            Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .semibold)).foregroundColor(t.muted)
                                .frame(width: 34, height: 34)
                        }
                        .buttonStyle(PressStyle())
                        .accessibilityLabel("Refresh")
                    }
                    if model.plansLoading && model.freeToday.isEmpty && model.freeTomorrow.isEmpty {
                        HStack(spacing: 8) { Crystal(size: 16, pulsing: true); Text("Reading your calendar").font(.system(size: 13)).foregroundColor(t.muted) }
                    } else {
                        Flow(spacing: 6) {
                            ForEach(Array(model.freeToday.enumerated()), id: \.offset) { _, w in window(w, day: "today") }
                            ForEach(Array(model.freeTomorrow.enumerated()), id: \.offset) { _, w in window(w, day: "tmrw") }
                        }
                        AmberButton(title: "Send my free times", symbol: "arrow.down.to.line") { model.put(model.freeSentence) }
                    }
                }
                .padding(12).background(t.card)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                day("Today", model.agendaToday, today: true)
                day("Tomorrow", model.agendaTomorrow, today: false)
            }
            .padding(8)
        }
    }

    private func window(_ w: FreeWindow, day: String) -> some View {
        QuietButton(t: t, title: "\(day) \(KyberFree.label(w))") {
            model.put("I'm free \(day == "tmrw" ? "tomorrow" : "today") \(KyberFree.label(w))")
        }
    }

    @ViewBuilder
    private func day(_ title: String, _ items: [KAgendaItem], today: Bool) -> some View {
        Text(title.uppercased()).font(.system(size: 11, weight: .bold)).foregroundColor(t.muted).padding(.leading, 4)
        if items.isEmpty {
            Text(model.plansLoading ? "…" : "Nothing on the calendar").font(.system(size: 13)).foregroundColor(t.muted).padding(.leading, 4)
        }
        ForEach(items) { item in
            Button { model.insertEvent(item, today: today) } label: {
                HStack(spacing: 10) {
                    Text(KyberFree.clock(item.start)).font(.system(size: 13, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundColor(KTheme.warm).frame(width: 58, alignment: .leading)
                    Image(systemName: item.isReminder ? "bell" : "circle.fill").font(.system(size: item.isReminder ? 11 : 6)).foregroundColor(t.muted)
                    Text(item.title).font(.system(size: 14)).foregroundColor(t.ink).lineLimit(1)
                    Spacer()
                }
                .padding(.horizontal, 10).frame(minHeight: 36).background(t.card)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(PressStyle())
        }
    }
}

// MARK: - Split

struct SplitView: View {
    @ObservedObject var model: KyberModel
    let t: KTheme
    private let pad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]
    private let whats = ["Dinner", "Uber", "Groceries", "Tickets"]

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                Text(model.splitAmount.isEmpty ? "$0" : "$" + model.splitAmount)
                    .font(.system(size: 32, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundColor(model.splitAmount.isEmpty ? t.muted : t.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(whats, id: \.self) { w in
                            let on = model.splitWhat == w
                            Button { model.splitWhat = on ? "" : w } label: {
                                Text(w).font(.system(size: 12, weight: .medium, design: .rounded)).fixedSize()
                                    .foregroundColor(on ? KTheme.onAmber : t.ink).padding(.horizontal, 9).frame(height: 28)
                                    .background(on ? AnyShapeStyle(KTheme.amber) : AnyShapeStyle(t.card)).clipShape(Capsule())
                            }
                            .buttonStyle(PressStyle())
                        }
                    }
                }
                HStack(spacing: 6) {
                    stepper("minus") { model.splitPeople = max(1, model.splitPeople - 1) }
                    Text("\(model.splitPeople) people").font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundColor(t.ink)
                        .frame(minWidth: 72)
                    stepper("plus") { model.splitPeople = min(30, model.splitPeople + 1) }
                }
                HStack(spacing: 4) {
                    ForEach([0, 15, 18, 20], id: \.self) { p in
                        let on = model.splitTip == p
                        Button { model.haptic(); model.splitTip = p } label: {
                            Text(p == 0 ? "No tip" : "\(p)%").font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundColor(on ? KTheme.onAmber : t.ink).frame(maxWidth: .infinity, minHeight: 30)
                                .background(on ? AnyShapeStyle(KTheme.amber) : AnyShapeStyle(t.card))
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(PressStyle())
                    }
                }
                Spacer(minLength: 0)
                if let r = model.splitResult {
                    Button(action: model.insertSplit) {
                        HStack {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(KyberSplit.money(r.each) + " each").font(.system(size: 17, weight: .bold, design: .rounded))
                                Text("of " + KyberSplit.money(r.total)).font(.system(size: 11, weight: .medium))
                            }
                            Spacer()
                            Image(systemName: "arrow.down.to.line").font(.system(size: 14, weight: .bold))
                        }
                        .foregroundColor(KTheme.onAmber).padding(.horizontal, 12).frame(height: 46)
                        .background(KTheme.amber).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("Insert the split")
                } else {
                    Text("Type the total").font(.system(size: 13)).foregroundColor(t.muted).frame(height: 46)
                }
            }
            .frame(maxWidth: .infinity)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 3), spacing: 5) {
                ForEach(pad, id: \.self) { k in
                    Button { model.splitKey(k) } label: {
                        Group {
                            if k == "⌫" { Image(systemName: "delete.left").font(.system(size: 16)) }
                            else { Text(k).font(.system(size: 22, weight: .medium, design: .rounded)) }
                        }
                        .foregroundColor(t.ink).frame(maxWidth: .infinity, minHeight: 50)
                        .background(k == "⌫" || k == "." ? t.keyAlt : t.key)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(PressStyle())
                }
            }
            .frame(width: 168)
        }
        .padding(8)
    }

    private func stepper(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button { model.haptic(); action() } label: {
            Image(systemName: symbol).font(.system(size: 13, weight: .bold)).foregroundColor(t.ink)
                .frame(width: 34, height: 34).background(t.card).clipShape(Circle())
        }
        .buttonStyle(PressStyle())
    }
}
