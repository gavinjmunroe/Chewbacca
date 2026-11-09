import AppKit
import SwiftUI
import Testing
@testable import KyberKit

/// One hue per meaning, and every one of them readable as text on the glass.
@Suite("Meaning hues")
struct MeaningTests {
    /// The glass's worst documented ground (Glass.swift, wash(over:)).
    static let glass = 0.087

    static func contrast(_ color: Color) -> Double {
        let c = NSColor(color).usingColorSpace(.sRGB) ?? .white
        let l = AgentPalette.luminance(Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent))
        return (l + 0.05) / (glass + 0.05)
    }

    @Test("needs you, working, done and recording each hold 4.5:1 as text")
    func contrast() {
        for name in ["needs", "running", "done", "recording"] {
            let hue = HUD.meaning(name)
            #expect(hue != nil, "\(name) has no hue")
            if let hue { #expect(Self.contrast(hue) >= 4.5, "\(name): \(Self.contrast(hue))") }
        }
    }

    @Test("the four meanings are four different hues, and the tiles use the same ones")
    func oneHueEach() {
        let hues = ["needs", "running", "done", "recording"].compactMap { HUD.meaning($0) }
        #expect(Set(hues.map { "\($0)" }).count == 4)
        #expect(AgentPalette.state("needs").tone == HUD.needsYou)
        #expect(AgentPalette.state("failed").tone == HUD.needsYou)
        #expect(AgentPalette.state("running").tone == HUD.running)
        #expect(AgentPalette.state("done").tone == HUD.done)
        #expect(HUD.tone("recording") == HUD.recording)
        #expect(HUD.symbol("recording") != nil && HUD.spoken("needs") == "needs you")
    }
}
