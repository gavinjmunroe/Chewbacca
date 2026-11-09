// Chewbacca Week: the weekly dashboard in a native Mac window.
//
// A web page in a browser tab reads as a web page. This is the same page in a
// real window: translucent the way Apple's own apps are, the traffic lights
// floating over the content, light or dark following the system, remembering
// where you put it. The page itself is served by `chewbacca open`; this app
// starts that server when it is not already running.

import Cocoa
import CryptoKit
import WebKit

// Only the port can be changed, and only to a real one. A free-form URL here
// would let whatever launched this app point a window at any page.
let hudPort: Int = {
    if let raw = ProcessInfo.processInfo.environment["CHEWBACCA_HUD_PORT"], let n = Int(raw), (1024...65535).contains(n) {
        return n
    }
    return 7474
}()
let base = "http://localhost:\(hudPort)"
let selfTest = CommandLine.arguments.contains("--selftest")

// The secret `chewbacca open` keeps in a file only this user can read. The
// server answers a challenge with an HMAC of it, which is how this app knows
// the thing on the port is the dashboard and not just something that got there
// first.
func hudToken() -> String? {
    let file = ProcessInfo.processInfo.environment["CHEWBACCA_HUD_TOKEN_FILE"]
        ?? (NSHomeDirectory() + "/.chewbacca/hud.token")
    guard let raw = try? String(contentsOfFile: file, encoding: .utf8) else { return nil }
    let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return token.isEmpty ? nil : token
}

func hex(_ bytes: [UInt8]) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var tries = 0
    var maxTries: Int { selfTest ? 6 : 30 }

    func applicationDidFinishLaunching(_ note: Notification) {
        if !verifiedServer() { startServer() }
        let frame = NSRect(x: 0, y: 0, width: 1120, height: 780)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "This week"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 520, height: 420)
        if !window.setFrameUsingName("ChewbaccaWeek") { window.center() }
        window.setFrameAutosaveName("ChewbaccaWeek")

        let glass = NSVisualEffectView(frame: frame)
        glass.material = .underWindowBackground
        glass.blendingMode = .behindWindow
        glass.state = .followsWindowActiveState
        glass.autoresizingMask = [.width, .height]

        web = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        glass.addSubview(web)
        window.contentView = glass

        buildMenu()
        load()
        if selfTest {
            NSApp.setActivationPolicy(.accessory)
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { self.report() }
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationDidBecomeActive(_ note: Notification) {
        web?.evaluateJavaScript("typeof load === 'function' && load()", completionHandler: nil)
    }

    // The page is only loaded once the server has proved who it is. Until then
    // this keeps asking, starting it if needed, and gives up with a message
    // rather than loading whatever answered.
    func load() {
        DispatchQueue.global().async {
            let ok = self.verifiedServer()
            DispatchQueue.main.async {
                if ok, let url = URL(string: base + "/week?native=1") {
                    self.tries = 0
                    self.web.load(URLRequest(url: url))
                } else if self.tries < self.maxTries {
                    self.tries += 1
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.load() }
                } else {
                    self.web.loadHTMLString(
                        "<body style='font:14px -apple-system;padding:40px;color:gray'>Port \(hudPort) is not answering as Chewbacca. "
                        + "Run <code>chewbacca open</code>, or set CHEWBACCA_HUD_PORT to a free port.</body>", baseURL: nil)
                    if selfTest { print("server not verified"); exit(2) }
                }
            }
        }
    }

    // Stay on the dashboard. Anything else the page tries to navigate to is
    // refused rather than rendered inside this window.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let local = url.scheme == "http" && url.host == "localhost" && url.port == hudPort
        decisionHandler(local || url.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard tries < maxTries else { return }
        tries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.load() }
    }

    func verifiedServer() -> Bool {
        guard let token = hudToken() else { return false }
        let nonce = hex((0..<16).map { _ in UInt8.random(in: 0...255) })
        var verified = false
        let wait = DispatchSemaphore(value: 0)
        var request = URLRequest(url: URL(string: base + "/healthz?n=" + nonce)!)
        request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { wait.signal() }
            guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let proof = json["proof"] as? String else { return }
            let mac = HMAC<SHA256>.authenticationCode(for: Data(nonce.utf8), using: SymmetricKey(data: Data(token.utf8)))
            verified = proof == hex(Array(mac))
        }.resume()
        _ = wait.wait(timeout: .now() + 2)
        return verified
    }

    func startServer() {
        if ProcessInfo.processInfo.environment["CHEWBACCA_WEEK_NO_SPAWN"] != nil { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = ["-lc", "chewbacca open --no-open"]
        var env = ProcessInfo.processInfo.environment
        let home = NSHomeDirectory()
        env["PATH"] = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        task.environment = env
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        try? task.run()
    }

    func report() {
        web.evaluateJavaScript("document.querySelectorAll('.card').length") { value, _ in
            let cards = (value as? Int) ?? 0
            print("cards: \(cards)")
            exit(cards >= 5 ? 0 : 1)
        }
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r").target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Chewbacca Week", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Chewbacca Week", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    @objc func reload() { load() }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.run()
