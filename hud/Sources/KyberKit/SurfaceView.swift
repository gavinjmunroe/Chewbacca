import SwiftUI

/// Renders a streamed spec as native SwiftUI.
///
/// This is the piece that does not exist anywhere else. Every generative UI
/// system renders to HTML, because HTML is what a model already knows how to
/// emit and what a browser already knows how to draw. Rendering the same stream
/// as native views means no browser, no WebView, no bundle, and a window that
/// can float over everything and take the system's own typography and materials.
///
/// The rules are the same three the web renderer follows, and they matter more
/// here rather than less, because a HUD is glanced at rather than read:
///
/// - Nothing paints before the root resolves.
/// - A child that has not arrived draws a placeholder in place, so the layout
///   does not jump when it lands.
/// - Bound and computed props resolve at render time, so a data patch updates a
///   number without rebuilding the component around it.
@MainActor
public struct SurfaceView: View {
    private let store: SurfaceStore
    /// What to call the surface until its own Screen title arrives.
    private let pendingTitle: String
    /// A window sets its title in mono caps inside its strip and squares its
    /// diagram nodes; every other chrome keeps the rounded house type.
    @Environment(\.hudChrome) private var chrome
    @Environment(\.hudKeyboardFocus) private var keyboardFocus
    @Environment(\.hudEditingField) private var editingField

    public init(store: SurfaceStore, pendingTitle: String = "") {
        self.store = store
        self.pendingTitle = pendingTitle
    }

    public var body: some View {
        Group {
            if store.isReady, let root = store.spec.root {
                node(root, ancestors: [])
            } else {
                LoadingView(title: pendingTitle)
            }
        }
        // A spring, not an ease: `d` lines can arrive faster than any
        // animation finishes, and an ease restarts from zero velocity on each
        // one, which reads as stutter. A spring bends toward the new value.
        .animation(Motion.smooth(reduced: Motion.systemReduced), value: store.revision)
        // Rows and the cards they open measure in this one space, so a card
        // knows where its row is while the surface itself moves.
        // The light that carries a row into its card, over everything in the
        // surface so no child's slot can clip it (ContainerTransform.swift).
        .overlay(alignment: .topLeading) { MorphLayer(surface: store.surfaceID ?? "") }
        .coordinateSpace(name: RowAnchors.space)
        .environment(\.hudSurfaceID, store.surfaceID ?? "")
    }

