import AppKit
import Observation
import Quartz
import SwiftUI

/// The file manager on the HUD: two panes, the keyboard, no Finder.
///
/// A native panel like the rim editor and the command bar, not a surface on
/// the glass: the glass never takes key (hud/CLAUDE.md, "Targets"), and a
/// file manager is driven entirely from the keyboard. `files` on the socket,
/// `hud files [path]`, "show me files" to hud-listen, or Files in the menu.
///
/// Keys, Marta's set: Tab switches pane, Up/Down pick, Enter opens a folder
/// or Quick Looks a file, Backspace goes up, F3 (or Space) Quick Look, F4
/// opens in its app, F5 copy and F6 move to the other pane, F7 new folder,
/// F8 (or Command-Delete) to the Trash, Command-L the path field, Command-
/// Shift-. hidden files, Escape closes.
@MainActor
public final class FilesPanel: NSPanel, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    public static let shared = FilesPanel()

    let controller: FilesController
    private var keyMonitor: Any?

    static let size = NSSize(width: 980, height: 600)

    private init() {
        controller = FilesController()
        super.init(
            contentRect: NSRect(origin: .zero, size: Self.size),
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel, .resizable],
            backing: .buffered,
            defer: false)
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        standardWindowButton(.closeButton)?.isHidden = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
        isFloatingPanel = true
        // Over the overlay's surfaces, which sit at `.floating`, like the
        // rim editor.
        level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        minSize = NSSize(width: 640, height: 360)
        controller.onClose = { [weak self] in self?.dismiss() }
        controller.onQuickLook = { [weak self] in self?.toggleQuickLook() }
        controller.onSelectionChanged = { [weak self] in self?.refreshQuickLook() }
        contentView = NSHostingView(rootView: FilesView(controller: controller))
    }

    public override var canBecomeKey: Bool { true }
    public override var canBecomeMain: Bool { false }

    /// Open it, or bring it forward. A path points the active pane there; a
    /// file's path opens its folder with the file picked.
    public func open(at path: String? = nil) {
        if let path, !path.isEmpty {
            controller.go(to: path)
        } else {
            controller.refresh()
        }
        if !isVisible { centerOnActiveScreen() }
        installKeyMonitor()
        NSApp.activate(ignoringOtherApps: true)
        makeKeyAndOrderFront(nil)
        // No field holds the caret on open, so the first arrow key moves the
        // selection instead of the insertion point.
        DispatchQueue.main.async { [weak self] in self?.makeFirstResponder(nil) }
    }

    public func dismiss() {
        if QLPreviewPanel.sharedPreviewPanelExists(), QLPreviewPanel.shared().isVisible {
            QLPreviewPanel.shared().orderOut(nil)
        }
        removeKeyMonitor()
        orderOut(nil)
    }

    private func centerOnActiveScreen() {
        guard let screen = OverlayWindow.active else { return }
        let visible = screen.visibleFrame
        let size = NSSize(
            width: min(Self.size.width, visible.width - 80),
            height: min(Self.size.height, visible.height - 80))
        setFrame(
            NSRect(
                x: visible.midX - size.width / 2,
                y: visible.midY - size.height / 2 + visible.height * 0.04,
                width: size.width, height: size.height),
            display: true)
    }

    // MARK: Keyboard

    /// How keys reach the file manager.
    ///
    /// A local monitor sees every keyDown this app receives before AppKit
    /// dispatches it, so the panes get Tab, the arrows and the F-keys even
    /// though no SwiftUI view holds focus (and a focused SwiftUI list would
    /// eat Tab for its own focus ring). It acts only on events for this
    /// panel, and only while no text field is being edited: with the caret
    /// in the path or folder-name field, every key goes to the field except
    /// Escape, which gives the keyboard back to the panes. Returning nil
    /// swallows the key; returning the event lets AppKit deliver it.
    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let used = MainActor.assumeIsolated { () -> Bool in
                guard let self, event.window === self else { return false }
                if self.firstResponder is NSText {
                    guard event.keyCode == 53 else { return false }
                    self.controller.cancelEditing()
                    self.makeFirstResponder(nil)
                    return true
                }
                return self.controller.handle(FilesKey(event))
            }
            return used ? nil : event
        }
    }

    private func removeKeyMonitor() {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
    }

    /// The fields' Enter ends editing; this gives the keyboard back.
    func endEditing() { makeFirstResponder(nil) }

    // MARK: Quick Look

    private func toggleQuickLook() {
        let ql = QLPreviewPanel.shared()!
        if QLPreviewPanel.sharedPreviewPanelExists(), ql.isVisible {
            ql.orderOut(nil)
        } else if controller.state.activePane.selection != nil {
            ql.makeKeyAndOrderFront(nil)
            // Quick Look takes key when it opens; the panes keep the keyboard.
            makeKey()
        }
    }

    private func refreshQuickLook() {
        guard QLPreviewPanel.sharedPreviewPanelExists(), QLPreviewPanel.shared().isVisible else { return }
        QLPreviewPanel.shared().reloadData()
    }

    public override func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool { true }

    // Quick Look calls these from AppKit's responder chain, which is always
    // the main thread; the SDK just does not say so.
    public override func beginPreviewPanelControl(_ panel: QLPreviewPanel!) {
        MainActor.assumeIsolated {
            panel.dataSource = self
            panel.delegate = self
            panel.level = NSWindow.Level(rawValue: level.rawValue + 1)
        }
    }

    public override func endPreviewPanelControl(_ panel: QLPreviewPanel!) {
        MainActor.assumeIsolated {
            panel.dataSource = nil
            panel.delegate = nil
        }
    }

    public nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        MainActor.assumeIsolated { controller.state.activePane.selection == nil ? 0 : 1 }
    }

    public nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! {
        let url = MainActor.assumeIsolated { controller.state.activePane.selection?.url }
        return url as NSURL?
    }
}

