// appctl: drive one app's windows through the accessibility API, in the
// background. Nothing here moves the real mouse, raises a window or steals
// focus: presses go through AXPress, text through AXValue, keys to the app's
// pid, and screenshots come from ScreenCaptureKit by window id, so a hidden
// or off-Space window still captures.
//
// Built by mac/bin/chewie on first use (swiftc -swift-version 5), because a
// Swift 6 language-mode build broke Gavin's 6.1.2 toolchain once already.

import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ wid: UnsafeMutablePointer<CGWindowID>) -> AXError

// MARK: output

func emit(_ obj: Any) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ message: String, code: Int32 = 1, fix: String? = nil) -> Never {
    var obj: [String: Any] = ["error": message]
    if let fix = fix { obj["fix"] = fix }
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    FileHandle.standardError.write(data)
    FileHandle.standardError.write("\n".data(using: .utf8)!)
    exit(code)
}

// MARK: AX helpers

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value
}

func str(_ el: AXUIElement, _ name: String) -> String? {
    guard let v = attr(el, name) else { return nil }
    if let s = v as? String { return s.isEmpty ? nil : s }
    if let n = v as? NSNumber { return n.stringValue }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func actions(_ el: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] else { return [] }
    return arr
}

func settable(_ el: AXUIElement, _ name: String) -> Bool {
    var ok = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(el, name as CFString, &ok) == .success && ok.boolValue
}