    /// `ancestors` is the path from the root, not everything already drawn.
    ///
    /// A set of everything drawn makes the render impure and silently breaks a
    /// legitimate DAG, where one component is referenced by two parents. Path
    /// scoping cuts only genuine cycles.
    private func node(_ id: ComponentID, ancestors: Set<ComponentID>) -> AnyView {
        if ancestors.contains(id) { return AnyView(EmptyView()) }
        guard let element = store.spec.elements[id],
              element.type != ComponentNode.pendingType
        else { return AnyView(PlaceholderView()) }
        if Self.blank(element.type, store.resolved(element), in: chrome) { return AnyView(EmptyView()) }
        return AnyView(
            A11yContract.decorate(
                element.type, store.resolved(element),
                render(element, ancestors: ancestors.union([id])))
                .modifier(KeyboardRing(
                    active: keyboardFocus?.component == id && keyboardFocus?.row == nil))
                .environment(\.hudFocusedRow,
                    keyboardFocus?.component == id ? keyboardFocus?.row : nil)
                // Identity keyed on the *type*, so a component that becomes a
                // different kind of component transitions instead of snapping.
                //
                // Changing props keeps the identity and animates in place: a
                // number rolls, a bar grows, a diagram's nodes travel. Changing
                // the type cannot animate in place, because there is no sensible
                // halfway point between a table and a chart, so it crossfades
                // and scales instead. Both read as the interface responding
                // rather than being rebuilt, which is the whole difference
                // between this and a slideshow.
                .id(element.type)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .scale(scale: 0.97)),
                    removal: .opacity.combined(with: .scale(scale: 1.02)))))
    }

    /// A part with nothing in it draws nothing.
    ///
    /// Caleb's 2026-10-11 screenshot of the meetings card: an opened meeting
    /// with no notes drew "Granola had no notes", two empty grey circles (two
    /// Buttons whose label was "", each a capsule around nothing), a
    /// Transcript press and "No turns yet". A Button with no label and a
    /// Metric with no value are blank on every chrome. On the glass any part
    /// with no content is, because there is no card to hold the empty space
    /// and say the panel is still a panel.
    static func blank(_ type: String, _ p: [String: JSON], in chrome: Chrome) -> Bool {
        func empty(_ key: String) -> Bool {
            switch p[key] {
            case nil, .null?: return true
            case .string(let text)?: return text.trimmingCharacters(in: .whitespaces).isEmpty
            case .array(let items)?: return items.isEmpty
            default: return false
            }
        }
        switch type {
        case "Button": return empty("label")
        case "Metric": return empty("value")
        default: break
        }
        guard chrome == .glass else { return false }
        switch type {
        case "Text": return empty("value")
        case "Heading": return empty("text")
        case "List", "Events", "Transcript": return empty("items")
        default: return false
        }
    }

    @ViewBuilder
    private func children(of element: ComponentNode, ancestors: Set<ComponentID>) -> some View {
        ForEach(element.children, id: \.self) { child in
            node(child, ancestors: ancestors)
        }
    }

    /// Dispatch to a small builder per family.
    ///
    /// This is split rather than written as one switch for a boring but decisive
    /// reason: a single `@ViewBuilder` switch with twelve branches makes Swift
    /// unify twelve different view types into nested `_ConditionalContent`
    /// generics, and the type checker's cost grows exponentially in the number of
    /// branches. As one function this file took over three and a half minutes of
    /// CPU to compile. Split into families that return `AnyView`, it takes
    /// seconds, and the erasure costs nothing a person could perceive in a panel
    /// that redraws a few times a second.
    private func render(_ element: ComponentNode, ancestors: Set<ComponentID>) -> AnyView {
        var p = store.resolved(element)
        // `bind=/draft/note` is how hud/CLAUDE.md writes a control, and until
        // 2026-10-04 only `value=@/draft/note` worked: the documented Field
        // drew an input that could not be typed into. Both are read now, and
        // `bind=` shows the value at its pointer.
        if element.props["bind"] != nil, let pointer = boundPointer(element) {
            p["value"] = Pointer.get(store.spec.data, pointer)
        }
        switch element.type {
        case "Screen", "Stack":
            return container(element, p, ancestors)
        case "Heading", "Text", "List":
            return prose(element, p)
        case "Metric", "Table", "Status":
            return data(p, type: element.type, id: element.id)
        case "Sparkline", "Bars", "Ring", "Events":
            return chart(p, type: element.type, id: element.id)
        case "Mark":
            return AnyView(AgentMarkView(
                kind: Wireframe.Kind(rawValue: p["kind"]?.stringValue ?? "ico") ?? .ico,
                spin: p["spin"] == .bool(true),
                size: CGFloat(min(max(p["size"]?.doubleValue ?? 18, 8), 64))))
        case "File":
            let path = p["path"]?.stringValue ?? ""
            return AnyView(
                FileView(
                    path: path,
                    editable: p["editable"] == .bool(true),
                    page: Int(p["page"]?.doubleValue ?? 1),
                    onSave: { [store] body, expecting, force in
                        store.saveFile(path: path, contents: body, expecting: expecting, force: force)
                    },
                    onDirty: { [store] draft in store.markUnsaved(path: path, draft: draft) }))

        case "Diagram":
            let parts = p["parts"]?.arrayValue ?? []
            return AnyView(
                DiagramView(
                    parts: parts,
                    aspect: p["aspect"]?.doubleValue ?? 2,
                    tone: HUD.tone(p["tone"]?.stringValue, in: chrome),
                    square: chrome == .window)
                    // A drawing with no description is the least accessible
                    // thing here, and it was shipped with a role and no
                    // content. Reading the labels out in order is not a
                    // substitute for a real description, and it is far better
                    // than announcing "image".
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Diagram")
                    .accessibilityValue(Self.describe(parts)))
        default:
            return control(element, p)
        }
    }

    private func container(
        _ element: ComponentNode, _ p: [String: JSON], _ ancestors: Set<ComponentID>
    ) -> AnyView {
        if element.type == "Screen" {
            // A composed entrance staggers by meaning, not by child: the
            // title, then the body, then the actions (realm's design.md). One
            // step per part, never one per row, so a twenty-row list arrives
            // as one thing.
            return AnyView(
                VStack(alignment: .leading, spacing: 14) {
                    // No title, no line: a launcher rail has nothing to
                    // name, and an empty Text still takes 14 of gap.
                    // On the glass the content names itself: no title line.
                    if chrome != .glass, let title = p["title"]?.display, !title.isEmpty {
                        Text(chrome == .window ? title.uppercased() : title)
                            .font(chrome == .window
                                ? Typeface.pixel(11)
                                : .system(size: 13, weight: .semibold, design: .rounded))
                            // Nothing outside a window sets a design, so this
                            // only undoes the window's mono (`pixelFont`).
                            .fontDesign(nil)
                            .kerning(chrome == .window ? 0.6 : 0.4)
                            .foregroundStyle(HUD.ink)
                            .modifier(Stagger(part: .title))
                    }
                    ForEach(element.children, id: \.self) { child in
                        node(child, ancestors: ancestors)
                            .modifier(Stagger(part: isAction(child) ? .actions : .body))
                            .modifier(FoldFade())
                    }
                })
        }

        let gap = CGFloat(p["gap"]?.doubleValue ?? 2) * 4

        // `from=@/pointer`: a card opened from a row. Drawn only while the
        // pointer names a row, growing out of that row and shrinking back
        // into it (ContainerTransform.swift).
        if element.props["from"] != nil {
            return AnyView(
                CardSlot(surface: store.surfaceID ?? "", row: p["from"]?.display ?? "", card: element.id) {
                    VStack(alignment: .leading, spacing: gap) {
                        children(of: element, ancestors: ancestors)
                    }
                })
        }

        // A grid, because a dashboard is not a column.
        //
        // Every serious dashboard tool lays panels out in a grid and the first
        // version of this could only stack, so four metrics took four times the
        // vertical space they needed and pushed everything else off a panel that
        // is already height-capped. Columns are fixed rather than adaptive: the
        // model asked for two, and a grid that silently reflows to one is a
        // layout the author cannot reason about.
        if p["direction"]?.stringValue == "grid" {
            let columns = max(1, min(Int(p["cols"]?.doubleValue ?? 2), 4))
            return AnyView(
                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(), spacing: gap, alignment: .topLeading),
                        count: columns),
                    alignment: .leading,
                    spacing: gap
                ) {
                    children(of: element, ancestors: ancestors)
                })
        }

        if p["direction"]?.stringValue == "horizontal" {
            // `align=center` for a row that mixes words and a Button: top
            // aligned, the button's 44-point target sat its capsule 15
            // points below the words (the Clay strip, 2026-10-09).
            let align: VerticalAlignment = p["align"]?.stringValue == "center" ? .center : .top
            return AnyView(
                HStack(alignment: align, spacing: gap) {
                    children(of: element, ancestors: ancestors)
                })
        }
        return AnyView(
            VStack(alignment: .leading, spacing: gap) {
                children(of: element, ancestors: ancestors)
            })
    }

    /// Where a control writes: `bind=/pointer` (the documented form), then
    /// `bind=@/pointer`, then `value=@/pointer`. Nil leaves it read-only.
    func boundPointer(_ element: ComponentNode) -> String? {
        switch element.props["bind"] {
        case .literal(.string(let pointer))? where pointer.hasPrefix("/"):
            return pointer
        case .binding(let binding)?:
            return binding.pointer
        default:
            return store.binding(element, "value")
        }
    }

    /// Whether a Screen's child is its actions: a Button, or a Stack of
    /// nothing but Buttons.
    func isAction(_ id: ComponentID) -> Bool {
        guard let node = store.spec.elements[id] else { return false }
        if node.type == "Button" { return true }
        guard node.type == "Stack", !node.children.isEmpty else { return false }
        return node.children.allSatisfy { store.spec.elements[$0]?.type == "Button" }
    }

    private func prose(_ element: ComponentNode, _ p: [String: JSON]) -> AnyView {
        switch element.type {
        case "Heading":
            let level = Int(p["level"]?.doubleValue ?? 2)
            if chrome == .glass {
                // The open thing's name, set as the largest words on the
                // glass after the counts: it is what the light carried in.
                return AnyView(
                    Text(p["text"]?.display ?? "")
                        .font(.system(size: level == 1 ? 18 : 15, weight: .semibold))
                        .foregroundStyle(HUD.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .contentTransition(.opacity)
                        .accessibilityAddTraits(.isHeader))
            }
            return AnyView(
                CaptionLabel(
                    text: p["text"]?.display ?? "", size: level == 1 ? 14 : 11.5,
                    weight: .semibold, colour: HUD.dim, kerning: 0)
                    .padding(.top, 2))

        case "Text":
            let tone = p["tone"]?.stringValue
            if tone == "idle" {
                // A standing state that is nothing happening: a small dim
                // dot and no word on the glass (2026-10-11, "Im not in a
                // meeting?" at a lit "Listening"). The words are for
                // VoiceOver only.
                return AnyView(
                    Circle().fill(HUD.ink.opacity(0.32)).frame(width: 5, height: 5)
                        .frame(width: 12, height: 12)
                        .accessibilityElement()
                        .accessibilityLabel(p["value"]?.display ?? ""))
            }
            let muted = tone == "muted"
            let meaning = HUD.meaning(tone)
            return AnyView(
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    // A state line in a meaning's hue carries its dot too,
                    // so the meaning never rests on colour alone.
                    if let meaning {
                        Circle().fill(meaning).frame(width: 6, height: 6)
                            .shadow(color: meaning.opacity(0.6), radius: 3)
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                            .transition(.opacity)
                    }
                    Text(p["value"]?.display ?? "")
                        .font(.system(size: 12.5, weight: meaning == nil ? .regular : .medium))
                        .foregroundStyle(meaning ?? (muted ? HUD.faint : HUD.ink.opacity(0.9)))
                        // A line that changes says so in place: the old words
                        // fade as the new ones come (motion rule 12).
                        .contentTransition(.opacity)
                        .fixedSize(horizontal: false, vertical: true)
                })

        default:
            let items = p["items"]?.arrayValue ?? []
            let ordered = p["ordered"] == .bool(true)
            return AnyView(ListView(
                items: items, ordered: ordered, rowAction: rowAction(p, element.id)))
        }
    }

    /// The button every row of a List, Table or Events carries when the
    /// component has `action=`. See `SurfaceStore.fireRow`.
    func rowAction(_ p: [String: JSON], _ id: ComponentID) -> RowAction? {
        RowAction(p) { [store] row in
            guard let name = p["action"]?.stringValue else { return }
            store.fireRow(name, row: row)
        }
    }

    private func data(_ p: [String: JSON], type: String, id: ComponentID) -> AnyView {
        switch type {
        case "Metric":
            let value = p["value"]?.display ?? ""
            let tone = Self.threshold(p, value: p["value"]?.doubleValue, in: chrome)
            if chrome == .glass {
                return AnyView(
                    GlassMetric(label: p["label"]?.display ?? "", value: value,
                                tone: tone, number: p["value"]?.doubleValue)
                        .animation(Motion.gentle(reduced: Motion.systemReduced), value: value))
            }
            return AnyView(
                MetricView(
                    label: p["label"]?.display ?? "",
                    value: value,
                    unit: p["unit"]?.stringValue,
                    tone: tone,
                    toneName: Self.thresholdName(p, value: p["value"]?.doubleValue),
                    number: p["value"]?.doubleValue)
                    // Digits roll rather than cutting. A number that changes
                    // under your eye is the one thing on a HUD you always want
                    // to have noticed. Only the value animates: the label and
                    // the card around it do not move.
                    .animation(Motion.gentle(reduced: Motion.systemReduced), value: value))

        case "Table":
            let columns = (p["columns"]?.arrayValue ?? []).compactMap { column -> Column? in
                guard let object = column.objectValue,
                      let field = object["field"]?.stringValue else { return nil }
                return Column(field: field, label: object["label"]?.stringValue ?? field)
            }
            let rows = p["rows"]?.arrayValue ?? []
            return AnyView(
                TableView(
                    caption: p["caption"]?.display ?? "",
                    columns: columns,
                    rows: rows,
                    rowAction: rowAction(p, id))
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(
                        (p["caption"]?.display ?? "Table")
                            + ", \(rows.count) rows, \(columns.count) columns"))

        default:
            let message = p["message"]?.display ?? ""
            let level = p["level"]?.stringValue ?? "info"
            return AnyView(
                StatusView(message: message, level: level)
                    // An outcome that changes should be announced, not waited
                    // for. The catalog has promised this since it was written.
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(message)
                    .accessibilityValue(HUD.spoken(level) ?? level)
                    .accessibilityAddTraits(.updatesFrequently))
        }
    }

    /// The dashboard family.
    ///
    /// Kept apart from `data` for the same compile-time reason the other
    /// families are split, and because it is the family with the most branches
    /// still to come.
    ///
    /// Every one of these takes a `tone`, defaulting to the HUD accent. A
    /// dashboard where each panel picks its own colour is unreadable, so the
    /// model has to ask for a different one deliberately and gets the house cyan
    /// when it does not.
    private func chart(_ p: [String: JSON], type: String, id: ComponentID) -> AnyView {
        let tone = HUD.tone(p["tone"]?.stringValue, in: chrome)
        switch type {
        case "Sparkline":
            let points = (p["points"]?.arrayValue ?? []).compactMap(\.doubleValue)
            return AnyView(
                Sparkline(
                    label: p["label"]?.display ?? "",
                    points: points,
                    value: p["value"]?.display ?? "",
                    tone: tone))

        case "Bars":
            return AnyView(
                BarsView(
                    caption: p["caption"]?.display ?? "",
                    rows: p["rows"]?.arrayValue ?? [],
                    tone: tone))

        case "Ring":
            let fraction = p["value"]?.doubleValue ?? 0
            return AnyView(
                RingView(
                    label: p["label"]?.display ?? "",
                    fraction: fraction,
                    caption: p["caption"]?.display ?? "",
                    tone: Self.threshold(p, value: fraction, in: chrome) ?? tone))

        default:
            if chrome == .glass {
                return AnyView(GlassRail(items: p["items"]?.arrayValue ?? [], rowAction: rowAction(p, id)))
            }
            return AnyView(
                EventsView(
                    caption: p["caption"]?.display ?? "",
                    items: p["items"]?.arrayValue ?? [],
                    tone: tone,
                    rowAction: rowAction(p, id)))
        }
    }

    /// The tone a value has earned, or nil to leave it alone.
    ///
    /// `thresholds=[{"at":80,"tone":"warn"},{"at":95,"tone":"bad"}]`. The last
    /// crossed one wins, so they may be given in any order.
    ///
    /// This is the one dashboard feature worth taking from the tools that do
    /// nothing else: a number that turns amber on its own is read correctly at a
    /// glance, and a number that is only ever cyan has to be read.
    static func threshold(
        _ p: [String: JSON], value: Double?, in chrome: Chrome = .card
    ) -> Color? {
        thresholdName(p, value: value).map { HUD.tone($0, in: chrome) }
    }

    /// The tone a value crossed into, by name, so it can also be spoken and
    /// drawn as a symbol rather than only coloured.
    static func thresholdName(_ p: [String: JSON], value: Double?) -> String? {
        guard let value, let rules = p["thresholds"]?.arrayValue else { return nil }
        var crossed: (at: Double, tone: String)?
        for rule in rules {
            guard let fields = rule.objectValue,
                  let at = fields["at"]?.doubleValue,
                  let name = fields["tone"]?.stringValue,
                  value >= at
            else { continue }
            if crossed == nil || at > crossed!.at { crossed = (at, name) }
        }
        return crossed?.tone
    }

    /// Say what a diagram contains, in the order it was drawn.
    static func describe(_ parts: [JSON]) -> String {
        var labels: [String] = []
        var edges = 0
        for part in parts {
            guard let fields = part.objectValue else { continue }
            let kind = fields["t"]?.stringValue ?? ""
            if kind == "arrow" || kind == "line" { edges += 1 }
            if let text = fields["label"]?.stringValue ?? fields["text"]?.stringValue,
               !text.isEmpty {
                labels.append(text)
            }
        }
        guard !labels.isEmpty else { return "\(parts.count) shapes" }
        let connections = edges == 1 ? "1 connection" : "\(edges) connections"
        return labels.joined(separator: ", ") + ". " + connections + "."
    }

    /// Live controls, not pictures of controls.
    ///
    /// The first version drew a button as a capsule of text, on the reasoning
    /// that a HUD is glanced at rather than used. That was wrong: a panel that
    /// cannot answer is a poster. A control writes to the local data model
    /// immediately and sends an event up the socket, so it responds at typing
    /// speed whether or not an agent is still listening.
    private func control(_ element: ComponentNode, _ p: [String: JSON]) -> AnyView {
        switch element.type {
        case "Button":
            let action = p["action"]?.stringValue ?? ""
            var payload: [String: JSON] = [:]
            if let collection = p["collection"] { payload["collection"] = collection }
            let primary = p["variant"]?.stringValue == "primary"
            if chrome == .glass {
                return AnyView(GlassWord(label: p["label"]?.display ?? "") {
                    store.fire(action, from: element.id, payload: payload)
                })
            }
            return AnyView(
                Button {
                    store.fire(action, from: element.id, payload: payload)
                } label: {
                    Text(p["label"]?.display ?? "")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(HUDButtonStyle(primary: primary)))

        case "Checkbox":
            let pointer = boundPointer(element)
            return AnyView(
                Toggle(
                    isOn: Binding(
                        get: { p["value"] == .bool(true) },
                        set: { next in
                            guard let pointer else { return }
                            store.write(pointer, .bool(next))
                        })
                ) {
                    Text(p["label"]?.display ?? "").font(.system(size: 12))
                }
                .toggleStyle(.checkbox)
                .accessibilityLabel(A11yContract.name("Checkbox", p) ?? "")
                .disabled(pointer == nil))

        case "Select":
            let pointer = boundPointer(element)
            let options = (p["options"]?.arrayValue ?? []).map(\.display)
            return AnyView(
                LabeledControl(label: p["label"]?.display ?? "") {
                    // A menu with a drawn label rather than a Picker: the
                    // system pop-up is 22 points tall and cannot be made
                    // taller, and the whole 44-point label opens this one.
                    Menu {
                        ForEach(options, id: \.self) { option in
                            Button(option) {
                                guard let pointer else { return }
                                store.write(pointer, .string(option))
                            }
                        }
                    } label: {
                        HStack {
                            Text((p["value"]?.display).flatMap { $0.isEmpty ? nil : $0 } ?? "Choose")
                                .font(.system(size: 12))
                                .foregroundStyle(HUD.ink.opacity(0.92))
                            Spacer(minLength: 6)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(HUD.faint)
                        }
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: HitTarget.minimum)
                        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                        .contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    // Named by its label, valued by the choice: it read as
                    // "Choose, pop up button" before (bd_2026-Code-apw).
                    .accessibilityLabel(A11yContract.name("Select", p) ?? "")
                    .accessibilityValue((p["value"]?.display).flatMap { $0.isEmpty ? nil : $0 } ?? "None")
                    .disabled(pointer == nil)
                })

        case "Field":
            let pointer = boundPointer(element)
            let numeric = p["kind"]?.stringValue == "number"
            return AnyView(
                LabeledControl(label: p["label"]?.display ?? "") {
                    HUDField(
                        placeholder: p["placeholder"]?.display ?? "",
                        takeFocus: editingField && keyboardFocus?.component == element.id,
                        text: Binding(
                            get: { p["value"]?.display ?? "" },
                            set: { next in
                                guard let pointer else { return }
                                // A number field that stores its text would make
                                // every count downstream wrong, so coerce here.
                                store.write(
                                    pointer,
                                    numeric ? .number(Double(next) ?? 0) : .string(next))
                            }))
                    .accessibilityLabel(A11yContract.name("Field", p) ?? "")
                    .disabled(pointer == nil)
                })

        default:
            return launcher(element, p)
        }
    }

    /// What a press on a lane does: write the lane locally, then send
    /// `e action <action> row=<lane> surface=<surface>` (`action` defaults to
    /// `select`). A Rail press is the same line with `open`.
    func segmentedPick(_ element: ComponentNode, _ p: [String: JSON]) -> (String) -> Void {
        let pointer = boundPointer(element)
        let action = p["action"]?.stringValue ?? "select"
        return { [store] id in
            if let pointer { store.write(pointer, .string(id)) }
            store.fireRow(action, row: id)
        }
    }

    /// Segmented lanes, an avatar, and the launcher rail. Split out for the
    /// same type-checking reason as the other families.
    private func launcher(_ element: ComponentNode, _ p: [String: JSON]) -> AnyView {
        switch element.type {
        case "Segmented":
            let options = SegmentedView.options(p["options"]?.arrayValue ?? [])
            return AnyView(
                SegmentedView(
                    options: options,
                    selected: p["value"]?.display ?? options.first?.id ?? "",
                    onPick: segmentedPick(element, p)))

        case "Avatar":
            return AnyView(
                AvatarView(
                    name: p["name"]?.display ?? "",
                    image: p["image"]?.stringValue,
                    size: CGFloat(min(max(p["size"]?.doubleValue ?? 24, 16), 48))))

        case "Tiles":
            let action = p["action"]?.stringValue
            var counts: [String: Int] = [:]
            for (key, value) in p["counts"]?.objectValue ?? [:] {
                if let n = value.doubleValue { counts[key] = Int(n) }
            }
            return AnyView(
                AgentTilesView(
                    tiles: AgentTile.parse(p["items"]?.arrayValue ?? []),
                    counts: counts,
                    onOpen: action.map { name in { [store] id in store.fireRow(name, row: id) } }))

        case "Chips":
            let chips = AgentChip.parse(p["options"]?.arrayValue ?? [])
            return AnyView(
                AgentChipsView(
                    chips: chips,
                    selected: p["value"]?.display ?? chips.first?.id ?? "",
                    dots: p["dots"] != .bool(false),
                    onPick: segmentedPick(element, p)))

        case "Transcript":
            let action = p["action"]?.stringValue
            return AnyView(
                TranscriptView(
                    items: TranscriptView.items(p["items"]?.arrayValue ?? []),
                    onOpen: action.map { name in { [store] id in store.fireRow(name, row: id) } }))

        case "Diff":
            return AnyView(DiffView(text: p["text"]?.display ?? "", path: p["path"]?.stringValue ?? "",
                                    plain: p["plain"] == .bool(true)))

        case "Web":
            return AnyView(WebPaneView(url: p["url"]?.display ?? ""))

        case "Tree":
            let action = p["action"]?.stringValue
            return AnyView(
                TreeView(
                    rows: TreeView.rows(p["items"]?.arrayValue ?? []),
                    onOpen: action.map { name in { [store] id in store.fireRow(name, row: id) } }))

        case "Rail":
            return AnyView(
                RailView(
                    entries: RailView.entries(p["items"]?.arrayValue ?? [], data: store.spec.data),
                    onOpen: { [store] id in store.fireRow("open", row: id) }))

        default:
            // A component the panel does not know draws nothing rather than an
            // error box. A newer catalog should degrade, not shout.
            return AnyView(EmptyView())
        }
    }
}