/// A key, reduced to what the file manager reads, so `handle` can be driven
/// by tests without an NSEvent.
public enum FilesKey: Equatable, Sendable {
    case tab, up, down, pageUp, pageDown, home, end, enter, back, escape, space
    case function(Int)
    case trash, focusPath, toggleHidden, open
    case other

    init(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let command = flags.contains(.command)
        switch event.specialKey {
        case .f3?: self = .function(3); return
        case .f4?: self = .function(4); return
        case .f5?: self = .function(5); return
        case .f6?: self = .function(6); return
        case .f7?: self = .function(7); return
        case .f8?: self = .function(8); return
        case .pageUp?: self = .pageUp; return
        case .pageDown?: self = .pageDown; return
        case .home?: self = .home; return
        case .end?: self = .end; return
        default: break
        }
        switch event.keyCode {
        case 48: self = .tab
        case 126: self = command ? .home : .up
        case 125: self = command ? .open : .down
        case 36, 76: self = .enter
        case 51: self = command ? .trash : .back
        case 53: self = .escape
        case 49: self = .space
        case 37 where command: self = .focusPath  // Command-L
        case 47 where command && flags.contains(.shift): self = .toggleHidden  // Command-Shift-.
        case 31 where command: self = .open  // Command-O
        default: self = .other
        }
    }
}

/// The panes' brain on the main actor: owns the state, loads off it.
@MainActor
@Observable
public final class FilesController {
    public internal(set) var state: FileManagerState
    public var pathText = ""
    public var editingPath = false
    /// The folder-name prompt F7 opens, or nil.
    public var newFolderName: String?
    public internal(set) var status: FilesStatus?
    public internal(set) var busy = false
    public internal(set) var showHidden = false

    @ObservationIgnored var onClose: () -> Void = {}
    @ObservationIgnored var onQuickLook: () -> Void = {}
    @ObservationIgnored var onSelectionChanged: () -> Void = {}
    /// Bumped per load so a slow listing of a folder already left never
    /// lands on top of the one the pane moved to.
    @ObservationIgnored private var generation: [PaneSide: Int] = [:]
    @ObservationIgnored private let fileManager: FileManager
    @ObservationIgnored private let loadIcons: Bool

    public init(
        left: URL? = nil, right: URL? = nil, autoload: Bool = true,
        icons: Bool = true, fileManager: FileManager = .default
    ) {
        let home = fileManager.homeDirectoryForCurrentUser
        let downloads = home.appendingPathComponent("Downloads")
        self.fileManager = fileManager
        self.loadIcons = icons
        state = FileManagerState(
            left: left ?? home,
            right: right ?? (fileManager.fileExists(atPath: downloads.path) ? downloads : home))
        syncPath()
        if autoload { refresh() }
    }

