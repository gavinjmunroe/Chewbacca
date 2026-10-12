// Chewbacca Week: the weekly dashboard in a native Mac window.
//
// A web page in a browser tab reads as a web page. This is the same page in a
// real window: translucent the way Apple's own apps are, the traffic lights
// floating over the content, light or dark following the system, remembering
// where you put it. The page itself is served by `chewbacca open`; this app
// starts that server when it is not already running.

import Cocoa
import WebKit

let base = ProcessInfo.processInfo.environment["CHEWBACCA_HUD_URL"] ?? "http://localhost:7474"
let selfTest = CommandLine.arguments.contains("--selftest")

final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var retries = 0

    func applicationDidFinishLaunching(_ note: Notification) {
        if !serverUp() { startServer() }
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

    func load() {
        web.load(URLRequest(url: URL(string: base + "/week?native=1")!))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard retries < 30 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.load() }
    }

    func serverUp() -> Bool {
        var up = false
        let wait = DispatchSemaphore(value: 0)
        var request = URLRequest(url: URL(string: base + "/healthz?n=00000000")!)
        request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { _, response, _ in
            up = (response as? HTTPURLResponse)?.statusCode == 200
            wait.signal()
        }.resume()
        _ = wait.wait(timeout: .now() + 2)
        return up
    }

    func startServer() {
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
