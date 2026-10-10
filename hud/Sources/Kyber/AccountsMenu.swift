import AppKit

/// The menu bar's way to the HUD's runtime, account and model pick, so it is
/// reachable without speaking. It reads and writes the same store hud-listen
/// does (`~/.bob/hud-accounts.json`) through `hud-accounts`, which keeps the
/// rules in one place (bin/lib/hud_accounts.py); a pick here answers the next
/// request. Rebuilt each time it opens, because a limit can be hit or an
/// account signed in between two looks.
final class AccountsMenu: NSObject, NSMenuDelegate {
    let menu = NSMenu()
    /// Draws the switcher card on the glass, by sending "which account" as a
    /// typed request: hud-listen answers it with no model turn.
    var onShowOnGlass: (() -> Void)?

    private struct Listing: Decodable {
        struct Now: Decodable {
            let name: String
            let label: String
            let model: String
            let auto: Bool
        }
        struct Choice: Decodable {
            let id: String
            let kind: String
            let label: String
            let state: String
            let until: String
            let current: Bool
        }
        struct Model: Decodable {
            let runtime: String
            let value: String?
            let label: String
            let current: Bool
        }
        let now: Now
        let following: String
        let choices: [Choice]
        let models: [Model]
    }

    override init() {
        super.init()
        menu.delegate = self
        menu.autoenablesItems = false
    }

    static var executable: String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ["\(home)/.local/bin/hud-accounts", "/usr/local/bin/hud-accounts",
                "/opt/homebrew/bin/hud-accounts"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// One run of `hud-accounts`, waited on for at most two seconds. `list`
    /// without --probe starts no other program, so it is a Python start and
    /// a file read; two seconds only bounds a wedged interpreter.
    @discardableResult
    private func run(_ arguments: [String]) -> Data? {
        guard let exe = Self.executable else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: exe)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(2)
        while process.isRunning && Date() < deadline { usleep(20_000) }
        if process.isRunning {
            process.terminate()
            return nil
        }
        return pipe.fileHandleForReading.readDataToEndOfFile()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard let data = run(["list", "--json"]),
            let listing = try? JSONDecoder().decode(Listing.self, from: data)
        else {
            let item = NSMenuItem(
                title: Self.executable == nil
                    ? "hud-accounts is not installed. Run setup.sh." : "Couldn't read the pick.",
                action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
            return
        }
        let now = NSMenuItem(
            title: "\(listing.now.name) · \(listing.now.label)"
                + (listing.now.model.isEmpty ? "" : " · \(listing.now.model)"),
            action: nil, keyEquivalent: "")
        now.isEnabled = false
        menu.addItem(now)
        menu.addItem(.separator())

        for choice in listing.choices {
            var title = choice.kind == "account" ? "Claude · \(choice.label)" : choice.label
            switch choice.state {
            case "limit": title += choice.until.isEmpty ? " (limit hit)" : " (out \(choice.until))"
            case "signed out": title += " (signed out)"
            default: break
            }
            let item = NSMenuItem(title: title, action: #selector(use(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = choice.id
            item.state = choice.current ? .on : .off
            item.isEnabled = choice.state != "signed out"
            menu.addItem(item)
        }
        let follow = NSMenuItem(
            title: "Follow my last session (\(listing.following))", action: #selector(use(_:)),
            keyEquivalent: "")
        follow.target = self
        follow.representedObject = "rt-auto"
        follow.state = listing.now.auto ? .on : .off
        menu.addItem(follow)

        if listing.models.count > 1 {
            menu.addItem(.separator())
            for model in listing.models {
                let item = NSMenuItem(
                    title: model.label, action: #selector(pickModel(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = [model.runtime, model.value ?? ""]
                item.state = model.current ? .on : .off
                menu.addItem(item)
            }
        }
        menu.addItem(.separator())
        let add = NSMenuItem(title: "Add account…", action: #selector(addAccount), keyEquivalent: "")
        add.target = self
        menu.addItem(add)
        let glass = NSMenuItem(
            title: "Show on the glass", action: #selector(showOnGlass), keyEquivalent: "")
        glass.target = self
        menu.addItem(glass)
    }

    @objc private func use(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        run(["use", id])
    }

    @objc private func pickModel(_ sender: NSMenuItem) {
        guard let pair = sender.representedObject as? [String], pair.count == 2 else { return }
        run(pair[1].isEmpty ? ["model", pair[0]] : ["model", pair[0], pair[1]])
    }

    /// A new `~/.claude-<n>` and its sign-in in a Terminal tab. The sign-in
    /// itself is the person's: nothing here sees a credential.
    @objc private func addAccount() {
        guard let exe = Self.executable else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: exe)
        process.arguments = ["add"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }

    @objc private func showOnGlass() { onShowOnGlass?() }
}
