import AppKit
import SwiftUI

/// The rim editor: five sliders on the real rim, live, and a row of states
/// to look at it in. "Edit the rim" in the menu, `rim` on the socket, or
/// `hud rim`.
///
/// A native HUD panel rather than a surface on the glass: the glass never
/// takes key (hud/CLAUDE.md, "Targets"), and a slider dragged with the
/// arrow keys needs it.
@MainActor
public final class RimEditor: NSObject, NSWindowDelegate {
    public static let shared = RimEditor()

    private var panel: NSPanel?

    /// Open it, or bring it forward, showing `presence` on the rim. A rim
    /// that is down shows listening, because there is nothing to size on a
    /// screen with no rim.
    public func open(showing presence: Presence) {
        let tuner = RimTuner.shared
        if tuner.preview == nil {
            tuner.preview = presence == .dormant ? .attentive : presence
        }
        let panel = self.panel ?? make()
        self.panel = panel
        if !panel.isVisible { panel.center() }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    private func make() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: RimEditorView.width, height: 320),
            styleMask: [.titled, .closable, .utilityWindow, .hudWindow],
            backing: .buffered, defer: false)
        panel.title = "Rim"
        panel.isFloatingPanel = true
        // Over the overlay's surfaces, which sit at `.floating`.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        let host = NSHostingView(
            rootView: RimEditorView(tuner: RimTuner.shared) { [weak panel] in panel?.close() })
        panel.contentView = host
        panel.setContentSize(host.fittingSize)
        return panel
    }

    /// Escape, the close button and Done all end here: the rim goes back to
    /// whatever state is really up, and the file is written now rather than
    /// a quarter second from now.
    public func windowWillClose(_ notification: Notification) {
        RimTuner.shared.preview = nil
        RimTuner.shared.save()
    }
}

struct RimEditorView: View {
    @Bindable var tuner: RimTuner
    let done: () -> Void

    static let width: CGFloat = 440

    /// The states to look at the rim in, in the order an errand runs
    /// through them. `speaking` draws as `hearing` and is left out.
    static let states: [(Presence, String, String)] = [
        (.attentive, "Listen", "listening"),
        (.hearing, "Talk", "talking"),
        (.thinking, "Think", "thinking"),
        (.acting, "Act", "acting"),
        (.done, "Done", "done"),
        (.attention, "Alert", "asking for you"),
        (.failed, "Fail", "failed"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Picker("Preview", selection: preview) {
                    ForEach(Self.states, id: \.0) { state, label, _ in
                        Text(label).tag(state)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text(caption)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 10) {
                slider(
                    "Thickness", value: $tuner.tuning.thickness,
                    in: RimTuning.thicknessRange, step: 1) { "\(Int($0.rounded())) pt" }
                slider(
                    "Frost", value: $tuner.tuning.frost,
                    in: RimTuning.frostRange, step: 0.05) { "\(Int(($0 * 100).rounded()))%" }
                slider(
                    "Tint", value: $tuner.tuning.tint,
                    in: RimTuning.tintRange, step: 0.05) { String(format: "%.2f×", $0) }
                slider(
                    "Edge light", value: $tuner.tuning.edge,
                    in: RimTuning.edgeRange, step: 0.05) { String(format: "%.2f×", $0) }
                slider(
                    "Corners", value: $tuner.tuning.corner,
                    in: RimTuning.cornerRange, step: 1) { "\(Int($0.rounded())) pt" }
            }

            HStack {
                Button("Reset to default") { tuner.reset() }
                    .disabled(tuner.tuning == RimTuning())
                Spacer()
                Text("Saved as you go")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Button("Done", action: done)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: Self.width)
    }

    private var preview: Binding<Presence> {
        Binding(
            get: { tuner.preview ?? .attentive },
            set: { tuner.preview = $0 })
    }

    /// What the thickness slider means for the state on screen, since only
    /// listening is set directly and the rest follow it.
    private var caption: String {
        let state = tuner.preview ?? .attentive
        let name = Self.states.first { $0.0 == state }?.2 ?? "this state"
        let depth = Int(tuner.tuning.depth(of: state.field).rounded())
        return "Showing \(name) at \(depth) pt. Every state scales with Thickness."
    }

    private func slider(
        _ label: String, value: Binding<Double>, in range: ClosedRange<Double>,
        step: Double, format: @escaping (Double) -> String
    ) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .frame(width: 76, alignment: .leading)
            // Snapped here rather than with `step:`, which draws a tick per
            // step: sixty of them on Tint read as a ruler, not a slider.
            Slider(
                value: Binding(
                    get: { value.wrappedValue },
                    set: { value.wrappedValue = ($0 / step).rounded() * step }),
                in: range
            ) { Text(label) }
                .labelsHidden()
            Text(format(value.wrappedValue))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 52, alignment: .trailing)
        }
        .font(.system(size: 12))
    }
}
