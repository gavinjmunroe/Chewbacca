// Which apps hold the microphone right now, and which meeting windows are up.
//
//   room-capture --mic-users                  one JSON line, then exit
//   room-capture --watch-mic [--interval 2]   one JSON line now and one on every change, until killed
//
// Ported from Anarlog's detector (MIT, Copyright (c) 2023-present Fastrepl,
// Inc., github.com/fastrepl/anarlog): crates/detect/src/list/macos.rs reads
// Core Audio's process objects (macOS 14.2+) and keeps the ones whose
// kAudioProcessPropertyIsRunningInput is set, resolves each pid to its
// outermost .app, and relabels Apple's call daemon as FaceTime or iPhone Call
// when one of those apps is running. This file does the same in Swift so it
// needs no Rust toolchain and runs inside the helper that already records.
//
// Reading the process list does not touch audio and needs no permission.
// Window titles come from CGWindowListCopyWindowInfo, which only names other
// apps' windows when the responsible app has Screen Recording; without it
// the list is empty and the policy falls back to the calendar.
//
// Nothing here decides what a meeting is. bin/lib/meeting_autopilot.py reads
// these lines and owns that policy.

import AppKit
import CoreAudio
import CoreGraphics
import Foundation

// Core Audio selectors, spelled as their four-char codes so this target can
// keep macOS 13 as its floor; they only answer on 14.2 and later.
private let processObjectList: AudioObjectPropertySelector = 0x7072_7323  // 'prs#'
private let processPID: AudioObjectPropertySelector = 0x7070_6964  // 'ppid'
private let processIsRunningInput: AudioObjectPropertySelector = 0x7069_7269  // 'piri'
private let processIsRunningOutput: AudioObjectPropertySelector = 0x7069_726f  // 'piro'

// Copied from Anarlog's APPLE_CALL_DAEMON_IDS (list/macos.rs).
private let appleCallDaemons: Set<String> = [
    "/usr/libexec/avconferenced", "com.apple.avconferenced",
    "com.apple.TelephonyUtilities", "com.apple.TelephonyUtilities.callservicesd",
]

// Title fragments that name a meeting in a browser tab. Each is the title the
// service puts on its own call page: "Meet - abc-defg-hij", "Zoom Meeting",
// "Microsoft Teams" call windows, "Webex", "Whereby", "Jitsi Meet". Guessed
// from those services' page titles, never measured against this Mac's tabs.
private let meetingTitleFragments = [
    "Meet - ", "Google Meet", "Zoom Meeting", "Zoom Webinar", "Microsoft Teams", "| Microsoft Teams",
    "Webex", "Whereby", "Jitsi Meet", "Around", "Huddle",
]

struct MicUser {
    let pid: Int32
    let id: String
    let name: String
}

private func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}

private func processObjects() -> [AudioObjectID]? {
    var address = propertyAddress(processObjectList)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr
    else { return nil }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr
    else { return nil }
    return ids
}

