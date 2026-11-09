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
import Vision

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
        // The same mid-update gap: a window listed a moment ago can be missing
        // from one AXWindows read and back in the next.
        var list = wins
        for _ in 0..<8 {
            if let win = list.first(where: { $0.id == w }) { return win }
            usleep(100_000)
            list = windows(of: app)
        }
        fail("window \(w) not found; run `windows` again")
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
    var selected: String? = nil
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
        out.append(Node(path: path, role: role, label: lbl, value: value, frame: frame(el), actions: acts, editable: editable,
                        selected: editable ? str(el, kAXSelectedTextAttribute) : nil))
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
    if let sel = n.selected, !sel.isEmpty { o["selected"] = String(sel.prefix(80)) }
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
    // A partial tree is worse than an empty one, because it gets saved and
    // looks complete: under load 11 on 2026-10-10 Calculator's walk returned
    // only its three title-bar buttons, then all 23 elements a second later,
    // and Jev, offered three unlabeled buttons, rightly answered "none". So
    // walk again until two walks agree on the count, keeping the largest.
    var settle = 0
    while settle < 10 {
        usleep(120_000)
        var again: [Node] = []
        walk(win.element, path: [], depth: 0, into: &again, limit: limit)
        if again.count == nodes.count { break }
        if again.count > nodes.count { nodes = again }
        settle += 1
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
    // Dialog membership is read on the way DOWN the snapshot path. A save
    // sheet's buttons report no usable AXParent chain, so walking up from the
    // button found no sheet and "Save" was pressed under "Do you want to keep
    // this new document?" in the first live test, 2026-10-09.
    lastDialog = isDialog(el, top: true) ? el : nil
    for idx in path {
        let kids = children(el)
        guard idx < kids.count else { fail("element \(ref) is gone; the window changed", fix: "run `see` again") }
        el = kids[idx]
        if lastDialog == nil && isDialog(el) { lastDialog = el }
        if str(el, kAXRoleAttribute) == "AXScrollArea" { lastScrollArea = el }
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

// A press inside a sheet or dialog is judged by the dialog, not the button:
// "OK" under "Permanently delete 172,703 items?" reads as harmless on its own.
// Security review of b5067ff0, 2026-10-09. So inside one, only a known way out
// passes without --yes, and the refusal quotes the dialog's own text.
let safeInDialog: Set<String> = ["cancel", "not now", "later", "back", "no thanks", "dismiss"]

var lastDialog: AXUIElement?
var lastScrollArea: AXUIElement?

// Calculator's one and only window has subrole AXDialog, so a window's
// subrole alone made every digit "inside a dialog" (2026-10-09). A top-level
// window counts only when it carries a default or cancel button, which alerts
// and confirmations have and app windows like Calculator don't.
func isDialog(_ c: AXUIElement, top: Bool = false) -> Bool {
    let role = str(c, kAXRoleAttribute) ?? ""
    let sub = str(c, kAXSubroleAttribute) ?? ""
    if role == "AXSheet" || role == "AXDialog" || sub == "AXSystemDialog" { return true }
    guard sub == "AXDialog" else { return false }
    if !top { return true }
    return attr(c, kAXDefaultButtonAttribute) != nil || attr(c, kAXCancelButtonAttribute) != nil
}

func dialogAncestor(_ el: AXUIElement) -> AXUIElement? {
    if let d = lastDialog { return d }
    var cur: AXUIElement? = el
    for _ in 0..<25 {
        guard let c = cur else { return nil }
        if isDialog(c, top: str(c, kAXRoleAttribute) == "AXWindow") { return c }
        guard let parent = attr(c, kAXParentAttribute) else { return nil }
        cur = (parent as! AXUIElement)
    }
    return nil
}

func dialogText(_ el: AXUIElement) -> String {
    var out: [String] = []
    func collect(_ e: AXUIElement, _ depth: Int) {
        if depth > 12 || out.count > 20 { return }
        if str(e, kAXRoleAttribute) == "AXStaticText", let t = str(e, kAXValueAttribute) ?? label(e) { out.append(t) }
        for c in children(e) { collect(c, depth + 1) }
    }
    collect(el, 0)
    return out.joined(separator: " ")
}

func gate(_ el: AXUIElement, what: String, yes: Bool) {
    if yes { return }
    let own = (label(el) ?? "").lowercased().trimmingCharacters(in: .whitespaces)
    if let dialog = dialogAncestor(el), !safeInDialog.contains(own) {
        let said = String(dialogText(dialog).prefix(200))
        fail("\(what) (\(label(el) ?? "unlabeled")) is inside a dialog that says: \"\(said)\"; refused without --yes",
             code: 4, fix: "read the dialog to the person, confirm, then repeat with --yes")
    }
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

func captureImage(_ wid: CGWindowID, scale: Double, region: CGRect? = nil) -> CGImage {
    let sem = DispatchSemaphore(value: 0)
    var problem: String?
    var shot: CGImage?
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
            var image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
            if let r = region {
                // region is in window points, the same frame `see` reports
                let crop = CGRect(x: r.minX * px, y: r.minY * px, width: r.width * px, height: r.height * px)
                guard let cut = image.cropping(to: crop.integral) else {
                    problem = "region is outside the window"; sem.signal(); return
                }
                image = cut
            }
            shot = image
        } catch {
            problem = "\(error.localizedDescription)"
        }
        sem.signal()
    }
    sem.wait()
    if let p = problem {
        if p.hasPrefix("region") { fail(p, fix: "pick a region inside the window: x0,y0,x1,y1 in window points") }
        fail("screenshot failed: \(p)", code: 2,
             fix: "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture\"")
    }
    return shot!
}

func capture(_ wid: CGWindowID, to path: String, scale: Double, region: CGRect? = nil) {
    let rep = NSBitmapImageRep(cgImage: captureImage(wid, scale: scale, region: region))
    do {
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
    } catch {
        fail("screenshot failed: \(error.localizedDescription)", code: 2)
    }
}

// Is this rectangle inside a window the window server is drawing now? Rules out
// hidden, minimized and another Space in one read, so a HUD marker never frames
// whatever happens to be in front.
func isDrawn(_ app: NSRunningApplication, _ rect: CGRect) -> Bool {
    let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    let drawn = Set(info.compactMap { $0[kCGWindowNumber as String] as? Int })
    let middle = CGPoint(x: rect.midX, y: rect.midY)
    return windows(of: app).contains { drawn.contains(Int($0.id)) && ($0.frame?.contains(middle) ?? false) }
}

// MARK: text recognition, on this Mac with no model call

// The Vision request is the idea from Thuki's src-tauri/src/ocr.rs (Apache-2.0,
// quiet-node/thuki), written fresh for this driver. Runs on the window's own
// pixels, so it reads what accessibility can't (canvas, video, images).
func recognize(_ image: CGImage, fast: Bool, size: CGSize) -> [[String: Any]] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = !fast
    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        fail("text recognition failed: \(error.localizedDescription)", code: 2)
    }
    return (request.results ?? []).compactMap { line -> [String: Any]? in
        guard let best = line.topCandidates(1).first else { return nil }
        // Vision's box is 0 to 1 from the bottom-left; every other frame here
        // is points from the top-left.
        let b = line.boundingBox
        return ["text": best.string, "confidence": (Double(best.confidence) * 100).rounded() / 100,
                "box": [Int(b.minX * size.width), Int((1 - b.maxY) * size.height),
                        Int(b.width * size.width), Int(b.height * size.height)]]
    }
}