func frame(_ el: AXUIElement) -> CGRect? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point)
    AXValueGetValue(s as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

func label(_ el: AXUIElement) -> String? {
    str(el, kAXTitleAttribute) ?? str(el, kAXDescriptionAttribute)
        ?? str(el, "AXLabel") ?? str(el, kAXHelpAttribute)
}

// MARK: app and window resolution

func resolveApp(_ query: String) -> NSRunningApplication {
    let apps = NSWorkspace.shared.runningApplications
    if let a = apps.first(where: { $0.bundleIdentifier == query }) { return a }
    let q = query.lowercased()
    if let a = apps.first(where: { ($0.localizedName ?? "").lowercased() == q }) { return a }
    if let a = apps.first(where: { $0.activationPolicy == .regular && ($0.localizedName ?? "").lowercased().contains(q) }) { return a }
    fail("no running app matches \(query)", fix: "open it first: open -gja \"\(query)\" (the -g keeps it in the background)")
}

struct Win {
    let element: AXUIElement
    let id: CGWindowID
    let title: String?
    let frame: CGRect?
    let minimized: Bool
}

func windows(of app: NSRunningApplication) -> [Win] {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    var list = (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    // Right after a press the app is mid-update and AXWindows comes back empty
    // for a moment: four back-to-back presses on hidden Calculator, 2026-10-09,
    // failed with "no windows" while `windows` a second later listed it fine.
    var tries = 0
    while list.isEmpty && tries < 8 {
        usleep(80_000); tries += 1
        list = (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    }
    return list.map { el in
        var wid: CGWindowID = 0
        _ = _AXUIElementGetWindow(el, &wid)
        let minimized = (attr(el, kAXMinimizedAttribute) as? Bool) ?? false
        return Win(element: el, id: wid, title: str(el, kAXTitleAttribute), frame: frame(el), minimized: minimized)
    }
}

func pickWindow(_ app: NSRunningApplication, _ wanted: CGWindowID?) -> Win {
    let wins = windows(of: app)
    if wins.isEmpty {
        if !AXIsProcessTrusted() {
            fail("accessibility is not granted to this process", code: 2,
                 fix: "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"")
        }
        fail("\(app.localizedName ?? "app") has no windows", fix: "open a window, or use `menu` which needs none")
    }
    if let w = wanted {
        guard let win = wins.first(where: { $0.id == w }) else { fail("window \(w) not found; run `windows` again") }
        return win
    }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    if let main = attr(root, kAXFocusedWindowAttribute) {
        let mainEl = main as! AXUIElement
        if let hit = wins.first(where: { CFEqual($0.element, mainEl) }) { return hit }
    }
    return wins[0]
}

// MARK: snapshot (the indexed element list, saved so a later press can revalidate)

struct Node {
    let path: [Int]
    let role: String
    let label: String?
    let value: String?
    let frame: CGRect?
    let actions: [String]
    let editable: Bool
}

let interestingRoles: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXTextField",
    "AXTextArea", "AXSearchField", "AXComboBox", "AXLink", "AXSlider", "AXTab", "AXMenuItem",
    "AXRow", "AXCell", "AXDisclosureTriangle", "AXIncrementor", "AXSegmentedControl", "AXStaticText",
]

func walk(_ el: AXUIElement, path: [Int], depth: Int, into out: inout [Node], limit: Int) {
    if out.count >= limit || depth > 40 { return }
    let role = str(el, kAXRoleAttribute) ?? "?"
    let acts = actions(el)
    let editable = settable(el, kAXValueAttribute) && ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"].contains(role)
    let lbl = label(el)
    var value = str(el, kAXValueAttribute)
    if let v = value, v.count > 120 { value = String(v.prefix(120)) + "..." }
    let actionable = acts.contains("AXPress") || acts.contains("AXConfirm") || editable
    let readable = role == "AXStaticText" && (value != nil || lbl != nil)
    if (actionable && interestingRoles.contains(role)) || (actionable && lbl != nil) || readable {
        out.append(Node(path: path, role: role, label: lbl, value: value, frame: frame(el), actions: acts, editable: editable))
    }
    for (i, child) in children(el).enumerated() {
        walk(child, path: path + [i], depth: depth + 1, into: &out, limit: limit)
    }
}

func cacheURL(_ app: NSRunningApplication) -> URL {
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".cache/chewbacca/appctl")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("\(app.bundleIdentifier ?? "pid\(app.processIdentifier)").json")
}

func nodeJSON(_ n: Node, _ i: Int, origin: CGPoint) -> [String: Any] {
    var o: [String: Any] = ["i": i, "role": n.role, "path": n.path]
    if let l = n.label { o["label"] = l }
    if let v = n.value { o["value"] = v }
    if let f = n.frame {
        o["frame"] = [Int(f.minX - origin.x), Int(f.minY - origin.y), Int(f.width), Int(f.height)]
    }
    if n.editable { o["editable"] = true }
    if !n.actions.isEmpty { o["actions"] = n.actions.filter { !$0.hasPrefix("AXScroll") } }
    return o
}

func snapshot(_ app: NSRunningApplication, _ win: Win, limit: Int) -> [[String: Any]] {
    var nodes: [Node] = []
    walk(win.element, path: [], depth: 0, into: &nodes, limit: limit)
    // Same mid-update gap as AXWindows: a `see` right after a press on hidden
    // Calculator walked zero elements, saved that, and every later press then
    // failed "no element". Re-walk for up to ~1.5s before saving an empty tree.
    var tries = 0
    while nodes.isEmpty && tries < 15 {
        usleep(100_000); tries += 1
        walk(win.element, path: [], depth: 0, into: &nodes, limit: limit)
    }
    let origin = win.frame?.origin ?? .zero
    let list = nodes.enumerated().map { nodeJSON($0.element, $0.offset, origin: origin) }
    let saved: [String: Any] = ["app": app.bundleIdentifier ?? "", "window": Int(win.id), "elements": list,
                                "taken": ISO8601DateFormatter().string(from: Date())]
    if let data = try? JSONSerialization.data(withJSONObject: saved) { try? data.write(to: cacheURL(app)) }
    return list
}

// Resolve an element by snapshot index or label, then check it is still the
// element the agent saw: same role and label at the same path. A UI that
// rebuilt itself since `see` gets refused, not pressed blind.
func resolveElement(_ app: NSRunningApplication, _ ref: String, window: CGWindowID?) -> (AXUIElement, [String: Any]) {
    guard let data = try? Data(contentsOf: cacheURL(app)),
          let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let elements = saved["elements"] as? [[String: Any]],
          let wid = saved["window"] as? Int else {
        fail("no snapshot for this app", fix: "run `chewie app see <app>` first")
    }
    if let w = window, Int(w) != wid { fail("snapshot is for window \(wid), not \(w)", fix: "run `see` on that window") }
    var entry: [String: Any]?
    // "12" or "#12" is a snapshot index; "label:5" forces a label, for
    // Calculator's digit buttons, whose labels are numbers.
    let forcedLabel = ref.hasPrefix("label:")
    let bare = ref.hasPrefix("#") ? String(ref.dropFirst()) : ref
    if !forcedLabel, let i = Int(bare) {
        entry = elements.first { ($0["i"] as? Int) == i }
    } else {
        let q = (forcedLabel ? String(ref.dropFirst(6)) : ref).lowercased()
        let exact = elements.filter { (($0["label"] as? String) ?? "").lowercased() == q }
        let loose = elements.filter { (($0["label"] as? String) ?? "").lowercased().contains(q) }
        let hits = exact.isEmpty ? loose : exact
        if hits.count > 1 {
            emit(["error": "ambiguous label", "candidates": hits])
            exit(3)
        }
        entry = hits.first
    }
    guard let e = entry, let path = e["path"] as? [Int] else {
        fail("no element \(ref) in the snapshot", fix: "run `see` again, or `find` to match by meaning")
    }
    let win = pickWindow(app, CGWindowID(wid))
    var el = win.element
    for idx in path {
        let kids = children(el)
        guard idx < kids.count else { fail("element \(ref) is gone; the window changed", fix: "run `see` again") }
        el = kids[idx]
    }
    let role = str(el, kAXRoleAttribute) ?? "?"
    if role != (e["role"] as? String) || label(el) != (e["label"] as? String) {
        fail("element \(ref) changed since `see` (now \(role) \(label(el) ?? "unlabeled"))", fix: "run `see` again")
    }
    return (el, e)
}

// MARK: irreversible-action gate
//
// Fails closed. Every text the element exposes is checked, not just its title
// (a Delete button labeled only through AXDescription or AXHelp walked past the
// first version of this gate), and a button that exposes no text at all is
// refused too, because nothing proves it is harmless. Security review of
// cbd074b3, 2026-10-09.

let irreversible = try! NSRegularExpression(
    pattern: "\\b(send|submit|delete|erase|remove|discard|trash|archive|pay|purchase|buy|order|checkout|"
        + "publish|post|reply|forward|share|empty|sign out|log ?out|sign|confirm|approve|accept|agree|allow|"
        + "install|uninstall|transfer|unsubscribe|reset|wipe|format|overwrite|replace|quit|close|"
        + "don.t save|leave|end|block|revoke|deactivate|cancel subscription)\\b",
    options: [.caseInsensitive])

func texts(_ el: AXUIElement) -> [String] {
    [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, kAXValueAttribute, "AXLabel",
     kAXIdentifierAttribute, kAXRoleDescriptionAttribute]
        .compactMap { str(el, $0) }
}

func gate(_ el: AXUIElement, what: String, yes: Bool) {
    if yes { return }
    let role = str(el, kAXRoleAttribute) ?? ""
    let all = texts(el).filter { $0 != (str(el, kAXRoleDescriptionAttribute) ?? "\u{0}") }
    if all.isEmpty && ["AXButton", "AXMenuItem", "AXMenuButton", "AXLink"].contains(role) {
        fail("\(what) has no label, so nothing shows it is safe; refused without --yes", code: 4,
             fix: "look at it with `see --shot`, confirm with the person, then repeat with --yes")
    }
    for t in all {
        if irreversible.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil {
            fail("\"\(t)\" looks irreversible, refused without --yes", code: 4,
                 fix: "confirm with the person, then repeat with --yes")
        }
    }
}

func gateText(_ t: String, yes: Bool) {
    if yes { return }
    if irreversible.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil {
        fail("\"\(t)\" looks irreversible, refused without --yes", code: 4,
             fix: "confirm with the person, then repeat with --yes")
    }
}

// Keys that commit whatever has focus: Return/Enter submit, Space presses a
// focused button, Delete removes, and cmd+Q/W/D quit, close and Don't Save.
func keyCommits(_ combo: String) -> Bool {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    guard let key = parts.last else { return true }
    if ["return", "enter", "space", "delete", "backspace", "forward_delete"].contains(key) { return true }
    return parts.contains("cmd") || parts.contains("command")
        ? ["q", "w", "d", "s"].contains(key) : false
}

// MARK: screenshot by window id (works when hidden, minimized or off-Space)

func capture(_ wid: CGWindowID, to path: String, scale: Double) {
    let sem = DispatchSemaphore(value: 0)
    var problem: String?
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let w = content.windows.first(where: { $0.windowID == wid }) else {
                problem = "window \(wid) is not capturable"; sem.signal(); return
            }
            let filter = SCContentFilter(desktopIndependentWindow: w)
            let cfg = SCStreamConfiguration()
            let px = Double(filter.pointPixelScale) * scale
            cfg.width = max(1, Int(w.frame.width * px))
            cfg.height = max(1, Int(w.frame.height * px))
            cfg.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
            let rep = NSBitmapImageRep(cgImage: image)
            try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
        } catch {
            problem = "\(error.localizedDescription)"
        }
        sem.signal()
    }
    sem.wait()
    if let p = problem {
        fail("screenshot failed: \(p)", code: 2,
             fix: "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture\"")
    }
}

