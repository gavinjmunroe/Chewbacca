import AppKit
import ApplicationServices
// ScreenCaptureKit predates Sendable; see Backdrop.swift.
@preconcurrency import ScreenCaptureKit

/// One thing the person pointed at while holding the talk key.
///
/// Backlog 117, "point and say". The Option-Command reticle sends a rectangle
/// and leaves the model to screenshot it and guess what is inside. This sends
/// what is actually there: the accessibility element under the pointer, with
/// its role, its name, its frame and, in a browser, the page and DOM id, plus a
/// crop of it on disk. "Make 1 bigger, delete 2" then names two real things.
public struct PointedElement: Sendable, Equatable {
    /// Counted from 1 within one hold of the talk key, and drawn on the glass
    /// with the same number, so what the person says matches what they see.
    public var number: Int
    /// The AX role, or `region` for a drag.
    public var role: String
    public var subrole: String?
    /// The best human name the element carries. See `name(from:)`.
    public var name: String?
    /// Its value, when that is text and not the name already.
    public var value: String?
    public var app: String?
    public var pid: Int32?
    /// The page, when the element is inside a browser's web area.
    public var url: String?
    public var domId: String?
    public var domClasses: [String]
    /// Points, top-left origin, the same space as the `g` region line.
    public var frame: CGRect
    /// A PNG of the frame plus a margin, when Screen Recording is granted.
    public var crop: String?
    /// Which press of the talk key this was drawn in. The crop and `press`
    /// carry it too, so neither can land on a later hold's mark of the same
    /// number.
    public var hold: Int = 0

    public init(
        number: Int, role: String, subrole: String? = nil, name: String? = nil,
        value: String? = nil, app: String? = nil, pid: Int32? = nil,
        url: String? = nil, domId: String? = nil, domClasses: [String] = [],
        frame: CGRect, crop: String? = nil
    ) {
        self.number = number
        self.role = role
        self.subrole = subrole
        self.name = name
        self.value = value
        self.app = app
        self.pid = pid
        self.url = url
        self.domId = domId
        self.domClasses = domClasses
        self.frame = frame
        self.crop = crop
    }

    /// How long a numbered mark stays on the glass. The bridge forgets a
    /// pointed element after the same 30 s it gives a region (POINT_TTL), so a
    /// mark never outlives what the next request can still use.
    public static let markLife: Double = 30

    /// Long enough for a button label, a heading or a short paragraph; a whole
    /// text view's contents would swamp the prompt. Guessed, never measured.
    public static let textCap = 200