    /// Reload both panes, keeping each one's pick.
    public func refresh() {
        load(.left)
        load(.right)
    }

    // MARK: Keys

    /// One key. True when the file manager used it.
    @discardableResult
    public func handle(_ key: FilesKey) -> Bool {
        if newFolderName != nil, key == .escape {
            newFolderName = nil
            return true
        }
        switch key {
        case .tab: state.toggle(); syncPath(); onSelectionChanged()
        case .up: moveSelection(by: -1)
        case .down: moveSelection(by: 1)
        case .pageUp: moveSelection(by: -12)
        case .pageDown: moveSelection(by: 12)
        case .home: moveSelection(by: -Int.max / 2)
        case .end: moveSelection(by: Int.max / 2)
        case .enter: activate()
        case .back: goToParent()
        case .escape: onClose()
        case .space, .function(3): onQuickLook()
        case .function(4), .open: openInApp()
        case .function(5): transfer(moving: false)
        case .function(6): transfer(moving: true)
        case .function(7): newFolderName = "New Folder"
        case .function(8), .trash: trash()
        case .focusPath: editingPath = true
        case .toggleHidden:
            showHidden.toggle()
            say(showHidden ? "Showing hidden files." : "Hiding hidden files.", .neutral)
            refresh()
        case .function, .other: return false
        }
        return true
    }

    func moveSelection(by delta: Int) {
        state.moveSelection(by: delta)
        onSelectionChanged()
    }

    /// A click on a row: that pane becomes active and the row is picked.
    func pick(_ side: PaneSide, index: Int) {
        if state.active != side {
            state.active = side
            syncPath()
        }
        state[side].select(index)
        onSelectionChanged()
    }

    func activate() {
        switch state.activation() {
        case .navigate(let url)?: navigate(to: url)
        case .open?: onQuickLook()
        case nil: break
        }
    }

    func goToParent() {
        let before = state.activePane.directory
        guard let left = state.goToParent() else {
            say("Already at the top of the disk.", .neutral)
            return
        }
        syncPath()
        load(state.active, prefer: left, revertTo: before)
    }

    func navigate(to url: URL, select: URL? = nil) {
        let before = state.activePane.directory
        state.navigate(to: url)
        syncPath()
        load(state.active, prefer: select, revertTo: before)
    }

