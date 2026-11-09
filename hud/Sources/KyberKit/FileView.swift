import AppKit
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// A file, on the glass.
///
/// "Let's work on my resume, the PDF is in my downloads" should put the resume
/// on screen. Every generative UI system renders to HTML, so showing a real
/// document means converting it, losing its layout, or embedding a viewer in a
/// browser that then cannot float over anything. Rendering natively means the
/// system's own PDF and image machinery does the work and the result is the
/// document, not a picture of one.
///
/// Three shapes cover almost everything a person points at: a paged document, an
/// image, and text. Anything unrecognised is offered as its own metadata rather
/// than as a broken preview, because a wrong preview is worse than none.
struct FileView: View {
    let path: String
    let editable: Bool
    let page: Int
    /// The line to show and select when a text file opens (1-based; 0 for
    /// none): a search hit opens its file at the line that matched.
    var line: Int = 0
    /// Called with the new contents when the person saves a text file, the
    /// version the editor last saw on disk, and whether they chose to
    /// overwrite a file that changed since. Answers what happened.
    let onSave: (String, FileSafety.Stamp?, Bool) -> FileSafety.Outcome
    /// Called with the unsaved draft as the person types, nil once saved.
    var onDirty: (String?) -> Void = { _ in }
    /// Other files open in this same editor, drawn as a strip of names over
    /// it; the one whose path is `path` is the one shown. A press on another
    /// sends its id (`onTab`). Empty, the header is the file's name alone.
    var tabs: [FileTab] = []
    var onTab: ((String) -> Void)?
    /// Paths with an unsaved draft, marked on their tab.
    var unsavedPaths: Set<String> = []
    /// An editor kept from the last time this path was shown, and where to
    /// keep this one as it is typed in (SurfaceStore.keepEditor).
    var kept: (String) -> FileSafety.Kept? = { _ in nil }
    var onKeep: (FileSafety.Kept?) -> Void = { _ in }

    /// One open file: `{"id","path","name"}`.
    struct FileTab: Equatable {
        let id: String
        let path: String
        let name: String

        static func parse(_ items: [JSON]) -> [FileTab] {
            items.compactMap { item in
                guard let o = item.objectValue, let id = o["id"]?.stringValue, let path = o["path"]?.stringValue,
                      !id.isEmpty, !path.isEmpty else { return nil }
                return FileTab(id: id, path: path,
                               name: o["name"]?.display ?? URL(fileURLWithPath: path).lastPathComponent)
            }
        }
    }

    /// A ceiling on what will be read into memory.
    ///
    /// The HUD is a panel on somebody's screen, not a file viewer, and reading a
    /// four hundred megabyte log into a String to show forty lines of it would
    /// stall the display for everything else on the glass.
    private static let maxBytes = 8 * 1024 * 1024

    private var url: URL {
        // `~` expansion only. No path construction, no resolution against a
        // base directory: the panel opens exactly the file it was handed.
        URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    }