/// The body of a folding surface: out first, in last.
///
/// Folding, it fades in 90 ms, before the card has closed far enough to clip
/// it mid-line. Unfolding, it waits 80 ms for the card to start opening and
/// then fades in, so nothing is drawn into a frame too small to hold it.
struct FoldFade: ViewModifier {
    @Environment(\.hudFolded) private var folded
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(folded ? 0 : 1)
            .animation(
                folded
                    ? .easeOut(duration: 0.09)
                    : .easeOut(duration: reduceMotion ? 0.1 : 0.18).delay(reduceMotion ? 0 : 0.08),
                value: folded)
    }
}

/// One semantic part of a composed entrance.
///
/// 30 ms apart, so the actions, the last part, land 60 ms after the title and
/// the whole card is settled by about 340 ms: the card's own arrival is 280.
/// Played once, when the part first appears; a later `d` changes values in
/// place and replays nothing. Offscreen (snapshots) and under Reduce Motion it
/// starts where it ends.
struct Stagger: ViewModifier {
    enum Part: Int { case title = 0, body = 1, actions = 2 }
    let part: Part

    static let step = 0.03

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudOffscreen) private var offscreen
    @State private var shown = false

    func body(content: Content) -> some View {
        let visible = shown || offscreen || reduceMotion
        return content
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 6)
            .onAppear {
                guard !shown else { return }
                withAnimation(
                    SurfaceEntrance.arrive.delay(Self.step * Double(part.rawValue))
                ) { shown = true }
            }
    }
}