func loadImage(_ path: String) -> CGImage {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("\(path) is not a readable image", fix: "pass a PNG or JPEG that exists")
    }
    return image
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


// MARK: scrolling, reading, cropping

func firstScrollArea(_ el: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 30 { return nil }
    if str(el, kAXRoleAttribute) == "AXScrollArea" { return el }
    for c in children(el) { if let hit = firstScrollArea(c, depth: depth + 1) { return hit } }
    return nil
}

// Moves the scroll bar's value, which is what dragging the bar does; no wheel
// event, so nothing reaches the frontmost app. dy is in tenths of the range.
func scroll(_ area: AXUIElement, dy: Double, horizontal: Bool) -> (Double, Double)? {
    let barAttr = horizontal ? kAXHorizontalScrollBarAttribute : kAXVerticalScrollBarAttribute
    guard let barObj = attr(area, barAttr) else { return nil }
    let bar = barObj as! AXUIElement
    let before = (attr(bar, kAXValueAttribute) as? NSNumber)?.doubleValue ?? 0
    let after = min(1, max(0, before + dy / 10))
    AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, NSNumber(value: after))
    let now = (attr(bar, kAXValueAttribute) as? NSNumber)?.doubleValue ?? after
    return (before, now)
}

func allText(_ el: AXUIElement, into out: inout [String], depth: Int = 0) {
    if depth > 40 || out.count > 2000 { return }
    let role = str(el, kAXRoleAttribute) ?? ""
    if role == "AXStaticText" || role == "AXTextArea" || role == "AXTextField" || role == "AXHeading" || role == "AXLink" {
        if let t = str(el, kAXValueAttribute) ?? label(el) { out.append(t) }
    }
    for c in children(el) { allText(c, into: &out, depth: depth + 1) }
}


