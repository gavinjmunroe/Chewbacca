// Start a new iMessage group from the background: Messages' AppleScript dictionary cannot make a
// chat (error -1728 on macOS 15.6.1, 2026-11-05), so this fills a compose through the imessage URL
// without activating the app, reads the recipients and body back through accessibility, and only
// then presses return inside that process. Prints what it found. --check stops before the press.
import AppKit
import ApplicationServices

var args = Array(CommandLine.arguments.dropFirst())
let check = args.contains("--check")
args.removeAll { $0 == "--check" }
guard args.count == 2 else {
    print("usage: text-group [--check] +1555,+1666 \"text\"")
    exit(64)
}
let addresses = args[0], body = args[1]

var allowed = CharacterSet.urlQueryAllowed
allowed.remove(charactersIn: "&=+?")
let encoded = body.addingPercentEncoding(withAllowedCharacters: allowed)!
let url = URL(string: "imessage://open?addresses=\(addresses)&body=\(encoded)")!

let conf = NSWorkspace.OpenConfiguration()
conf.activates = false
conf.addsToRecentItems = false
let done = DispatchSemaphore(value: 0)
NSWorkspace.shared.open(url, configuration: conf) { _, _ in done.signal() }
done.wait()
Thread.sleep(forTimeInterval: 2.5)

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.MobileSMS").first else {
    print("Messages isn't running")
    exit(2)
}
let ax = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(ax, 3)

func attr(_ e: AXUIElement, _ n: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil
}
func kids(_ e: AXUIElement) -> [AXUIElement] { attr(e, kAXChildrenAttribute) as? [AXUIElement] ?? [] }

var field: AXUIElement?
var texts: [String] = []
func walk(_ e: AXUIElement, _ depth: Int) {
    if depth > 14 { return }
    let role = attr(e, kAXRoleAttribute) as? String ?? ""
    if role == "AXTextArea" || role == "AXTextField" {
        let v = attr(e, kAXValueAttribute) as? String ?? ""
        if v.contains(body) { field = e }
    }
    for k in ["AXTitle", "AXDescription", "AXValue"] {
        if let s = attr(e, k) as? String, !s.isEmpty, s.count < 200 { texts.append(s) }
    }
    for c in kids(e) { walk(c, depth + 1) }
}

let windows = attr(ax, kAXWindowsAttribute) as? [AXUIElement] ?? []
print("windows \(windows.count)")
let main = windows.first { w in
    guard let v = attr(w, kAXSizeAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { return false }
    var s = CGSize.zero
    AXValueGetValue(v as! AXValue, .cgSize, &s)
    return s.width > 500 && s.height > 300
}
guard let window = main else {
    print("no compose window")
    exit(3)
}
walk(window, 0)
print("body found: \(field != nil)")
let seen = Array(Set(texts)).filter { $0.contains("+") || $0.lowercased().contains("to:") || $0.contains("John") || $0.contains("Gavin") || $0.contains("Noah") }
print("recipient hints: \(seen.prefix(12))")
// Recipient tokens read "Name, +15551234567". Every address has to be there and nobody else, so a
// stale compose or a leftover recipient refuses instead of texting the wrong people.
let tokens = Set(texts.compactMap { t -> String? in
    guard let r = t.range(of: #", \+\d{7,15}$"#, options: .regularExpression) else { return nil }
    return String(t[r].dropFirst(2))
})
let want = Set(addresses.split(separator: ",").map(String.init))
print("recipients read back: \(tokens.sorted())")
guard tokens == want else {
    print("REFUSED: recipients don't match \(want.sorted())")
    exit(5)
}
if check { exit(field == nil ? 4 : 0) }
guard field != nil else { exit(4) }

let src = CGEventSource(stateID: .hidSystemState)
for down in [true, false] {
    let ev = CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: down)!
    ev.postToPid(app.processIdentifier)
    Thread.sleep(forTimeInterval: 0.05)
}
print("pressed return")