/// Named so the table's column list is not an inferred tuple array, which is
/// another thing the type checker charges for.
struct Column: Hashable {
    let field: String
    let label: String
}

/// A text field whose target is 44 points tall.
///
/// The rounded-border field was 22 points, half the floor. The text itself
/// stays 12 point; the box around it grows, and a click anywhere in the box
/// focuses the field rather than only a click on the line of text.
struct HUDField: View {
    let placeholder: String
    /// Keyboard mode pressed this field: it takes the keys (bd_2026-Code-yw6).
    var takeFocus = false
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 12))
            .focused($focused)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: HitTarget.minimum)
            .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
            .overlay {
                RoundedRectangle(cornerRadius: 9)
                    .strokeBorder(focused ? HUD.accent.opacity(0.7) : .white.opacity(0.12))
            }
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
            .onChange(of: takeFocus) { _, next in focused = next }
    }
}

/// A label above its control, so a narrow panel does not squeeze the input.
struct LabeledControl<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
                // The control carries this as its own name; read here as
                // well, every field would be announced twice.
                .accessibilityHidden(true)
            content
        }
    }
}

struct HUDButtonStyle: ButtonStyle {
    let primary: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(
                primary ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary),
                in: Capsule())
            .foregroundStyle(primary ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            // The capsule stays small; the target around it does not. 44
            // points is the floor for anything pressed (bd_2026-Code-cnr).
            .frame(minWidth: HitTarget.minimum, minHeight: HitTarget.minimum)
            .contentShape(Rectangle())
            .modifier(PressScale(pressed: configuration.isPressed))
    }
}