private func uint32Property(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var address = propertyAddress(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
    return value
}

/// The outermost .app above a path: a browser's audio helper lives at
/// "/Applications/Google Chrome.app/Contents/Frameworks/.../Helper.app", and
/// the app a person knows is the first one (Anarlog's find_outermost_app).
private func outermostApp(_ path: String) -> String? {
    guard let range = path.range(of: ".app/") ?? (path.hasSuffix(".app") ? path.range(of: ".app") : nil)
    else { return nil }
    return String(path[..<range.lowerBound]) + ".app"
}

private func resolve(pid: Int32) -> MicUser {
    var path = ""
    var buffer = [CChar](repeating: 0, count: 4096)
    if proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 { path = String(cString: buffer) }
    if let app = outermostApp(path), let bundle = Bundle(path: app), let id = bundle.bundleIdentifier {
        let name = (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? URL(fileURLWithPath: app).deletingPathExtension().lastPathComponent
        return MicUser(pid: pid, id: id, name: name)
    }
    if let running = NSRunningApplication(processIdentifier: pid), let id = running.bundleIdentifier {
        return MicUser(pid: pid, id: id, name: running.localizedName ?? id)
    }
    // A bare binary (a daemon, a script's interpreter) is named by its path,
    // the way Anarlog's fallback_app_for_pid does.
    let name = URL(fileURLWithPath: path).lastPathComponent
    return MicUser(pid: pid, id: path.isEmpty ? "pid:\(pid)" : path, name: name.isEmpty ? "pid \(pid)" : name)
}

private func appleCallAppName() -> (id: String, name: String)? {
    func state(_ id: String) -> (running: Bool, active: Bool) {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: id)
        return (!apps.isEmpty, apps.contains { $0.isActive })
    }
    let faceTime = state("com.apple.FaceTime"), phone = state("com.apple.mobilephone")
    if faceTime.active { return ("com.apple.FaceTime", "FaceTime") }
    if phone.active { return ("com.apple.mobilephone", "iPhone Call") }
    switch (faceTime.running, phone.running) {
    case (true, false): return ("com.apple.FaceTime", "FaceTime")
    case (false, true): return ("com.apple.mobilephone", "iPhone Call")
    default: return nil
    }
}

/// nil when Core Audio has no process list (macOS before 14.2). With
/// `output`, the apps playing sound instead: the same read on the other
/// direction, which is how this file is checked without opening a mic.
func micUsers(output: Bool = false) -> [MicUser]? {
    guard let objects = processObjects() else { return nil }
    var users: [MicUser] = []
    for object in objects {
        guard uint32Property(object, output ? processIsRunningOutput : processIsRunningInput) == 1,
              let pid = uint32Property(object, processPID) else { continue }
        users.append(resolve(pid: Int32(bitPattern: pid)))
    }
    if let call = appleCallAppName() {
        users = users.map { appleCallDaemons.contains($0.id) ? MicUser(pid: $0.pid, id: call.id, name: call.name) : $0 }
    }
    return users
}

/// On-screen windows whose title names a meeting, as "bundle id: title".
func meetingWindows() -> [[String: String]] {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return [] }
    var out: [[String: String]] = []
    for window in info {
        guard (window[kCGWindowLayer as String] as? Int) == 0,
              let title = window[kCGWindowName as String] as? String, !title.isEmpty,
              meetingTitleFragments.contains(where: { title.contains($0) }),
              let pid = window[kCGWindowOwnerPID as String] as? Int32 else { continue }
        let owner = NSRunningApplication(processIdentifier: pid)
        out.append(["app": owner?.bundleIdentifier ?? "", "title": String(title.prefix(120))])
    }
    return out
}

func rows(_ users: [MicUser]) -> [[String: Any]] {
    // One row per app: a browser holds audio from several helper pids.
    var seen = Set<String>()
    return users.compactMap { user -> [String: Any]? in
        guard seen.insert(user.id).inserted else { return nil }
        return ["id": user.id, "name": user.name, "pid": Int(user.pid)]
    }
}

func micSnapshot(playing: Bool = false) -> [String: Any] {
    let users = micUsers()
    var body: [String: Any] = [
        "at": ISO8601DateFormatter().string(from: Date()),
        "windows": meetingWindows(),
        "screen": CGPreflightScreenCaptureAccess() ? "granted" : "not_granted",
    ]
    if let users = users {
        body["mic"] = rows(users)
        if playing { body["playing"] = rows(micUsers(output: true) ?? []) }
    } else {
        body["mic"] = NSNull()
        body["error"] = "Core Audio has no process list on this macOS (needs 14.2 or later)"
    }
    return body
}

/// The fields that count as a change: who holds the mic and which meeting
/// windows are up, never the timestamp.
private func fingerprint(_ body: [String: Any]) -> String {
    var copy = body
    copy.removeValue(forKey: "at")
    let data = (try? JSONSerialization.data(withJSONObject: copy, options: [.sortedKeys])) ?? Data()
    return String(data: data, encoding: .utf8) ?? ""
}

func watchMic(interval: Double) -> Never {
    var last = ""
    // A heartbeat line at least this often even with no change, so the reader
    // can tell a quiet helper from a dead one. Guessed, never measured.
    let heartbeat = 60.0
    var lastEmit = Date.distantPast
    while true {
        let body = micSnapshot()
        let print = fingerprint(body)
        if print != last || Date().timeIntervalSince(lastEmit) >= heartbeat {
            emitJSON(body)
            last = print
            lastEmit = Date()
        }
        Thread.sleep(forTimeInterval: interval)
    }
}
