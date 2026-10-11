// Which apps hold the microphone right now, each with its own code signature.
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
// Window titles are not read: any web page sets its own title, so a title
// can never be evidence of a meeting (security review, 2026-10-10).
//
// Nothing here decides what a meeting is. bin/lib/meeting_autopilot.py reads
// these lines and owns that policy.

import AppKit
import CoreAudio
import CoreGraphics
import Foundation
import Security

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

struct MicUser {
    let pid: Int32
    let id: String
    let name: String
    var signature: Signature = Signature()
}

/// The running process's own code signature, every field from ONE lookup:
/// the pid becomes a SecCode handle once, and validity, the executable's
/// path, the signing identifier and the Team ID are all read from that
/// handle. The app the process belongs to is then named by the outermost
/// .app on that same path, read from that bundle's own signature (its
/// signing identifier and Team ID), never from its Info.plist, which anyone
/// can write. Nothing here reads a second source about the same process, so
/// a check and a decision can never be about two different things
/// (security review, 2026-10-10: authorization gate field mismatch).
struct Signature {
    var valid = false
    var path = ""
    var identifier = ""
    var team = ""
    var appIdentifier = ""
    var appTeam = ""
}

private func signingInfo(_ code: SecStaticCode) -> (identifier: String, team: String) {
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let dict = info as? [String: Any] else { return ("", "") }
    return (dict[kSecCodeInfoIdentifier as String] as? String ?? "", dict[kSecCodeInfoTeamIdentifier as String] as? String ?? "")
}

func signature(of pid: Int32) -> Signature {
    var out = Signature()
    var code: SecCode?
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess, let code else { return out }
    out.valid = SecCodeCheckValidity(code, [], nil) == errSecSuccess
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
        out.valid = false
        return out
    }
    var url: CFURL?
    if SecCodeCopyPath(staticCode, [], &url) == errSecSuccess, let url { out.path = (url as URL).path }
    (out.identifier, out.team) = signingInfo(staticCode)
    if let app = outermostApp(out.path.hasSuffix("/") ? out.path : out.path + "/") {
        var appCode: SecStaticCode?
        if SecStaticCodeCreateWithPath(URL(fileURLWithPath: app) as CFURL, [], &appCode) == errSecSuccess,
           let appCode {
            (out.appIdentifier, out.appTeam) = signingInfo(appCode)
        }
    }
    return out
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
    let sig = signature(of: pid)
    // The id the policy matches is the app's own signing identifier from
    // the same lookup; the name is for people only.
    let display = resolveName(pid: pid)
    let id = sig.appIdentifier.isEmpty ? (sig.identifier.isEmpty ? display.id : sig.identifier) : sig.appIdentifier
    return MicUser(pid: pid, id: id, name: display.name, signature: sig)
}

private func resolveName(pid: Int32) -> MicUser {
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
        // Display only: the relabelled row keeps the daemon's own signature,
        // so it can never pass as FaceTime's.
        users = users.map {
            appleCallDaemons.contains($0.id)
                ? MicUser(pid: $0.pid, id: "apple-call:" + call.id, name: call.name, signature: $0.signature) : $0
        }
    }
    return users
}

func rows(_ users: [MicUser]) -> [[String: Any]] {
    // One row per app: a browser holds audio from several helper pids.
    // Signed rows first, so an unsigned process claiming an app's path
    // never hides that app's real, signed row (and vice versa: each row
    // carries its own signature).
    var seen = Set<String>()
    let ordered = users.sorted { $0.signature.valid && !$1.signature.valid }
    return ordered.compactMap { user -> [String: Any]? in
        guard seen.insert(user.id).inserted else { return nil }
        return ["id": user.id, "name": user.name, "pid": Int(user.pid), "signed": user.signature.valid,
                "signing_id": user.signature.identifier, "team": user.signature.team,
                "app_id": user.signature.appIdentifier, "app_team": user.signature.appTeam]
    }
}

func micSnapshot(playing: Bool = false) -> [String: Any] {
    let users = micUsers()
    var body: [String: Any] = [
        "at": ISO8601DateFormatter().string(from: Date()),
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

/// The fields that count as a change: who holds the mic, never the timestamp.
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