/// A press goes down to 0.96 and comes back on a spring, so a release
/// halfway through the press reverses from wherever it is (realm's design.md:
/// "Buttons may scale to 0.96 while pressed. Keep the transition
/// interruptible."). Reduce Motion keeps the dim and drops the scale.
struct PressScale: ViewModifier {
    let pressed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(pressed && !reduceMotion ? 0.96 : 1)
            .opacity(pressed ? 0.8 : 1)
            .animation(Motion.snappy(reduced: reduceMotion), value: pressed)
    }
}

/// The style for a row's button: the press of `HUDButtonStyle` with no
/// fill of its own, since `RowActionButton` draws the capsule.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(PressScale(pressed: configuration.isPressed))
    }
}

struct ListView: View {
    let items: [JSON]
    let ordered: Bool
    var rowAction: RowAction?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudChrome) private var chrome

    private struct Row: Identifiable {
        let id: String
        let row: String
        let index: Int
        let text: String
    }

    /// An item is a string, or an object with `text` (and `id` for an
    /// action to name it by).
    private var rows: [Row] {
        zip(items, RowKeys.keys(items)).enumerated().map { index, pair in
            let (item, key) = pair
            let text = item.objectValue?["text"]?.display ?? item.display
            return Row(id: key, row: RowKeys.id(of: item) ?? key, index: index, text: text)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(rows) { row in
                HStack(alignment: rowAction == nil ? .top : .center, spacing: 7) {
                    if chrome == .glass && !ordered {
                        // No bullet on the glass: the indent under the name
                        // already says these lines belong to it.
                        EmptyView()
                    } else if chrome == .window && !ordered {
                        // A square bullet in ink, the window's one shape.
                        // 6 of top pad centres it on a 12.5-point first line.
                        Rectangle()
                            .fill(HUD.ink.opacity(0.9))
                            .frame(width: 4, height: 4)
                            .padding(.top, rowAction == nil ? 6 : 0)
                    } else {
                        Text(ordered ? "\(row.index + 1)." : "▸")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(
                                chrome == .window ? HUD.ink.opacity(0.9) : HUD.accent.opacity(0.8))
                            // The bullet was read as "black right-pointing
                            // small triangle" before every item.
                            .accessibilityHidden(!ordered)
                    }
                    Text(row.text)
                        .font(.system(size: 12.5))
                        .foregroundStyle(HUD.ink.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                    if let rowAction {
                        Spacer(minLength: 6)
                        RowActionButton(action: rowAction, row: row.row)
                    }
                }
                .rowAnchor(row.row)
                .transition(RowKeys.transition(reduced: reduceMotion))
            }
        }
    }
}