    /// Read once, not on every redraw.
    ///
    /// `kind` used to be a computed property called from `body`, which meant
    /// every render hit the disk, decoded the file, and for an image built an
    /// `NSImage` again. A surface redraws whenever anything on it changes, and
    /// a panel holding a live metric next to a document would have re-read that
    /// document several times a second.
    @State private var loaded: Kind?
    @State private var loadedFrom = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            header
            content
        }
        .task(id: path) {
            // Keyed on the path, so pointing the same component at a different
            // file reloads and pointing it at the same one does not.
            guard loadedFrom != path || loaded == nil else { return }
            let read = kind
            loaded = read
            loadedFrom = path
        }
    }

    @ViewBuilder
    private var header: some View {
        if tabs.count > 1, let onTab {
            TabStrip(tabs: tabs, shown: path, unsaved: unsavedPaths, onTab: onTab)
        } else {
            name
        }
    }

    private var name: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 9))
                .foregroundStyle(HUD.accent)
            Text(url.lastPathComponent)
                .font(.system(size: 10, weight: .medium))
                .kerning(0.3)
                .foregroundStyle(HUD.dim)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    @ViewBuilder
    private var content: some View {
        // What was read for an earlier path is never shown under a new one.
        // A bound `path=@/x` re-points this same view: before this, the
        // editor kept the first file's draft and its save went to the second
        // file's path (found 2026-10-11, building the agent card's finder).
        switch (loadedFrom == path ? loaded : nil) ?? .loading {
        case .loading:
            Color.clear.frame(height: 1)

        case .missing:
            Label("Not on disk", systemImage: "questionmark.folder")
                .font(.system(size: 11))
                .foregroundStyle(HUD.faint)

        case .tooBig(let bytes):
            Text("\(bytes / 1_048_576) MB, too large to show")
                .font(.system(size: 11))
                .foregroundStyle(HUD.faint)

        case .pdf:
            PDFPane(url: url, page: page)
                .frame(height: 420)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

        case .image(let image):
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 420)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

        case .text(let body, let stamp):
            TextPane(
                text: body, stamp: stamp, path: url.path, editable: editable, line: line,
                language: Syntax.language(forPath: url.path)
                    ?? Syntax.language(forShebang: String(body.prefix(200).split(separator: "\n").first ?? "")),
                onSave: onSave, onDirty: onDirty, kept: kept(path), onKeep: onKeep)
            // One editor per file: its draft, baseline and stamp are that
            // file's and nobody else's.
            .id(loadedFrom)

        case .opaque(let type):
            Text(type)
                .font(.system(size: 11))
                .foregroundStyle(HUD.faint)
        }
    }

    private enum Kind {
        /// Before the first read finishes. A blank moment beats a flash of
        /// "not on disk" for a file that is there.
        case loading
        case missing
        case tooBig(Int)
        case pdf
        case image(NSImage)
        /// The text and the stamp of the bytes it came from, which a save
        /// is checked against.
        case text(String, FileSafety.Stamp)
        case opaque(String)
    }

    private var kind: Kind {
        let manager = FileManager.default
        guard manager.fileExists(atPath: url.path) else { return .missing }
        let size = (try? manager.attributesOfItem(atPath: url.path))
            .flatMap { $0[.size] as? Int } ?? 0
        if size > Self.maxBytes { return .tooBig(size) }

        let type = UTType(filenameExtension: url.pathExtension.lowercased())
        if type?.conforms(to: .pdf) == true { return .pdf }
        if type?.conforms(to: .image) == true, let image = NSImage(contentsOf: url) {
            return .image(image)
        }
        // Decode as text last and by *trying*, not by extension. A file with no
        // extension is usually text and a list of known extensions is a list
        // that is always missing one.
        if let data = try? Data(contentsOf: url),
           let body = String(data: data, encoding: .utf8) {
            return .text(body, FileSafety.Stamp(data: data))
        }
        return .opaque(type?.localizedDescription ?? "Not text")
    }

    private var icon: String {
        switch loaded ?? .loading {
        case .pdf: return "doc.richtext"
        case .image: return "photo"
        case .text: return editable ? "square.and.pencil" : "doc.plaintext"
        case .missing: return "questionmark.folder"
        case .loading: return "doc"
        default: return "doc"
        }
    }
}

/// Text, read-only or editable, syntax colored when its language is known.
///
/// Editing writes back to the same path on save and nowhere else. That is a real
/// capability and it is bounded on purpose: the panel can only ever overwrite
/// the file it was told to display, and only when somebody typed in it and
/// pressed save.
private struct TextPane: View {
    let text: String
    /// The version on disk when this was read; a save checks it first.
    let stamp: FileSafety.Stamp
    let path: String
    let editable: Bool
    var line: Int = 0
    let language: Syntax.Language?
    let onSave: (String, FileSafety.Stamp?, Bool) -> FileSafety.Outcome
    let onDirty: (String?) -> Void
    /// The draft, baseline and stamp this file had when it was last
    /// switched away from, taken over instead of the disk's text.
    var kept: FileSafety.Kept? = nil
    var onKeep: (FileSafety.Kept?) -> Void = { _ in }