    /// The name, from the attributes in the order a person would read them.
    ///
    /// The same order HudHand's control walk uses, which was settled on real
    /// Chrome and Finder trees: an AXTitle when there is one, then the
    /// description web content puts its aria-label in, then a placeholder and
    /// help text. A value comes last, because for a text field the value is
    /// what was typed into it, not what the field is.
    public static func name(from attributes: [String: String]) -> String? {
        for key in ["AXTitle", "AXDescription", "AXPlaceholderValue", "AXHelp", "AXValue"] {
            if let text = attributes[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
               !text.isEmpty {
                return String(text.prefix(textCap))
            }
        }
        return nil
    }

    /// What goes up the socket after `pt `: one JSON object, keys sorted so a
    /// line is the same bytes every time, nils and empties left out.
    public var json: String {
        var object: [String: Any] = [
            "n": number,
            "role": role,
            "frame": [
                Int(frame.minX.rounded()), Int(frame.minY.rounded()),
                Int(frame.width.rounded()), Int(frame.height.rounded()),
            ],
        ]
        if let subrole, !subrole.isEmpty { object["subrole"] = subrole }
        if let name, !name.isEmpty { object["name"] = name }
        if let value, !value.isEmpty, value != name { object["value"] = value }
        if let app, !app.isEmpty { object["app"] = app }
        if let pid { object["pid"] = Int(pid) }
        if let url, !url.isEmpty { object["url"] = url }
        if let domId, !domId.isEmpty { object["dom_id"] = domId }
        if !domClasses.isEmpty { object["dom_classes"] = domClasses }
        if let crop, !crop.isEmpty { object["crop"] = crop }
        if hold > 0 { object["hold"] = hold }
        guard let data = try? JSONSerialization.data(
                withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }
}

/// A click or a drag, told apart by how far the pointer travelled.
public enum PointGesture: Equatable, Sendable {
    case click(CGPoint)
    case drag(CGRect)

    /// Under this many points of travel it was a click. A trackpad click moves
    /// the pointer a point or two as the finger presses; the reticle's
    /// 12-point floor for a region stays the floor for a drag.
    public static let clickSlop: CGFloat = 6
    public static let regionFloor: CGFloat = 12

    /// Nil for a drag too small to mean a region and too far to be a click.
    public static func classify(from start: CGPoint, to end: CGPoint) -> PointGesture? {
        let dx = abs(end.x - start.x), dy = abs(end.y - start.y)
        if dx <= clickSlop, dy <= clickSlop { return .click(start) }
        let rect = CGRect(
            x: min(start.x, end.x), y: min(start.y, end.y), width: dx, height: dy)
        guard rect.width > regionFloor, rect.height > regionFloor else { return nil }
        return .drag(rect)
    }
}

/// Reads the accessibility element at a point on screen.
///
/// Needs the Accessibility grant, which Kyber already holds for dictation's
/// keystrokes. Every call is synchronous AX IPC to the app under the pointer,
/// so it is made once per click, never while the pointer moves.
@MainActor
public enum AXInspector {
    /// How far up the tree to look for the web area that carries the page URL.
    /// A deep React page puts a button about 25 levels under it. Guessed,
    /// never measured beyond the LinkedIn tab of 2026-09-23.
    static let parentBudget = 40

    /// Apps already asked to build their web content's tree.
    private static var awakened: Set<pid_t> = []

    /// The element at `point` (top-left global points), or nil when nothing
    /// answers: no grant, a dead app, or the desktop.
    /// Every AX call here waits on the app under the pointer. The default is
    /// 6 s, and a hung app would hold the talk key's turn that long; a healthy
    /// app answers a hit-test in milliseconds. Guessed, never measured.
    static let messagingTimeout: Float = 0.5

    /// The element, and every piece of text it carries, for the refusal: a
    /// button titled "Done" whose help says "Send" is still a send.
    public static func element(at point: CGPoint, number: Int)
        -> (PointedElement, AXUIElement, [String])? {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, messagingTimeout)
        var found: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &found)
                == .success, var element = found
        else { return nil }
        AXUIElementSetMessagingTimeout(element, messagingTimeout)

        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        // Chrome and Electron build their web content's tree only when asked.
        // Asked once per app, then the element is read again, because the
        // first answer from a sleeping tree is the whole web area.
        if pid != 0, !awakened.contains(pid) {
            awakened.insert(pid)
            AXUIElementSetAttributeValue(
                AXUIElementCreateApplication(pid), "AXManualAccessibility" as CFString,
                kCFBooleanTrue)
            var again: AXUIElement?
            if AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &again)
                == .success, let again {
                element = again
                AXUIElementSetMessagingTimeout(element, messagingTimeout)
            }
        }

