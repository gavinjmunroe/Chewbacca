import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// The agents surface's tiles and provider chips (AgentTiles.swift).
@Suite("Agent tiles")
@MainActor
struct AgentTilesTests {
    /// The composited ground text on the glass is held to: Glass.swift
    /// wash(over:), "Faint text needs the ground at L<=0.087", over a white page.
    static let glass = 0.087

    private func rgb(_ color: Color) -> (Double, Double, Double) {
        let c = NSColor(color).usingColorSpace(.sRGB)!
        return (Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent))
    }

    private func ratio(_ a: Double, _ b: Double) -> Double { (max(a, b) + 0.05) / (min(a, b) + 0.05) }

    /// The tile's own ground: black at 0.18 over the glass, mixed in sRGB.
    private var tileGround: Double {
        let grey = pow(Self.glass, 1 / 2.2) * 0.82
        return AgentPalette.luminance(grey, grey, grey)
    }

    @Test("tiles parse from items, keep their ids and default to done")
    func parse() {
        let tiles = AgentTile.parse([
            .object(["id": .string("s1"), "title": .string("Fix the rail"), "state": .string("needs"),
                     "provider": .string("claude"), "name": .string("Claude"), "selected": .bool(true)]),
            .object(["title": .string("No id")]),
            .string("not a tile"),
        ])
        #expect(tiles.map(\.id).first == "s1")
        #expect(tiles.count == 2)
        #expect(tiles[0].selected && tiles[0].initial == "C")
        #expect(tiles[1].state == "done")
    }

    @Test("every state word holds 4.5:1 on a tile, needs you the loudest of them")
    func stateContrast() {
        for state in ["needs", "failed", "running", "done"] {
            let (r, g, b) = rgb(AgentPalette.state(state).tone)
            let measured = ratio(AgentPalette.luminance(r, g, b), tileGround)
            #expect(measured >= 4.5, "\(state) is \(measured):1")
        }
        #expect(AgentPalette.state("needs").tone == HUD.warn)
        #expect(AgentPalette.state("needs").word == "Needs you")
    }

    @Test("every provider mark holds 3:1 as a graphic on the glass, and its initial 4.5:1 on the mark")
    func providerContrast() {
        for (key, c) in AgentPalette.providers {
            let mark = AgentPalette.luminance(c.red, c.green, c.blue)
            #expect(ratio(mark, Self.glass) >= 3.0, "\(key) mark is \(ratio(mark, Self.glass)):1")
            // The initial is black at 0.85 over the mark.
            let ink = AgentPalette.luminance(c.red * 0.15, c.green * 0.15, c.blue * 0.15)
            #expect(ratio(mark, ink) >= 4.5, "\(key) initial")
        }
    }

    @Test("the four main providers are told apart by hue, not only by name")
    func providersDiffer() {
        let keys = ["claude", "codex", "acp:gemini", "acp:cursor"]
        let colours = keys.map { AgentPalette.providers[$0]! }
        for i in 0..<colours.count {
            for j in (i + 1)..<colours.count {
                let a = colours[i], b = colours[j]
                let distance = abs(a.red - b.red) + abs(a.green - b.green) + abs(a.blue - b.blue)
                #expect(distance > 0.3, "\(keys[i]) and \(keys[j]) are too close")
            }
        }
    }

    @Test("a tile is a 44-point target and a press sends the row-action line")
    func tilePress() {
        let store = SurfaceStore()
        store.surfaceID = "agents"
        var sent: [String] = []
        store.onEvent = { sent.append($0.line) }
        let tile = AgentTile(id: "s1", title: "Fix the rail", detail: "Bash: npm test", state: "needs",
                             provider: "claude", name: "Claude", meta: "chewbacca · 2m", selected: false)
        let view = TileView(tile: tile, onOpen: { store.fireRow("ks-pick", row: $0) })
        #expect(NSHostingView(rootView: view.frame(width: 210)).fittingSize.height >= HitTarget.minimum)
        view.onOpen?("s1")
        #expect(sent.contains(#"e action ks-pick row="s1" surface="agents""#))
    }

    @Test("a chip press writes the pick and sends the row-action line")
    func chipPress() {
        let store = SurfaceStore()
        store.surfaceID = "agents"
        var sent: [String] = []
        store.onEvent = { sent.append($0.line) }
        let node = ComponentNode(
            id: "kinds", type: "Chips",
            props: ["value": .binding(DataBinding(pointer: "/agents/agent")), "action": .literal(.string("ks-agent"))])
        SurfaceView(store: store).segmentedPick(node, ["action": .string("ks-agent")])("acp:gemini")
        #expect(store.spec.data["agents"]?.objectValue?["agent"] == .string("acp:gemini"))
        #expect(sent.contains(#"e action ks-agent row="acp:gemini" surface="agents""#))
        #expect(AgentChip.parse([.object(["id": .string("claude"), "label": .string("Claude")])]).first?.label
            == "Claude")
    }

    @Test("tiles and chips are keyboard targets, one per tile and per chip")
    func keyboard() {
        #expect(KeyboardFocus.rowed["Tiles"] == "items")
        #expect(KeyboardFocus.rowed["Chips"] == "options")
    }
}