    /// Typed or sent: a folder navigates, a file opens its folder with it picked.
    public func go(to typed: String) {
        let url = FileFormat.resolve(typed, relativeTo: state.activePane.directory)
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: url.path, isDirectory: &isDir) else {
            say("Nothing at \(FileFormat.display(url)).", .bad)
            syncPath()
            return
        }
        if isDir.boolValue {
            navigate(to: url)
        } else {
            navigate(to: url.deletingLastPathComponent(), select: url)
        }
    }

    func submitPath() {
        editingPath = false
        go(to: pathText)
    }

    func cancelEditing() {
        editingPath = false
        newFolderName = nil
        syncPath()
    }

    private func syncPath() {
        pathText = FileFormat.display(state.activePane.directory)
    }

    // MARK: Loading

    func load(_ side: PaneSide, prefer: URL? = nil, revertTo previous: URL? = nil) {
        let directory = state[side].directory
        let hidden = showHidden
        let icons = loadIcons
        let fm = fileManager
        let ticket = (generation[side] ?? 0) + 1
        generation[side] = ticket
        state[side].loading = true
        Task { [weak self] in
            // The disk, off the main thread: a network volume or a folder of
            // ten thousand files must never hold the panel still.
            let result = await Task.detached(priority: .userInitiated) {
                Result { try DirectoryLoader.list(directory, showHidden: hidden, icons: icons, fileManager: fm) }
            }.value
            guard let self, self.generation[side] == ticket else { return }
            self.apply(result, to: side, prefer: prefer, revertTo: previous)
        }
    }

    func apply(
        _ result: Result<[FileItem], any Error>, to side: PaneSide,
        prefer: URL? = nil, revertTo previous: URL? = nil
    ) {
        switch result {
        case .success(let items):
            state[side].replace(items: items, prefer: prefer)
        case .failure(let error):
            // Keep the rows that were up and say what failed: a folder that
            // could not be read is never drawn as an empty one.
            let name = state[side].directory.lastPathComponent
            if let previous { state[side].directory = previous }
            state[side].loading = false
            say(Self.readFailure(name, error), .bad)
        }
        if side == state.active, !editingPath { syncPath() }
        onSelectionChanged()
    }

    static func readFailure(_ name: String, _ error: any Error) -> String {
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain, ns.code == NSFileReadNoPermissionError {
            return "Can't read \(name). Give Kyber access in System Settings, Privacy & Security, Files and Folders."
        }
        return "Can't read \(name): \(ns.localizedDescription)"
    }

    // MARK: Writing

    func transfer(moving: Bool) {
        guard let item = state.activePane.selection else { return }
        let target = state.inactivePane.directory
        let fm = fileManager
        let verb = moving ? "Moved" : "Copied"
        busy = true
        say("\(moving ? "Moving" : "Copying") \(item.name)…", .neutral)
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                Result {
                    moving
                        ? try FileOps.move(item.url, into: target, fileManager: fm)
                        : try FileOps.copy(item.url, into: target, fileManager: fm)
                }
            }.value
            guard let self else { return }
            self.busy = false
            switch result {
            case .success(let landed):
                let renamed = landed.lastPathComponent != item.name
                    ? " as \(landed.lastPathComponent), since \(item.name) was already there" : ""
                self.say("\(verb) \(item.name) to \(target.lastPathComponent)\(renamed).", .good)
                self.load(self.state.active.other, prefer: landed)
                if moving { self.load(self.state.active) }
            case .failure(let error):
                self.say(Self.writeFailure(error), .bad)
            }
        }
    }

    func trash() {
        guard let item = state.activePane.selection else { return }
        do {
            try FileOps.trash(item.url, fileManager: fileManager)
            say("Moved \(item.name) to the Trash.", .good)
        } catch {
            say(Self.writeFailure(error), .bad)
        }
        refresh()
    }

    func createFolder() {
        guard let name = newFolderName else { return }
        newFolderName = nil
        do {
            let made = try FileOps.newFolder(named: name, in: state.activePane.directory, fileManager: fileManager)
            say("Made \(made.lastPathComponent).", .good)
            load(state.active, prefer: made)
        } catch {
            say(Self.writeFailure(error), .bad)
        }
    }

    func openInApp() {
        guard let item = state.activePane.selection else { return }
        NSWorkspace.shared.open(item.url)
        say("Opened \(item.name) in its app.", .neutral)
    }

    static func writeFailure(_ error: any Error) -> String {
        if let failure = error as? FileOps.Failure { return failure.description }
        return (error as NSError).localizedDescription
    }

    func say(_ text: String, _ tone: FilesStatus.Tone) {
        status = FilesStatus(text: text, tone: tone)
    }
}

public struct FilesStatus: Equatable, Sendable {
    public enum Tone: Sendable { case neutral, good, bad }
    public let text: String
    public let tone: Tone
}

// MARK: - Views