        var texts: [String: String] = [:]
        for key in ["AXRole", "AXSubrole", "AXTitle", "AXDescription",
                    "AXPlaceholderValue", "AXHelp", "AXValue", "AXDOMIdentifier"] {
            if let text = string(element, key) { texts[key] = text }
        }
        let classes = (attribute(element, "AXDOMClassList") as? [String]) ?? []
        let app = NSRunningApplication(processIdentifier: pid)?.localizedName
        let name = PointedElement.name(from: texts)
        let value = texts["AXValue"].map { String($0.prefix(PointedElement.textCap)) }
        let pointed = PointedElement(
            number: number,
            role: texts["AXRole"] ?? "AXUnknown",
            subrole: texts["AXSubrole"],
            name: name,
            value: value == name ? nil : value,
            app: app,
            pid: pid == 0 ? nil : pid,
            url: pageURL(above: element),
            domId: texts["AXDOMIdentifier"],
            domClasses: Array(classes.prefix(5)),
            frame: frame(of: element) ?? CGRect(origin: point, size: .zero))
        let words = ["AXTitle", "AXDescription", "AXPlaceholderValue", "AXHelp", "AXValue"]
            .compactMap { texts[$0] }
        return (pointed, element, words)
    }

    /// Press it, unless it reads like a send, a payment or a deletion.
    ///
    /// The same line ux-do holds: the agent may press what was pointed at,
    /// and the irreversible ones stay the person's.
    public static func press(_ element: AXUIElement, words: [String]) -> PressOutcome {
        if let refusal = PressOutcome.refusal(for: words) { return refusal }
        // Bounded, because this runs on the main thread and a button that
        // opens a modal can hold AXPress until the dialog closes.
        AXUIElementSetMessagingTimeout(element, 1.0)
        switch AXUIElementPerformAction(element, kAXPressAction as CFString) {
        case .success: return .pressed
        // The press was delivered and the app did not answer in time. It may
        // well have happened, so the agent is told not to press again blind.
        case .cannotComplete: return .unconfirmed
        default: return .failed
        }
    }

    static func pageURL(above element: AXUIElement) -> String? {
        var current: AXUIElement? = element
        for _ in 0..<parentBudget {
            guard let node = current else { return nil }
            AXUIElementSetMessagingTimeout(node, messagingTimeout)
            if string(node, "AXRole") == "AXWebArea" {
                if let url = attribute(node, "AXURL") as? URL { return url.absoluteString }
                if let url = attribute(node, "AXURL") as? NSURL { return url.absoluteString }
                return nil
            }
            current = elementAttribute(node, "AXParent")
        }
        return nil
    }

    static func frame(of element: AXUIElement) -> CGRect? {
        guard let position = box(element, "AXPosition"), let size = box(element, "AXSize")
        else { return nil }
        var point = CGPoint.zero, extent = CGSize.zero
        guard AXValueGetValue(position, .cgPoint, &point),
              AXValueGetValue(size, .cgSize, &extent)
        else { return nil }
        return CGRect(origin: point, size: extent)
    }

    static func attribute(_ element: AXUIElement, _ key: String) -> AnyObject? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success
        else { return nil }
        return value
    }

    /// CF types cast unconditionally in Swift, so the type is checked by ID:
    /// a wrong guess would otherwise crash in the app that holds the grant.
    static func elementAttribute(_ element: AXUIElement, _ key: String) -> AXUIElement? {
        guard let value = attribute(element, key),
              CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    static func box(_ element: AXUIElement, _ key: String) -> AXValue? {
        guard let value = attribute(element, key), CFGetTypeID(value) == AXValueGetTypeID()
        else { return nil }
        return unsafeDowncast(value, to: AXValue.self)
    }

    static func string(_ element: AXUIElement, _ key: String) -> String? {
        guard let text = attribute(element, key) as? String, !text.isEmpty else { return nil }
        return text
    }
}

/// The elements pointed at in the current hold of the talk key, kept so the
/// agent can press one by its number without finding it again.
///
/// An AXUIElement cannot cross the socket, and re-finding "the second card"
/// from a description is the guess this removes. Holding the reference here
/// means `press 2` is the exact element the person clicked.
@MainActor
public final class PointedStore {
    public static let shared = PointedStore()

    struct Held {
        let element: AXUIElement?
        let words: [String]
        let frame: CGRect
    }

    private var held: [Int: Held] = [:]
    public private(set) var count = 0
    /// How many marks the previous hold drew, so a new hold can take them down.
    public private(set) var lastHold = 0
    /// Counts presses of the talk key, from 1.
    public private(set) var hold = 0

    /// A new hold of the talk key starts the numbering again at 1.
    public func begin() {
        lastHold = count
        held = [:]
        count = 0
        hold += 1
    }

    /// The number the next mark will carry.
    public func next() -> Int {
        count += 1
        return count
    }

    public func keep(_ number: Int, element: AXUIElement?, words: [String], frame: CGRect) {
        held[number] = Held(element: element, words: words, frame: frame)
    }

    /// The outcome, and where on screen it happened, for the agent cursor.
    /// A press naming an older hold is stale: a run still going when the
    /// person pressed the talk key again would otherwise press the new hold's
    /// mark of the same number, which it was never told about.
    public func press(_ number: Int, hold: Int?) -> (PressOutcome, CGPoint?) {
        if let hold, hold != self.hold { return (.stale, nil) }
        guard let entry = held[number] else { return (.unknown, nil) }
        let center = CGPoint(x: entry.frame.midX, y: entry.frame.midY)
        guard let element = entry.element else { return (.failed, center) }
        return (AXInspector.press(element, words: entry.words), center)
    }
}