    /// Past this many UTF-16 units the read-only view is drawn plain:
    /// coloring a whole generated file to show its first screen stalls the
    /// glass. Guessed, never measured.
    static let colorLimit = 200_000

    @State private var draft: String = ""
    /// What is on disk as far as this editor knows: the text it loaded or
    /// last saved, and that version's stamp.
    @State private var baseline: String = ""
    @State private var onDisk: FileSafety.Stamp?
    @State private var loaded = false
    @State private var saved = false
    /// The file changed on disk since it was read, and the save was refused.
    @State private var conflict = false
    @State private var failure: String?
    /// A draft an earlier panel on this file closed without saving.
    @State private var rescued: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if editable {
                if let rescued {
                    Notice(
                        text: "Unsaved edits from an earlier panel were kept.",
                        tone: HUD.warn,
                        actions: [
                            ("Restore", { draft = rescued; self.rescued = nil; FileSafety.forget(path) }),
                            ("Discard", { self.rescued = nil; FileSafety.forget(path) }),
                        ])
                }
                if conflict {
                    Notice(
                        text: "Changed on disk since it was opened. Saving now would replace that change.",
                        tone: HUD.warn,
                        actions: [
                            ("Overwrite", { save(force: true) }),
                            ("Reload", reload),
                        ])
                }
                CodeEditor(text: $draft, language: language, line: line)
                    .background(.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 8))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .frame(height: 300)
                HStack(spacing: 8) {
                    Button("Save") { save(force: false) }
                    .buttonStyle(.plain)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(HUD.accent)
                    .keyboardShortcut("s", modifiers: .command)
                    if let failure {
                        Text(failure)
                            .font(.system(size: 10))
                            .foregroundStyle(HUD.bad)
                    } else if saved {
                        Text("saved")
                            .font(.system(size: 10))
                            .foregroundStyle(HUD.good)
                    } else if draft != baseline {
                        Text("edited")
                            .font(.system(size: 10))
                            .foregroundStyle(HUD.warn)
                    }
                }
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    Group {
                        if let language, text.utf16.count <= Self.colorLimit {
                            Text(Self.colored(text, language))
                        } else {
                            Text(text).foregroundStyle(HUD.ink.opacity(0.9))
                        }
                    }
                    .font(.system(size: 11.5, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 340)
            }
        }
        .onAppear {
            guard !loaded else { return }
            if editable, let kept, kept.draft != kept.baseline {
                // Back to a tab with a draft: the draft, and the version it
                // was edited from, so a save still refuses over a change on
                // disk made while another tab was shown.
                draft = kept.draft
                baseline = kept.baseline
                onDisk = kept.stamp
                if kept.stamp != stamp { conflict = true }
            } else {
                draft = text
                baseline = text
                onDisk = stamp
            }
            loaded = true
            if editable, kept == nil, let rescued = FileSafety.rescued(path), rescued != text {
                self.rescued = rescued
            }
        }
        .onChange(of: draft) { _, next in
            saved = false
            failure = nil
            onDirty(next == baseline ? nil : next)
            onKeep(next == baseline ? nil : FileSafety.Kept(draft: next, baseline: baseline, stamp: onDisk))
        }
    }

    private func save(force: Bool) {
        switch onSave(draft, onDisk, force) {
        case .saved(let stamp, _):
            onDisk = stamp
            baseline = draft
            saved = true
            conflict = false
            failure = nil
            FileSafety.forget(path)
            onDirty(nil)
            onKeep(nil)
        case .conflict:
            conflict = true
        case .failed(let message):
            failure = message
        }
    }

    /// Take what is on disk now. The draft being thrown away is kept as a
    /// rescued draft first, so Reload is never the end of it.
    private func reload() {
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        guard let data = try? Data(contentsOf: url),
              let body = String(data: data, encoding: .utf8) else {
            failure = "Could not read \(url.lastPathComponent) again"
            return
        }
        if draft != baseline { FileSafety.rescue(draft: draft, of: path) }
        baseline = body
        onDisk = FileSafety.Stamp(data: data)
        draft = body
        conflict = false
    }

    static func colored(_ text: String, _ language: Syntax.Language) -> AttributedString {
        var state = Syntax.State()
        var out = AttributedString()
        var first = true
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if !first { out += AttributedString("\n") }
            first = false
            out += Syntax.attributed(Syntax.tokens(String(line), language, state: &state))
        }
        return out
    }
}