// MARK: keys to a pid

let keyCodes: [String: CGKeyCode] = [
    "return": 36, "enter": 76, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "forward_delete": 117, "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119,
    "pageup": 116, "pagedown": 121,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
    "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
    "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
]

func sendKey(_ pid: pid_t, _ combo: String) {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    guard let keyName = parts.last, let code = keyCodes[keyName] else { fail("unknown key in \(combo)") }
    var flags: CGEventFlags = []
    for m in parts.dropLast() {
        switch m {
        case "cmd", "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option", "opt": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default: fail("unknown modifier \(m)")
        }
    }
    let src = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
        guard let ev = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down) else { fail("could not build key event") }
        ev.flags = flags
        ev.postToPid(pid)
    }
}

// MARK: menus

func menuBar(_ app: NSRunningApplication) -> AXUIElement {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    guard let bar = attr(root, kAXMenuBarAttribute) else { fail("no menu bar (is accessibility granted?)", code: 2) }
    return bar as! AXUIElement
}

func menuItems(_ el: AXUIElement) -> [AXUIElement] {
    // A bar item or a submenu-bearing item holds one AXMenu child whose children are the items.
    let kids = children(el)
    if kids.count == 1, str(kids[0], kAXRoleAttribute) == "AXMenu" { return children(kids[0]) }
    return kids
}

