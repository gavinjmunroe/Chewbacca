import AppKit

let usage = """
usage: permission-guide <command> [options]

commands:
  guide     open the pane, float the card over it, exit when the grant lands
  status    print whether the grant exists, as JSON, and change nothing
  describe  print what guide would open and draw, as JSON, without drawing
  list      print every permission this helper knows, as JSON

options (guide, status, describe):
  --app PATH                the .app being granted (required)
  --permission ID           one of the ids from `list` (required)
  --check-command CMD       shell command that exits 0 once the grant is live
  --self                    the app is the one that launched this helper
  --automation-target ID    bundle id of the app being automated (automation)
  --hold                    keep the card up after the grant (previews)
  --timeout SECONDS         give up after this long (default 600)

exit codes: 0 granted or done, 1 error, 2 bad arguments, 3 dismissed,
            4 timed out, 5 System Settings would not open

PERMISSION_GUIDE_DEBUG=1 prints the card's view tree to stderr when it appears.
"""

enum Output {
    static func json(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return }
        print(text)
        fflush(stdout)
    }

    static func event(_ name: String, permission: String) {
        json(["event": name, "permission": permission])
    }

    static func fail(_ message: String, code: Int32) -> Never {
        FileHandle.standardError.write(Data("permission-guide: \(message)\n".utf8))
        exit(code)
    }
}

struct Options {
    var command = ""
    var appPath: String?
    var permissionID: String?
    var checkCommand: String?
    var isSelf = false
    var automationTarget: String?
    var hold = false
    // Ten minutes: long enough to find the + button and type a password,
    // short enough that a forgotten card does not sit over Settings all day.
    // Guessed, never measured.
    var timeout: TimeInterval = 600

    static func parse(_ arguments: [String]) -> Options {
        var options = Options()
        var rest = arguments[...]
        guard let command = rest.popFirst() else { Output.fail("no command\n\(usage)", code: 2) }
        if command == "--help" || command == "-h" || command == "help" {
            print(usage)
            exit(0)
        }
        guard ["guide", "status", "describe", "list"].contains(command) else {
            Output.fail("unknown command \(command)\n\(usage)", code: 2)
        }
        options.command = command
        func value(_ flag: String) -> String {
            guard let next = rest.popFirst(), !next.hasPrefix("--") else {
                Output.fail("\(flag) needs a value", code: 2)
            }
            return next
        }
        while let flag = rest.popFirst() {
            switch flag {
            case "--app": options.appPath = value(flag)
            case "--permission": options.permissionID = value(flag)
            case "--check-command": options.checkCommand = value(flag)
            case "--automation-target": options.automationTarget = value(flag)
            case "--self": options.isSelf = true
            case "--hold": options.hold = true
            case "--timeout":
                let raw = value(flag)
                guard let seconds = TimeInterval(raw), seconds > 0, seconds.isFinite else {
                    Output.fail("--timeout wants a positive number of seconds, got \(raw)", code: 2)
                }
                options.timeout = seconds
            case "--help", "-h":
                print(usage)
                exit(0)
            default:
                Output.fail("unknown option \(flag)", code: 2)
            }
        }
        return options
    }
}

let options = Options.parse(Array(CommandLine.arguments.dropFirst()))

if options.command == "list" {
    Output.json(["permissions": Permission.all.map {
        ["id": $0.id, "pane": $0.paneTitle, "anchor": $0.anchor, "service": $0.tccService,
         "mode": $0.mode.rawValue]
    }])
    exit(0)
}

guard let permissionID = options.permissionID else { Output.fail("--permission is required", code: 2) }
guard let permission = Permission.named(permissionID) else {
    Output.fail("unknown permission \(permissionID); known: \(Permission.all.map(\.id).joined(separator: ", "))",
                code: 2)
}
guard let appPath = options.appPath else { Output.fail("--app is required", code: 2) }
let app: HostApp
do { app = try HostApp.load(path: appPath) } catch { Output.fail("\(error)", code: 2) }
if options.automationTarget != nil && permission.id != "automation" {
    Output.fail("--automation-target only applies to --permission automation", code: 2)
}

let probe = GrantProbe(permission: permission, bundleID: app.bundleID, appPath: app.bundleURL.path,
                       checkCommand: options.checkCommand, isSelf: options.isSelf,
                       automationTarget: options.automationTarget)

func describe() -> [String: Any] {
    [
        "permission": permission.id,
        "app": app.bundleURL.path,
        "app_name": app.displayName,
        "bundle_id": app.bundleID ?? NSNull(),
        "pane": permission.paneTitle,
        "mode": permission.mode.rawValue,
        "title": permission.title,
        "subtitle": permission.subtitle(appName: app.displayName),
        "settings_url": permission.settingsURLs[0],
        "probe": probe.source,
    ]
}

switch options.command {
case "describe":
    Output.json(describe())
    exit(0)
case "status":
    var report = describe()
    report["status"] = probe.status().rawValue
    Output.json(report)
    exit(0)
default:
    break
}

let application = NSApplication.shared
// An accessory app: no Dock icon and no menu bar, and it never takes focus
// from System Settings, which has to stay frontmost for the card to show.
application.setActivationPolicy(.accessory)

var session: GuideSession?
session = GuideSession(permission: permission, app: app, probe: probe, hold: options.hold,
                       timeout: options.timeout) { outcome in
    Output.json(["permission": permission.id, "result": outcome.rawValue])
    switch outcome {
    case .granted: exit(0)
    case .dismissed: exit(3)
    case .timeout: exit(4)
    }
}
if session?.start() != true {
    Output.fail("System Settings would not open \(permission.settingsURLs[0])", code: 5)
}
application.run()