/// The File surface's editor: an AppKit text view, because SwiftUI's
/// TextEditor takes no attributed text before macOS 26 and the HUD runs on 14.
/// It is plain text in and out; the color is repainted on every edit and never
/// saved. Smart quotes, dashes and spelling fixes are off, because they
/// rewrite code.
struct CodeEditor: NSViewRepresentable {
    @Binding var text: String
    let language: Syntax.Language?
    /// 1-based line to bring into view and select, 0 for none. Applied when
    /// the editor is made and again only when it changes, so typing never
    /// jumps the caret back to it.
    var line: Int = 0

    static let font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        let view = EditingTextView(frame: .zero)
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainer?.widthTracksTextView = true
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        scroll.documentView = view
        view.isRichText = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.font = Self.font
        view.textColor = NSColor(HUD.ink)
        view.insertionPointColor = NSColor(HUD.accent)
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.isContinuousSpellCheckingEnabled = false
        view.textContainerInset = NSSize(width: 4, height: 6)
        view.delegate = context.coordinator
        view.string = text
        if let storage = view.textStorage { Syntax.paint(storage, language, font: Self.font) }
        context.coordinator.shownLine = line
        if line > 0 {
            // After layout, or scrolling has no geometry to scroll to.
            Task { @MainActor in Self.reveal(line, in: view) }
        }
        return scroll
    }

    /// The character range of a 1-based line, or nil past the end.
    static func range(ofLine line: Int, in text: String) -> NSRange? {
        guard line > 0 else { return nil }
        let ns = text as NSString
        var start = 0
        for _ in 1..<line {
            let next = ns.range(of: "\n", range: NSRange(location: start, length: ns.length - start))
            guard next.location != NSNotFound else { return nil }
            start = next.location + 1
        }
        let end = ns.range(of: "\n", range: NSRange(location: start, length: ns.length - start))
        return NSRange(location: start, length: (end.location == NSNotFound ? ns.length : end.location) - start)
    }

    static func reveal(_ line: Int, in view: NSTextView) {
        guard let range = range(ofLine: line, in: view.string) else { return }
        view.setSelectedRange(range)
        view.scrollRangeToVisible(range)
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let view = scroll.documentView as? NSTextView else { return }
        if view.string != text {
            view.string = text
            if let storage = view.textStorage { Syntax.paint(storage, language, font: Self.font) }
        }
        if line != context.coordinator.shownLine {
            context.coordinator.shownLine = line
            Self.reveal(line, in: view)
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeEditor
        var shownLine = 0

        init(_ parent: CodeEditor) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            parent.text = view.string
            if let storage = view.textStorage {
                // Repainting moves no characters, so the caret and the
                // selection stay where the person left them.
                let selected = view.selectedRanges
                Syntax.paint(storage, parent.language, font: CodeEditor.font)
                view.selectedRanges = selected
            }
        }
    }
}