/// What is on the panel, and why each thing is there (the interface skill's
/// intent list; anything drawn that is not on it is a bug):
///
/// - Path field: where the active pane is, and the way to go anywhere by
///   typing. It follows Tab, so it always names the pane the keys act on.
/// - Two panes: the source and the destination of every F5 and F6. The
///   active one carries the accent rim, so it is never a guess which side a
///   key will hit.
/// - Pane header: the folder's name and how many items, the glance answer.
/// - Rows: icon, name, size, modified, the four facts a person picks a file
///   by. Folders first, picked row filled.
/// - Status line: what the last key did, naming its target, or why it
///   could not. A failed read keeps the old rows and says so here.
/// - Key bar: every action and its key, pressable, so nothing has to be
///   memorised and a mouse still works.
struct FilesView: View {
    @Bindable var controller: FilesController
    @Environment(\.hudOffscreen) private var offscreen
    @FocusState private var pathFocused: Bool
    @FocusState private var nameFocused: Bool

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: SurfaceChrome.radius, style: .continuous)
    }

    var body: some View {
        VStack(spacing: 0) {
            pathBar
            HStack(spacing: 10) {
                PaneView(controller: controller, side: .left)
                PaneView(controller: controller, side: .right)
            }
            .padding(.horizontal, 14)
            statusBar
            keyBar
        }
        .background {
            ZStack {
                VisualEffect(material: .hudWindow, blending: .behindWindow)
                SurfaceChrome.frost.opacity(0.62)
                LinearGradient(
                    colors: [.white.opacity(0.09), .clear],
                    startPoint: .top, endPoint: .center)
            }
        }
        .clipShape(shape)
        .modifier(LiquidGlass(shape: shape))
        .overlay {
            shape.strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: .white.opacity(0.5), location: 0),
                        .init(color: .white.opacity(0.06), location: 0.35),
                        .init(color: .white.opacity(0.18), location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom),
                lineWidth: 1)
        }
        .environment(\.colorScheme, .dark)
        .onChange(of: controller.editingPath) { _, editing in pathFocused = editing }
        .onChange(of: pathFocused) { _, focused in
            // A click into the field counts as editing too, so Escape and a
            // click away both put the active pane's path back.
            if focused { controller.editingPath = true }
            else if controller.editingPath { controller.cancelEditing() }
        }
        .onChange(of: controller.newFolderName == nil) { _, closed in nameFocused = !closed }
    }

    private var pathBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "folder")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(HUD.accent)
            // A TextField is AppKit underneath and rasterises as a prohibition
            // sign, so an offscreen render draws its text instead.
            if offscreen {
                Text(controller.pathText)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(HUD.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("", text: $controller.pathText, prompt: Text("Go to a folder").foregroundStyle(HUD.faint))
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(HUD.ink)
                    .focused($pathFocused)
                    .onSubmit {
                        controller.submitPath()
                        FilesPanel.shared.endEditing()
                    }
            }
            if controller.busy || controller.state.activePane.loading {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(.white.opacity(pathFocused ? 0.10 : 0.05), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(pathFocused ? HUD.accent.opacity(0.7) : .white.opacity(0.08), lineWidth: 1)
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    @ViewBuilder private var statusBar: some View {
        HStack(spacing: 8) {
            if controller.newFolderName != nil {
                Image(systemName: "folder.badge.plus").foregroundStyle(HUD.accent)
                TextField("", text: Binding(
                    get: { controller.newFolderName ?? "" },
                    set: { controller.newFolderName = $0 }),
                    prompt: Text("Folder name").foregroundStyle(HUD.faint))
                    .textFieldStyle(.plain)
                    .foregroundStyle(HUD.ink)
                    .focused($nameFocused)
                    .onSubmit {
                        controller.createFolder()
                        FilesPanel.shared.endEditing()
                    }
                Text("Enter makes it in \(controller.state.activePane.directory.lastPathComponent), Esc cancels")
                    .foregroundStyle(HUD.faint)
            } else if let status = controller.status {
                if let symbol = status.symbol {
                    Image(systemName: symbol).foregroundStyle(status.color)
                }
                Text(status.text)
                    .foregroundStyle(status.tone == .neutral ? HUD.dim : status.color)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } else {
                Text("Tab switches panes. Enter opens. Backspace goes up.")
                    .foregroundStyle(HUD.faint)
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11.5, weight: .medium))
        .padding(.horizontal, 18)
        .frame(height: 30)
    }

    private var keyBar: some View {
        let hasSelection = controller.state.activePane.selection != nil
        return HStack(spacing: 6) {
            KeyButton(key: "F3", label: "View", enabled: hasSelection) { controller.handle(.function(3)) }
            KeyButton(key: "F4", label: "Edit", enabled: hasSelection) { controller.handle(.function(4)) }
            KeyButton(key: "F5", label: "Copy", enabled: hasSelection && !controller.busy) { controller.handle(.function(5)) }
            KeyButton(key: "F6", label: "Move", enabled: hasSelection && !controller.busy) { controller.handle(.function(6)) }
            KeyButton(key: "F7", label: "New Folder", enabled: true) { controller.handle(.function(7)) }
            KeyButton(key: "F8", label: "Trash", enabled: hasSelection) { controller.handle(.function(8)) }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
    }
}

extension FilesStatus {
    var color: Color {
        switch tone {
        case .neutral: return HUD.dim
        case .good: return HUD.good
        case .bad: return HUD.bad
        }
    }

    var symbol: String? {
        switch tone {
        case .neutral: return nil
        case .good: return "checkmark.circle.fill"
        case .bad: return "xmark.octagon.fill"
        }
    }
}

struct PaneView: View {
    let controller: FilesController
    let side: PaneSide
    @Environment(\.hudOffscreen) private var offscreen

    private var pane: PaneState { controller.state[side] }
    private var active: Bool { controller.state.active == side }
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 12, style: .continuous) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(active ? HUD.ink : HUD.dim)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(count)
                    .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(HUD.faint)
            }
            .padding(.horizontal, 12)
            .frame(height: 30)

            HStack(spacing: 0) {
                Text("Name").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 30)
                Text("Size").frame(width: 72, alignment: .trailing)
                Text("Modified").frame(width: 96, alignment: .trailing)
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(HUD.faint)
            .padding(.horizontal, 10)
            .padding(.bottom, 4)

            rows
        }
        .background(.white.opacity(active ? 0.05 : 0.02), in: shape)
        .overlay {
            shape.strokeBorder(active ? HUD.accent.opacity(0.55) : .white.opacity(0.07), lineWidth: 1)
        }
    }

    private var title: String {
        pane.directory.path == "/" ? "Macintosh HD" : pane.directory.lastPathComponent
    }

    private var count: String {
        pane.items.count == 1 ? "1 item" : "\(pane.items.count) items"
    }

    @ViewBuilder private var rows: some View {
        if pane.items.isEmpty {
            VStack {
                Spacer()
                Text(pane.loading ? "Loading…" : "This folder is empty.")
                    .font(.system(size: 12))
                    .foregroundStyle(HUD.faint)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else if offscreen {
            // ScrollView is an NSScrollView underneath and renders empty
            // offscreen; the same rows, unscrolled, are what a snapshot needs.
            VStack(spacing: 1) {
                ForEach(Array(pane.items.enumerated()), id: \.element.id) { index, item in
                    FileRow(item: item, selected: index == pane.selected, paneActive: active)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 6)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 1) {
                        ForEach(Array(pane.items.enumerated()), id: \.element.id) { index, item in
                            FileRow(
                                item: item,
                                selected: index == pane.selected,
                                paneActive: active)
                            .id(item.id)
                            .onTapGesture(count: 2) {
                                controller.pick(side, index: index)
                                controller.activate()
                            }
                            .onTapGesture { controller.pick(side, index: index) }
                        }
                    }
                    .padding(.horizontal, 6)
                    .padding(.bottom, 6)
                }
                .scrollIndicators(.automatic)
                .onChange(of: pane.selected) { _, _ in
                    if let id = pane.selection?.id { proxy.scrollTo(id) }
                }
            }
        }
    }
}