// MARK: - Pieces

struct MetricView: View {
    let label: String
    let value: String
    let unit: String?
    /// In a window the number and its label are set in mono, like the strip.
    @Environment(\.hudChrome) private var chrome
    /// Set by a crossed threshold. Nil means the number has not earned a colour
    /// and stays in the house ink, which most numbers should.
    var tone: Color?
    /// The tone by name, so it can be spoken and drawn as a symbol. Colour
    /// alone is not a signal for everyone.
    var toneName: String?
    /// The value as a number, when it is one, so the digits roll in the
    /// direction it moved: up for a rise, down for a fall. Nil cross-fades.
    var number: Double?

    var body: some View {
        content
            // A number that changes under your eye is the one thing on a HUD
            // you always want to have noticed, sighted or not.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(spoken)
            .accessibilityAddTraits(.updatesFrequently)
    }

    private var spoken: String {
        var parts = [value]
        if let unit { parts.append(unit) }
        if let word = HUD.spoken(toneName) { parts.append(word) }
        return parts.joined(separator: " ")
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                if let symbol = HUD.symbol(toneName) {
                    Image(systemName: symbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(tone ?? HUD.accent)
                        .accessibilityHidden(true)
                }
                Text(value)
                    // Monospaced digits so a number changing in place does not
                    // shove everything beside it sideways.
                    .font(chrome == .window
                        ? Typeface.pixel(22)
                        : .system(size: 26, weight: .semibold, design: .rounded))
                    .fontDesign(nil)
                    .monospacedDigit()
                    .foregroundStyle(tone ?? HUD.ink)
                    // The glow follows the tone too, so a number that has gone
                    // red is red in its light as well as its ink. A window's
                    // untoned numbers stay sharp: white with no light round it.
                    .shadow(
                        color: (tone ?? (chrome == .window ? .clear : HUD.accent)).opacity(0.5),
                        radius: 9)
                    .contentTransition(number.map { .numericText(value: $0) } ?? .opacity)
                if let unit {
                    Text(unit)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(HUD.faint)
                }
            }
            Text(label.uppercased())
                .font(.system(
                    size: 9, weight: .semibold, design: chrome == .window ? .monospaced : .default))
                .kerning(0.9)
                .foregroundStyle(HUD.faint)
        }
        .frame(minWidth: 62, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}

struct TableView: View {
    let caption: String
    let columns: [Column]
    let rows: [JSON]
    var rowAction: RowAction?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudChrome) private var chrome

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !caption.isEmpty {
                CaptionLabel(
                    text: caption, size: 10.5, weight: .medium, colour: HUD.dim, kerning: 0)
            }