func norm(_ s: String) -> String {
    s.lowercased().trimmingCharacters(in: .whitespaces)
        .replacingOccurrences(of: "\u{2026}", with: "").replacingOccurrences(of: "...", with: "")
}

func walkMenu(_ app: NSRunningApplication, _ path: [String]) -> AXUIElement {
    var el = menuBar(app)
    for step in path {
        let items = menuItems(el)
        guard let hit = items.first(where: { norm(str($0, kAXTitleAttribute) ?? "") == norm(step) }) else {
            let titles = items.compactMap { str($0, kAXTitleAttribute) }
            emit(["error": "no menu item \(step)", "available": titles])
            exit(3)
        }
        el = hit
    }
    return el
}

// MARK: commands

// ScreenCaptureKit asserts in CGS_REQUIRE_INIT from a bare CLI unless the
// window-server connection exists, which NSApplication.shared opens.
_ = NSApplication.shared

var args = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String) -> Bool {
    if let i = args.firstIndex(of: name) { args.remove(at: i); return true }
    return false
}
func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let v = args[i + 1]; args.removeSubrange(i...(i + 1)); return v
}

let yes = flag("--yes")
let windowOpt = option("--window").flatMap { UInt32($0) }.map { CGWindowID($0) }
let shotOpt = option("--shot")
let scaleOpt = option("--scale").flatMap(Double.init) ?? 1.0
let limitOpt = option("--limit").flatMap(Int.init) ?? 400

guard let cmd = args.first else {
    print("""
    appctl <command> ...   background control of one app, no mouse, no focus steal
      apps                              running apps with windows
      trusted                           is accessibility granted to this process
      windows <app>                     window ids, titles, minimized/off-screen state
      see <app> [--window ID] [--shot PNG] [--scale S] [--limit N]
                                        indexed actionable elements (saved for press/set)
      press <app> <N|label> [--yes]     AXPress the element, revalidated against `see`
      set <app> <N|label> <text> [--yes]  write a text field's value
      focus <app> <N|label>             move keyboard focus to an element
      key <app> <combo> [--yes]         key to the app's pid: return, cmd+s, shift+tab
      menu <app> [Top [Sub ...]] [--list] [--yes]
                                        list a menu, or press the leaf
      shot <app> [--window ID] --out PNG [--scale S]
                                        capture a window even if hidden or off-Space
      raise <app> [--window ID]         unminimize/unhide (only when asked)
    """)
    exit(0)
}
args.removeFirst()

switch cmd {
case "trusted":
    emit(["trusted": AXIsProcessTrusted()])

case "apps":
    let list = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { a -> [String: Any] in
        ["name": a.localizedName ?? "", "bundle": a.bundleIdentifier ?? "", "pid": Int(a.processIdentifier),
         "active": a.isActive, "hidden": a.isHidden, "windows": windows(of: a).count]
    }
    emit(list)

case "windows":
    guard let q = args.first else { fail("windows needs an app") }
    let app = resolveApp(q)
    emit(windows(of: app).map { w -> [String: Any] in
        var o: [String: Any] = ["window": Int(w.id), "minimized": w.minimized, "hidden": app.isHidden]
        if let t = w.title { o["title"] = t }
        if let f = w.frame { o["bounds"] = [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)] }
        return o
    })

