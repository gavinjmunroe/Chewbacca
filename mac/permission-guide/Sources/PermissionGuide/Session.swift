import AppKit

enum Outcome: String {
    case granted
    case dismissed
    case timeout
}

/// One grant, start to finish (session.rs): open the exact pane, wait for the
/// Settings window to settle, float the card over it, keep it pinned while the
/// window moves, and leave on its own the moment the grant is detected.
final class GuideSession {
    // Anarlog's cadence (session.rs). Positioning ticks every 100 ms; a first
    // position is accepted once the window has held within 2 points for 160
    // ms, because Settings animates its window in and a card placed on the
    // first frame lands where the window used to be. After 1.2 s it gives up
    // waiting and uses whatever it has.
    static let tickInterval: TimeInterval = 0.1
    static let initialFallbackAfter: TimeInterval = 1.2
    static let initialStableFor: TimeInterval = 0.16
    static let initialStableThreshold: CGFloat = 2
    // Not Anarlog's: its probe is an in-process call, cheap at 100 ms. Ours
    // can be a TCC.db read or a whole shell command, so it runs off the main
    // thread, never overlaps itself, and at most twice a second. Guessed,
    // never measured; a grant shows up within half a second of the switch.
    static let probeInterval: TimeInterval = 0.5

    private let permission: Permission
    private let app: HostApp
    private let probe: GrantProbe
    private let hold: Bool
    private let deadline: Date
    private let finish: (Outcome) -> Void

    private var panel: NSPanel?
    private var timer: Timer?
    private var startedAt = Date()
    private var pending: (snapshot: SettingsWindowSnapshot, observedAt: Date)?
    private var lastProbe = Date.distantPast
    private var probing = false
    private var reportedGrant = false
    private var closing = false

    init(permission: Permission, app: HostApp, probe: GrantProbe, hold: Bool, timeout: TimeInterval,
         finish: @escaping (Outcome) -> Void) {
        self.permission = permission
        self.app = app
        self.probe = probe
        self.hold = hold
        self.deadline = Date().addingTimeInterval(timeout)
        self.finish = finish
    }

    func start() -> Bool {
        guard openSettings() else { return false }
        startedAt = Date()
        if let snapshot = SettingsWindowSnapshot.locateVisibleFrontmost() {
            createAndReveal(snapshot)
        }
        let timer = Timer(timeInterval: Self.tickInterval, repeats: true) { [weak self] _ in self?.tick() }
        // Common modes, so the grant is still noticed while a drag is in flight
        // (the run loop sits in event tracking mode for the whole drag).
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        return true
    }

    /// Through /usr/bin/open, as Anarlog's ext.rs does, not NSWorkspace as its
    /// session.rs does. Seen 2026-10-05 on macOS 15.6: with System Settings
    /// already running behind Chrome, NSWorkspace.open from this accessory
    /// process navigated the pane but left Chrome frontmost, so the card,
    /// which only shows over a frontmost Settings, never appeared. `open`
    /// with the same URL brought Settings forward every time.
    private func openSettings() -> Bool {
        for string in permission.settingsURLs {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = [string]
            do { try process.run() } catch { continue }
            process.waitUntilExit()
            if process.terminationStatus == 0 { return true }
        }
        return false
    }

    private func tick() {
        guard !closing else { return }
        if Date() >= deadline {
            // A held card that saw the grant ran to its deadline on purpose.
            close(reportedGrant ? .granted : .timeout)
            return
        }
        scheduleProbe()
        if panel == nil {
            if let snapshot = settledInitialSnapshot() {
                pending = nil
                createAndReveal(snapshot)
            }
            return
        }
        refreshPosition()
    }

    private func scheduleProbe() {
        guard !probing, Date().timeIntervalSince(lastProbe) >= Self.probeInterval else { return }
        probing = true
        lastProbe = Date()
        let probe = self.probe
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let status = probe.status()
            DispatchQueue.main.async {
                guard let self else { return }
                self.probing = false
                guard status == .granted, !self.closing else { return }
                if self.hold {
                    if !self.reportedGrant {
                        self.reportedGrant = true
                        Output.event("granted-held", permission: self.permission.id)
                    }
                    return
                }
                self.close(.granted)
            }
        }
    }

    private func settledInitialSnapshot() -> SettingsWindowSnapshot? {
        let now = Date()
        if let snapshot = SettingsWindowSnapshot.locateVisibleFrontmost() {
            if let previous = pending, previous.snapshot.delta(to: snapshot) <= Self.initialStableThreshold {
                pending = (snapshot, previous.observedAt)
                if now.timeIntervalSince(previous.observedAt) >= Self.initialStableFor { return snapshot }
            } else {
                pending = (snapshot, now)
            }
        }
        if now.timeIntervalSince(startedAt) >= Self.initialFallbackAfter {
            return SettingsWindowSnapshot.locateWithLaunchFallback()
        }
        return nil
    }

    private func createAndReveal(_ snapshot: SettingsWindowSnapshot) {
        let panel = Overlay.makePanel(permission: permission, app: app) { [weak self] in
            self?.close(.dismissed)
        }
        panel.alphaValue = 0
        panel.setFrame(Geometry.overlayFrame(settings: snapshot.frame, visible: snapshot.visibleFrame),
                       display: true)
        panel.orderFrontRegardless()
        Motion.reveal(panel)
        self.panel = panel
        if ProcessInfo.processInfo.environment["PERMISSION_GUIDE_DEBUG"] != nil, let root = panel.contentView {
            Self.dump(root, depth: 0)
        }
    }

    private static func dump(_ view: NSView, depth: Int) {
        let pad = String(repeating: "  ", count: depth)
        FileHandle.standardError.write(Data(
            "\(pad)\(type(of: view)) frame=\(view.frame) hidden=\(view.isHidden) alpha=\(view.alphaValue)\n".utf8))
        for child in view.subviews { dump(child, depth: depth + 1) }
    }

    /// Follows the Settings window, and hides the card whenever Settings is
    /// not frontmost, so it never floats over some other app's window.
    private func refreshPosition() {
        guard let panel else { return }
        guard let snapshot = SettingsWindowSnapshot.locateVisibleFrontmost() else {
            panel.orderOut(nil)
            return
        }
        let target = Geometry.overlayFrame(settings: snapshot.frame, visible: snapshot.visibleFrame)
        let delta = Geometry.frameDelta(panel.frame, target)
        if delta > Motion.repositionThreshold {
            Motion.animate(Motion.repositionDuration) { panel.animator().setFrame(target, display: true) }
        } else if delta > .ulpOfOne {
            panel.setFrame(target, display: true)
        }
        panel.orderFrontRegardless()
    }

    private func close(_ outcome: Outcome) {
        guard !closing else { return }
        closing = true
        timer?.invalidate()
        timer = nil
        guard let panel else {
            finish(outcome)
            return
        }
        Motion.dismiss(panel) { [finish] in
            panel.close()
            finish(outcome)
        }
    }
}