            if rows.isEmpty {
                Text("Nothing yet")
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 5) {
                    GridRow {
                        ForEach(columns, id: \.self) { column in
                            Text(column.label.uppercased())
                                .font(.system(size: 8.5, weight: .semibold))
                                .kerning(0.9)
                                .foregroundStyle(
                                    chrome == .window ? HUD.faint : HUD.accent.opacity(0.75))
                        }
                        if rowAction != nil { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                    }
                    ForEach(Array(zip(rows, RowKeys.keys(rows))), id: \.1) { row, key in
                        GridRow {
                            ForEach(columns, id: \.self) { column in
                                Text(row.objectValue?[column.field]?.display ?? "")
                                    .font(.system(size: 12))
                                    .foregroundStyle(HUD.ink.opacity(0.92))
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                            if let rowAction {
                                RowActionButton(action: rowAction, row: RowKeys.id(of: row) ?? key)
                                    .gridColumnAlignment(.trailing)
                            }
                        }
                        .transition(RowKeys.transition(reduced: reduceMotion))
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(caption)
    }
}

struct StatusView: View {
    let message: String
    let level: String

    private var tint: Color {
        switch level {
        case "success": return .green
        case "warning": return .orange
        case "error": return .red
        default: return .accentColor
        }
    }

    var body: some View {
        // No message, nothing drawn: a lone dot under a panel read as a stray
        // mark on the agents panel (screenshot, 2026-10-10).
        if !message.isEmpty {
            HStack(spacing: 6) {
                Circle().fill(tint).frame(width: 6, height: 6)
                Text(message).font(.system(size: 12))
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Drawn for a child that has been referenced but has not arrived.
///
/// Shaped like a line of text rather than a grey box, because the placeholder
/// and the thing replacing it need the same measure. A rectangle that becomes
/// text reflows, and the eye reads that reflow as a page reload rather than as
/// the same content continuing to arrive.
///
/// Still. It used to shimmer forever, which is the decorative pulsing realm's
/// design.md rules out and the "nothing moves while idle" rule in
/// hud/CLAUDE.md forbids: a child that never arrives would have pulsed in the
/// corner of somebody's eye until the panel was closed.
struct PlaceholderView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(.quaternary)
            .frame(height: 11)
            .frame(maxWidth: 150, alignment: .leading)
            .opacity(0.6)
            .accessibilityHidden(true)
    }
}

/// Shown between a request arriving and the root resolving.
///
/// The surface's name in the Screen title's type, and one "Loading" line. It
/// was three dots and nothing else, ticked by a task every 60 ms: on
/// 2026-10-05 Caleb saw two of them stacked top right while the people and
/// github surfaces fetched, and a panel with no name and no words reads as
/// broken. Still, because a fetch that never answers would otherwise move in
/// the corner of somebody's eye until the panel was closed (hud/CLAUDE.md
/// rule 6), and the tick re-rendered the overlay sixteen times a second.
struct LoadingView: View {
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !title.isEmpty {
                Text(title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .kerning(0.4)
                    .foregroundStyle(HUD.ink)
            }
            Text("Loading")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(HUD.faint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// A surface id as a title: `github` is "Github", `my-meetings` is
    /// "My meetings". Sentence case, like every other heading here.
    static func title(fromID id: String) -> String {
        let words = id.replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .trimmingCharacters(in: .whitespaces)
        guard let first = words.first else { return "" }
        return first.uppercased() + words.dropFirst()
    }
}