public enum PressOutcome: Equatable, Sendable {
    case pressed
    case unconfirmed
    case failed
    case refused(String)
    case stale
    case unknown

    /// Words that make a press the person's to make. The list ux.py refuses on
    /// (send, pay, delete, submit) plus the near-synonyms a button actually
    /// says. Matched on whole words, so "Sending options" is not "Send".
    static let irreversible: Set<String> = [
        "send", "pay", "delete", "submit", "purchase", "buy", "checkout",
        "remove", "post", "publish", "transfer", "confirm", "order",
        // From review, 2026-10-03: Finder's Move to Trash and Empty Trash,
        // a dialog's Discard, Disk Utility's Erase, X's Reply (which posts),
        // and Share, Invite and Sign, which each reach another person.
        "trash", "discard", "erase", "reply", "share", "invite", "sign",
    ]

    /// A control with no name is refused too. An icon-only button is how a
    /// chat app draws Send (the arrow in Messages, in Slack, in this panel),
    /// and the name is the only thing the refusal can read.
    ///
    /// Every text the control carries is read, not only its name. Only
    /// English is: a label in another language passes, which is why the
    /// prompt also tells the agent the irreversible ones are not its to press.
    public static func refusal(for words: [String]) -> PressOutcome? {
        let texts = words.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !texts.isEmpty else { return .refused("an unnamed control") }
        return texts.first(where: isIrreversible).map { .refused($0) }
    }

    public static func isIrreversible(_ name: String) -> Bool {
        let words = name.lowercased().split { !$0.isLetter }.map(String.init)
        return words.contains { irreversible.contains($0) }
    }

    public var word: String {
        switch self {
        case .pressed: return "pressed"
        case .unconfirmed: return "unconfirmed"
        case .stale: return "stale"
        case .failed: return "failed"
        case .refused: return "refused"
        case .unknown: return "unknown"
        }
    }
}

/// A crop of what was pointed at, written to disk for the model to look at.
///
/// Kyber holds Screen Recording since 2026-10-03 ("yes kyber can have screen
/// recording"), so the crop is taken here, with this app's own windows left out
/// so the numbered marks are not in the picture.
public enum PointCrop {
    /// Context around the element: enough to see the card a button sits on.
    /// Guessed, never measured.
    public static let margin: CGFloat = 16

    public static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".bob/marks", isDirectory: true)
    }

    /// Nil without the grant, or when the frame is on no display.
    @MainActor
    public static func capture(_ frame: CGRect, number: Int) async -> String? {
        guard CGPreflightScreenCaptureAccess() else { return nil }
        guard let content = try? await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true)
        else { return nil }
        let center = CGPoint(x: frame.midX, y: frame.midY)
        guard let display = content.displays.first(where: { $0.frame.contains(center) })
        else { return nil }
        let own = content.applications.filter {
            $0.processID == ProcessInfo.processInfo.processIdentifier
        }
        let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
        // sourceRect is in the display's own points.
        let local = frame
            .insetBy(dx: -margin, dy: -margin)
            .offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
            .intersection(CGRect(origin: .zero, size: display.frame.size))
        guard !local.isNull, local.width >= 4, local.height >= 4 else { return nil }
        let config = SCStreamConfiguration()
        config.sourceRect = local
        let scale = NSScreen.screens.first {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID)
                == display.displayID
        }?.backingScaleFactor ?? 2
        config.width = Int(local.width * scale)
        config.height = Int(local.height * scale)
        config.showsCursor = false
        guard let image = try? await SCScreenshotManager.captureImage(
            contentFilter: filter, configuration: config)
        else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let url = directory.appendingPathComponent("\(stamp)-\(number).png")
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
              (try? png.write(to: url)) != nil
        else { return nil }
        prune()
        return url.path
    }

    /// Crops older than a day go. They are evidence for one request, and a
    /// folder of every click for months is a record nobody asked to keep.
    static func prune(olderThan age: TimeInterval = 86_400) {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return }
        let cutoff = Date().addingTimeInterval(-age)
        for file in files where file.pathExtension == "png" {
            let date = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            if date < cutoff { try? fm.removeItem(at: file) }
        }
    }
}