// MARK: drag, clipboard, screen rectangles

func center(_ el: AXUIElement) -> CGPoint? {
    guard let f = frame(el) else { return nil }
    return CGPoint(x: f.midX, y: f.midY)
}

// Mouse events posted to the app's pid, not the HID stream, so the real
// cursor stays where the person left it. Apps that hit-test against the
// global cursor ignore these; the result says to verify with `see`.
func dragEvents(_ pid: pid_t, from a: CGPoint, to b: CGPoint) {
    let src = CGEventSource(stateID: .hidSystemState)
    func post(_ type: CGEventType, _ p: CGPoint) {
        CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.postToPid(pid)
        usleep(16_000)
    }
    post(.leftMouseDown, a)
    let steps = 12
    for k in 1...steps {
        let t = Double(k) / Double(steps)
        post(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
    }
    post(.leftMouseUp, b)
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
let regionOpt: CGRect? = option("--region").flatMap { v in
    let n = v.split(separator: ",").compactMap { Double($0) }
    return n.count == 4 ? CGRect(x: n[0], y: n[1], width: n[2] - n[0], height: n[3] - n[1]) : nil
}
let horizontal = flag("--horizontal")
let checkOnly = flag("--check")
let expectOpt = option("--expect")

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
      scroll <app> [N|label] <dy> [--horizontal]
                                        move the scroll bar holding N (or the first one) by dy
                                        tenths of its range; + is down/right
      read <app> [--window ID]          every visible text in reading order, for content
      text [app] [--window ID] [--region x0,y0,x1,y1] [--fast] [--plain] [--image PNG]
                                        visible text by on-device OCR, no model call; front app
                                        by default, works on hidden windows
      where <app> <N|label>             the element's rectangle in screen points (for a HUD marker)
      drag <app> <N|label> <N|label|x,y> [--yes]
                                        drag between two elements (or to window point x,y)
                                        with events sent to the app's pid; verify with see
      clip [get | set <text>]           read or write the clipboard
      paste <app> <N|label> <text> [--yes]
                                        insert text at the caret without the clipboard;
                                        falls back to the clipboard only if the app is in front
      shot ... --region x0,y0,x1,y1     crop to a region in window points (zoom)
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
    if let want = expectOpt {
        // The caller showed the person one element and got a tap for it. The
        // snapshot file can be rewritten by any later `see` on this app, so
        // index N alone is not that element: check role, label and path
        // against what was shown. Security review of a1c68f98 (TOCTOU).
        let shown = (try? JSONSerialization.jsonObject(with: Data(want.utf8))) as? [String: Any] ?? [:]
        let same = (shown["role"] as? String) == (e["role"] as? String)
            && (shown["label"] as? String) == (e["label"] as? String)
            && (shown["path"] as? [Int]) == (e["path"] as? [Int])
        if !same { fail("element \(args[1]) is no longer the one that was shown; nothing pressed", code: 5,
                        fix: "ask again so the person sees the current control") }
    }
    if cmd == "press" {
        gate(el, what: "element \(args[1])", yes: yes)
        // --check runs the gate and stops, so a caller can show the person
        // why a press needs their yes before asking for it.
        if checkOnly {
            var out: [String: Any] = ["would_press": e, "gate": "clear"]
            if let f = frame(el) {
                out["screen"] = [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)]
                out["on_screen"] = isDrawn(app, f)
            }
            emit(out); exit(0)
        }
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
    // TextEdit answers cannotComplete while it is still applying a large
    // value, and the value lands anyway (2026-10-10); the read-back below is
    // the real check, so only other errors fail here.
    if r != .success && r != .cannotComplete { fail("set failed: AXError \(r.rawValue)") }
    if r == .cannotComplete { usleep(300_000) }
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
    capture(win.id, to: out, scale: scaleOpt, region: regionOpt)
    emit(["shot": out, "window": Int(win.id)])

case "text":
    let plain = flag("--plain")
    let fast = flag("--fast")
    let started = Date()
    var out: [String: Any] = [:]
    let image: CGImage
    var size: CGSize
    if let path = option("--image") {
        image = loadImage(path)
        size = CGSize(width: image.width, height: image.height)
        out["image"] = path
    } else {
        guard let app = args.first.map(resolveApp) ?? NSWorkspace.shared.frontmostApplication else {
            fail("no app in front", fix: "name one: text <app>")
        }
        let win = pickWindow(app, windowOpt)
        image = captureImage(win.id, scale: scaleOpt, region: regionOpt)
        size = regionOpt?.size ?? win.frame?.size ?? CGSize(width: image.width, height: image.height)
        out["app"] = app.localizedName ?? ""
        out["window"] = Int(win.id)
        out["title"] = win.title ?? ""
    }
    let captured = Date()
    let lines = recognize(image, fast: fast, size: size)
    let text = lines.compactMap { $0["text"] as? String }.joined(separator: "\n")
    if plain {
        if text.isEmpty { FileHandle.standardError.write("# no text found\n".data(using: .utf8)!) } else { print(text) }
        exit(0)
    }
    out["text"] = text
    out["lines"] = lines
    out["box_space"] = "window points, top-left origin"
    out["ms"] = ["capture": Int(captured.timeIntervalSince(started) * 1000), "ocr": Int(Date().timeIntervalSince(captured) * 1000)]
    emit(out)

case "scroll":
    guard args.count >= 2 else { fail("scroll needs an app and dy") }
    let app = resolveApp(args[0])
    guard let dy = Double(args.last!) else { fail("scroll's last argument is dy, a number") }
    var area: AXUIElement?
    if args.count >= 3 {
        let (el, _) = resolveElement(app, args[1], window: windowOpt)
        area = str(el, kAXRoleAttribute) == "AXScrollArea" ? el : lastScrollArea
    } else {
        area = firstScrollArea(pickWindow(app, windowOpt).element)
    }
    guard let a = area else { fail("no scroll area there", fix: "use `key <app> pagedown` after focusing the list") }
    guard let (before, after) = scroll(a, dy: dy, horizontal: horizontal) else {
        let r = AXUIElementPerformAction(a, (dy > 0 ? "AXScrollDownByPage" : "AXScrollUpByPage") as CFString)
        if r != .success { fail("scroll area has no scroll bar and refused paging (AXError \(r.rawValue))") }
        emit(["scrolled": "by page", "direction": dy > 0 ? "down" : "up"]); exit(0)
    }
    emit(["scrolled": ["from": before, "to": after], "moved": abs(after - before) > 0.0001])

case "read":
    guard let q = args.first else { fail("read needs an app") }
    let app = resolveApp(q)
    let win = pickWindow(app, windowOpt)
    var out: [String] = []
    allText(win.element, into: &out)
    emit(["app": app.localizedName ?? "", "window": Int(win.id), "title": win.title ?? "", "text": out])

case "where":
    guard args.count >= 2 else { fail("where needs an app and an element") }
    let app = resolveApp(args[0])
    let (el, e) = resolveElement(app, args[1], window: windowOpt)
    guard let f = frame(el) else { fail("element \(args[1]) has no frame") }
    emit(["element": e, "screen": [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)],
          "space": "screen points, top-left origin of the main display"])

case "drag":
    guard args.count >= 3 else { fail("drag needs an app, a source and a target") }
    let app = resolveApp(args[0])
    let (src, se) = resolveElement(app, args[1], window: windowOpt)
    guard let a = center(src) else { fail("source has no frame") }
    var b: CGPoint
    var target: [String: Any] = [:]
    let nums = args[2].split(separator: ",").compactMap { Double($0) }
    if nums.count == 2 {
        let origin = pickWindow(app, windowOpt).frame?.origin ?? .zero
        b = CGPoint(x: origin.x + nums[0], y: origin.y + nums[1])
        target = ["point": nums]
        // A bare point has no label to check, and whatever sits there (the
        // Trash, a share target) receives the drop. Security review of
        // a1c68f98: unlabeled means unknown, so it needs the person's yes.
        if !yes {
            fail("a drop onto a bare point can't be checked; refused without --yes", code: 4,
                 fix: "drag onto an element by index or label, or confirm and repeat with --yes")
        }
    } else {
        let (dst, de) = resolveElement(app, args[2], window: windowOpt)
        guard let c = center(dst) else { fail("target has no frame") }
        // Dropping onto Trash, an outbox or a share target is the dangerous
        // half of a drag, so the target goes through the same gate as a press.
        gate(dst, what: "drop target \(args[2])", yes: yes)
        b = c; target = de
    }
    gate(src, what: "dragged element \(args[1])", yes: yes)
    dragEvents(app.processIdentifier, from: a, to: b)
    emit(["dragged": se, "to": target, "verify": "run see; some apps ignore events not from the real cursor"])

case "clip":
    let pb = NSPasteboard.general
    if args.first == "set" {
        guard args.count >= 2 else { fail("clip set needs text") }
        pb.clearContents(); pb.setString(args[1], forType: .string)
        emit(["clipboard": "set", "chars": args[1].count])
    } else {
        emit(["clipboard": pb.string(forType: .string) ?? ""])
    }

case "paste":
    guard args.count >= 3 else { fail("paste needs an app, an element and text") }
    let app = resolveApp(args[0])
    let (el, e) = resolveElement(app, args[1], window: windowOpt)
    for t in texts(el) where t != (str(el, kAXValueAttribute) ?? "\u{0}") { gateText(t, yes: yes) }
    let before = str(el, kAXValueAttribute) ?? ""
    // Insert at the caret by writing AXSelectedText: no clipboard, no focus,
    // works in a hidden window. The clipboard route needs a key window: in
    // hidden TextEdit, Edit > Paste was disabled and cmd+V never landed
    // (2026-10-10), and borrowing the clipboard overwrote what the person
    // had copied. So the clipboard is used only when the window is in front.
    // With no caret yet (a window that was never key), AXSelectedText refuses
    // with cannotComplete, so place the caret at the end first.
    if attr(el, kAXSelectedTextRangeAttribute) == nil || before.isEmpty == false {
        var range = CFRange(location: (before as NSString).length, length: 0)
        if let v = AXValueCreate(.cfRange, &range) {
            AXUIElementSetAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, v)
        }
    }
    var r = AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, args[2] as CFString)
    if r == .cannotComplete {
        usleep(150_000)
        r = AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, args[2] as CFString)
    }
    var after = str(el, kAXValueAttribute) ?? ""
    var via = "AXSelectedText"
    if r != .success || after == before {
        guard app.isActive else {
            fail("couldn't insert into element \(args[1]) in the background (AXError \(r.rawValue))",
                 fix: "use `set` to replace the whole value, or raise the app and retry")
        }
        let pb = NSPasteboard.general
        let saved = pb.string(forType: .string)
        pb.clearContents(); pb.setString(args[2], forType: .string)
        AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        sendKey(app.processIdentifier, "cmd+v")
        usleep(400_000)
        pb.clearContents()
        if let s = saved { pb.setString(s, forType: .string) }
        after = str(el, kAXValueAttribute) ?? ""
        via = "clipboard (restored)"
        r = .success
    }
    emit(["pasted": e, "via": via, "landed": after.contains(args[2])])

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
