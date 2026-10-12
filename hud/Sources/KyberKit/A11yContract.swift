import SwiftUI

/// What every component is to VoiceOver, in one table (bd_2026-Code-apw).
///
/// The catalog has always said what each component is (a heading, a list, a
/// button) and the renderer honoured it for the charts, Metric, Status and
/// Diagram only. Screen, Stack, Heading, Text, List, Field, Select and File
/// drew with no role and, for Field and Select, no name: a Select read as
/// "Choose, pop up button", with nothing saying what was being chosen.
///
/// Every component the renderer draws now passes through `decorate`, so the
/// contract is applied in one place, and `A11yContractTests` reads both the
/// vocabulary in hud/CLAUDE.md and the renderer's own switch: a component
/// added to either without a row here fails the suite.
enum A11yContract {
    /// What a component is announced as.
    enum Role: String, Sendable {
        /// A container: its children are reached inside it, and its name,
        /// when it has one, is said on the way in.
        case group
        /// A section heading, reachable by the VoiceOver rotor.
        case heading
        /// Read as it is written.
        case text
        /// A container announced with its count.
        case list
        /// A control whose role SwiftUI already gives it (button, checkbox,
        /// text field, pop-up). The renderer names the control itself, on
        /// the control and not on the label-and-control stack around it,
        /// because a label on the stack is not read when focus is in the field.
        case control
        /// Labelled by its own view, because what to say depends on its data
        /// (a chart says its values, a Metric its number and threshold). The
        /// table still lists it, so a missing one is a test failure.
        case own
    }

    struct Entry: Sendable {
        let role: Role
        /// The props tried in order for the name. Empty: no name, or the
        /// view names itself.
        let name: [String]
    }

    static let table: [String: Entry] = [
        // Structure
        "Screen": Entry(role: .group, name: ["title"]),
        "Stack": Entry(role: .group, name: ["label"]),
        // Prose
        "Heading": Entry(role: .heading, name: ["text"]),
        "Text": Entry(role: .text, name: ["value"]),
        "List": Entry(role: .list, name: ["label", "caption"]),
        // Data
        "Metric": Entry(role: .own, name: ["label"]),
        "Table": Entry(role: .own, name: ["caption"]),
        "Status": Entry(role: .own, name: ["message"]),
        // Dashboard
        "Sparkline": Entry(role: .own, name: ["label"]),
        "Bars": Entry(role: .own, name: ["caption"]),
        "Ring": Entry(role: .own, name: ["label"]),
        "Events": Entry(role: .own, name: ["caption"]),
        // Anything else
        "Diagram": Entry(role: .own, name: []),
        "File": Entry(role: .group, name: ["path"]),
        "Mark": Entry(role: .own, name: []),
        // Controls
        "Button": Entry(role: .control, name: ["label"]),
        "Field": Entry(role: .control, name: ["label", "placeholder"]),
        "Select": Entry(role: .control, name: ["label"]),
        "Checkbox": Entry(role: .control, name: ["label"]),
        // Sessions and the launcher
        "Segmented": Entry(role: .own, name: []),
        "Avatar": Entry(role: .own, name: ["name"]),
        "Transcript": Entry(role: .own, name: []),
        "Diff": Entry(role: .own, name: ["path"]),
        "Tree": Entry(role: .own, name: []),
        "Rail": Entry(role: .own, name: []),
        // Agents (AgentTiles.swift): each tile and chip names itself.
        "Tiles": Entry(role: .own, name: []),
        "Chips": Entry(role: .own, name: []),
        // Search results (HitsView.swift): each row names itself.
        "Hits": Entry(role: .own, name: []),
        // A live page (WebPane.swift), named by its host.
        "Web": Entry(role: .own, name: []),
        // A whole local app (AppPane.swift): Realm's own interface, which
        // carries its own accessibility tree.
        "App": Entry(role: .own, name: []),
    ]

    /// The name a component is announced by: the first of its name props
    /// that has something in it. A path is said as its file name.
    static func name(_ type: String, _ props: [String: JSON]) -> String? {
        guard let entry = table[type] else { return nil }
        for key in entry.name {
            guard let value = props[key]?.display, !value.isEmpty else { continue }
            return key == "path" ? (value as NSString).lastPathComponent : value
        }
        return nil
    }

    /// `view`, with what VoiceOver needs to know about it.
    @MainActor
    static func decorate(_ type: String, _ props: [String: JSON], _ view: AnyView) -> AnyView {
        guard let entry = table[type] else { return view }
        let name = name(type, props)
        switch entry.role {
        case .own:
            return view
        case .group:
            if let name {
                return AnyView(view
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(type == "File" ? "File \(name)" : name))
            }
            // An unnamed Stack stays transparent. On macOS a group is a
            // place VoiceOver has to be told to step into, and one per
            // layout Stack would bury every control two levels down.
            return view
        case .heading:
            return AnyView(view
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(name ?? "")
                .accessibilityAddTraits(.isHeader))
        case .text:
            return AnyView(view
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(name ?? ""))
        case .list:
            let count = props["items"]?.arrayValue?.count ?? 0
            let said = count == 1 ? "1 item" : "\(count) items"
            return AnyView(view
                .accessibilityElement(children: .contain)
                .accessibilityLabel(name.map { "\($0), list, \(said)" } ?? "List, \(said)"))
        case .control:
            return view
        }
    }
}
