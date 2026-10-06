import AppKit

/// The app being granted: what the draggable row shows and what it drops.
/// Port of Anarlog's host_app.rs, pointed at any bundle instead of the running
/// app's own, because the helper is never the app being granted.
struct HostApp {
    let displayName: String
    let bundleURL: URL
    let bundleID: String?
    let icon: NSImage

    enum LoadError: Error, CustomStringConvertible {
        case notAnApp(String)

        var description: String {
            switch self {
            case .notAnApp(let path): return "\(path) is not an app bundle (no Contents/Info.plist)"
            }
        }
    }

    static func load(path: String) throws -> HostApp {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let infoPlist = url.appendingPathComponent("Contents/Info.plist").path
        guard url.pathExtension == "app",
              FileManager.default.fileExists(atPath: infoPlist),
              let bundle = Bundle(url: url)
        else { throw LoadError.notAnApp(path) }

        // Anarlog reads CFBundleDisplayName, then CFBundleName, because it only
        // ever names itself. Pointed at another app that is the wrong label:
        // VS Code's CFBundleName is "Code" while the Privacy list (and Finder)
        // say "Visual Studio Code", seen on 2026-10-05. The row has to match
        // the list it is dropped into, so the Finder name wins.
        let name = FileManager.default.displayName(atPath: url.path)
            .replacingOccurrences(of: ".app", with: "", options: [.anchored, .backwards])
        let icon = bundleIcon(bundle) ?? NSWorkspace.shared.icon(forFile: url.path)
        icon.size = NSSize(width: 48, height: 48)
        return HostApp(displayName: name, bundleURL: url, bundleID: bundle.bundleIdentifier, icon: icon)
    }

    private static func bundleIcon(_ bundle: Bundle) -> NSImage? {
        guard let resources = bundle.resourcePath else { return nil }
        var names: [String] = []
        func push(_ value: String?) {
            guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty,
                  !names.contains(value) else { return }
            names.append(value)
        }
        push(bundle.object(forInfoDictionaryKey: "CFBundleIconFile") as? String)
        push(bundle.object(forInfoDictionaryKey: "CFBundleIconName") as? String)
        // Anarlog's note: alternate icons ship as AppIcon.icns and can replace
        // the Info.plist icon at runtime, so the bundled resources are tried too.
        push("icon.icns")
        push("AppIcon.icns")
        push("AppIcon")
        for name in names {
            let candidates = (name as NSString).pathExtension.isEmpty
                ? ["\(resources)/\(name).icns", "\(resources)/\(name)"]
                : ["\(resources)/\(name)"]
            for path in candidates where FileManager.default.fileExists(atPath: path) {
                if let image = NSImage(contentsOfFile: path) { return image }
            }
        }
        return nil
    }
}