/// The open files over the card's editor, Realm's editor tabs re-drawn for
/// the glass: names only, the shown one in full ink with one lit line under
/// it, the rest in the quiet ink, a dot on one with an unsaved draft. The
/// name is the press (hud/CLAUDE.md, Past the window 2).
private struct TabStrip: View {
    let tabs: [FileView.FileTab]
    let shown: String
    let unsaved: Set<String>
    let onTab: (String) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs, id: \.id) { tab in
                let on = tab.path == shown
                Button { if !on { onTab(tab.id) } } label: {
                    HStack(spacing: 4) {
                        Text(tab.name)
                            .font(Realm.font(Realm.Size.caption, on ? Realm.Weight.medium : Realm.Weight.label))
                            .tracking(Realm.tracking(Realm.Size.caption))
                            .foregroundStyle(on ? Realm.ink : Realm.ink3)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        if unsaved.contains(tab.path) {
                            Circle().fill(HUD.warn).frame(width: 5, height: 5)
                                .accessibilityLabel("unsaved")
                        }
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .overlay(alignment: .bottom) {
                        if on {
                            Rectangle().fill(Realm.accent).frame(height: 1.5)
                                .padding(.horizontal, 5)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(tab.name)\(on ? ", shown" : "")")
            }
            Spacer(minLength: 0)
        }
    }
}

/// One line of warning over the editor, with the buttons that answer it.
private struct Notice: View {
    let text: String
    let tone: Color
    let actions: [(String, () -> Void)]

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9.5))
                .foregroundStyle(tone)
            Text(text)
                .font(.system(size: 10.5))
                .foregroundStyle(HUD.ink.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            ForEach(actions.indices, id: \.self) { index in
                Button(actions[index].0, action: actions[index].1)
                    .buttonStyle(.plain)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(HUD.accent)
                    .frame(minHeight: HitTarget.minimum)
                    .contentShape(Rectangle())
            }
        }
        .padding(.horizontal, 8)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(text)
    }
}

/// The editor's text view, answering the editing keys itself.
///
/// Kyber has no main menu, and on macOS Undo, Redo, Cut, Copy, Paste and
/// Select All reach a text view only through the Edit menu's key
/// equivalents. So `allowsUndo` was on and Command-Z did nothing: the
/// editor kept an undo stack nobody could reach (bd_2026-Code-vz4).
final class EditingTextView: NSTextView {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if Self.handleEditingKey(event, in: self) { return true }
        return super.performKeyEquivalent(with: event)
    }

    /// The one place the editing keys are mapped, testable without a key
    /// window. Answers whether `event` was one of them.
    @discardableResult
    static func handleEditingKey(_ event: NSEvent, in view: NSTextView) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command), !flags.contains(.control), !flags.contains(.option),
              let key = event.charactersIgnoringModifiers?.lowercased()
        else { return false }
        let shift = flags.contains(.shift)
        switch (key, shift) {
        case ("z", false):
            guard view.undoManager?.canUndo == true else { return true }
            view.undoManager?.undo()
        case ("z", true):
            guard view.undoManager?.canRedo == true else { return true }
            view.undoManager?.redo()
        case ("x", false): view.cut(nil)
        case ("c", false): view.copy(nil)
        case ("v", false): view.paste(nil)
        case ("a", false): view.selectAll(nil)
        default: return false
        }
        return true
    }
}

/// A real PDF, drawn by PDFKit.
private struct PDFPane: NSViewRepresentable {
    let url: URL
    let page: Int

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.backgroundColor = .clear
        // No page shadows: they are drawn for a white app window and read as
        // grime on a dark translucent panel.
        view.pageShadowsEnabled = false
        view.document = PDFDocument(url: url)
        goTo(page, in: view)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
        goTo(page, in: view)
    }

    private func goTo(_ number: Int, in view: PDFView) {
        guard number > 1, let document = view.document,
              let target = document.page(at: min(number, document.pageCount) - 1)
        else { return }
        view.go(to: target)
    }
}