struct FileRow: View {
    let item: FileItem
    let selected: Bool
    let paneActive: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 0) {
            icon
                .frame(width: 18, height: 18)
                .padding(.trailing, 8)
            Text(item.name)
                .font(.system(size: 12.5))
                .foregroundStyle(HUD.ink)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(FileFormat.size(item.size))
                .frame(width: 72, alignment: .trailing)
            Text(FileFormat.date(item.modified))
                .frame(width: 96, alignment: .trailing)
        }
        .font(.system(size: 11).monospacedDigit())
        .foregroundStyle(selected ? HUD.ink : HUD.dim)
        .padding(.horizontal, 6)
        .frame(height: 26)
        .background(fill, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }

    private var fill: Color {
        if selected { return paneActive ? HUD.accent.opacity(0.26) : .white.opacity(0.10) }
        return hovering ? .white.opacity(0.06) : .clear
    }

    @ViewBuilder private var icon: some View {
        if let image = item.icon?.image {
            Image(nsImage: image).resizable().interpolation(.high)
        } else {
            Image(systemName: item.isDirectory ? "folder.fill" : "doc")
                .font(.system(size: 13))
                .foregroundStyle(item.isDirectory ? HUD.accent : HUD.dim)
        }
    }
}

struct KeyButton: View {
    let key: String
    let label: String
    let enabled: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(key)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(HUD.accent)
                    .padding(.horizontal, 5)
                    .frame(height: 17)
                    .background(HUD.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                Text(label)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(HUD.ink)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 32)
            .background(.white.opacity(hovering && enabled ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .onHover { hovering = $0 }
        .help("\(label) (\(key))")
    }
}