case "see":
    guard let q = args.first else { fail("see needs an app") }
    let app = resolveApp(q)
    let win = pickWindow(app, windowOpt)
    let list = snapshot(app, win, limit: limitOpt)
    var out: [String: Any] = ["app": app.localizedName ?? "", "bundle": app.bundleIdentifier ?? "",
                              "window": Int(win.id), "title": win.title ?? "", "elements": list,
                              "frame_origin": "window top-left, points"]
    if let s = shotOpt { capture(win.id, to: s, scale: scaleOpt); out["shot"] = s }
    emit(out)

case "press", "focus":
    guard args.count >= 2 else { fail("\(cmd) needs an app and an element") }
    let app = resolveApp(args[0])
    let (el, e) = resolveElement(app, args[1], window: windowOpt)
    if cmd == "press" {
        gate(el, what: "element \(args[1])", yes: yes)
        let acts = actions(el)
        let action = acts.contains("AXPress") ? "AXPress" : (acts.contains("AXConfirm") ? "AXConfirm" : (acts.first ?? "AXPress"))
        let r = AXUIElementPerformAction(el, action as CFString)
        // cannotComplete is what a press returns when it opened a modal sheet
        // and the app blocked before replying; the press itself landed. Seen on
        // Photos' iCloud checkbox 2026-10-09: two errors, both presses worked.
        if r != .success && r != .cannotComplete { fail("\(action) failed: AXError \(r.rawValue)") }
        emit(["pressed": e, "action": action, "returned": r == .success ? "ok" : "cannotComplete (often a sheet opened; run see)"])
    } else {
        let r = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        if r != .success { fail("focus failed: AXError \(r.rawValue)") }
        emit(["focused": e])
    }

case "set":
    guard args.count >= 3 else { fail("set needs an app, an element and text") }
    let app = resolveApp(args[0])
    let (el, e) = resolveElement(app, args[1], window: windowOpt)
    guard settable(el, kAXValueAttribute) else { fail("element \(args[1]) is not writable", fix: "focus it, then `key`") }
    // Writing a value commits nothing by itself, but a field labeled for an
    // amount, recipient or confirmation is part of an irreversible flow.
    for t in texts(el) where t != (str(el, kAXValueAttribute) ?? "\u{0}") { gateText(t, yes: yes) }
    let r = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, args[2] as CFString)
    if r != .success { fail("set failed: AXError \(r.rawValue)") }
    let readBack = str(el, kAXValueAttribute) ?? ""
    emit(["set": e, "value": readBack, "verified": readBack == args[2]])

case "key":
    guard args.count >= 2 else { fail("key needs an app and a combo") }
    let app = resolveApp(args[0])
    if keyCommits(args[1]) && !yes {
        fail("\(args[1]) can submit, press or delete whatever has focus; refused without --yes", code: 4,
             fix: "confirm with the person, then repeat with --yes")
    }
    sendKey(app.processIdentifier, args[1])
    emit(["key": args[1], "pid": Int(app.processIdentifier)])

case "menu":
    guard let q = args.first else { fail("menu needs an app") }
    let app = resolveApp(q)
    let path = Array(args.dropFirst())
    let el = walkMenu(app, path)
    // A path ending on a menu that has items lists it; only a leaf is pressed.
    // Pressing a top-level title opens the menu on screen and blocks the app.
    let list = flag("--list") || path.isEmpty || !menuItems(el).isEmpty
    if list {
        emit(menuItems(el).compactMap { item -> [String: Any]? in
            guard let t = str(item, kAXTitleAttribute) else { return nil }
            let enabled = (attr(item, kAXEnabledAttribute) as? Bool) ?? true
            let sub = !menuItems(item).isEmpty
            return ["title": t, "enabled": enabled, "submenu": sub]
        })
    } else {
        gateText(path.joined(separator: " > "), yes: yes)
        gate(el, what: "menu item \(path.last ?? "")", yes: yes)
        let r = AXUIElementPerformAction(el, kAXPressAction as CFString)
        if r != .success && r != .cannotComplete { fail("menu press failed: AXError \(r.rawValue)") }
        emit(["pressed": path])
    }

case "shot":
    guard let q = args.first, let out = option("--out") ?? shotOpt else { fail("shot needs an app and --out PNG") }
    let app = resolveApp(q)
    let win = pickWindow(app, windowOpt)
    capture(win.id, to: out, scale: scaleOpt)
    emit(["shot": out, "window": Int(win.id)])

case "raise":
    guard let q = args.first else { fail("raise needs an app") }
    let app = resolveApp(q)
    if app.isHidden { app.unhide() }
    let win = pickWindow(app, windowOpt)
    AXUIElementSetAttributeValue(win.element, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    emit(["raised": Int(win.id)])

default:
    fail("unknown command \(cmd)")
}
