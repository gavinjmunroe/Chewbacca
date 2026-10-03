// call-ears: both sides of a call as 16 kHz mono audio on stdout.
//
// The other side comes from ScreenCaptureKit's system audio, not from a
// loopback device. BlackHole works too, but only after the output is moved to
// a multi-output device, and on a Mac whose output is an audio interface used
// for music production that is a routing change nobody wants made for them.
// ScreenCaptureKit hears whatever the Mac plays, through any output, and
// changes nothing.
//
// Your side is the default input through AVAudioEngine.
//
// Usage: call-ears (--app <name or bundle id>... | --daemons-only | --all-audio) [--no-mic]
//        call-ears --who-listens     apps using an audio input now, then exit
//
// Wire format, one frame per buffer:
//   1 byte   source: 0 = you (microphone), 1 = them (system audio)
//   4 bytes  sample count n, little endian
//   2n bytes signed 16-bit little-endian samples at 16 kHz
//
// Diagnostics go to stderr as single lines starting "ears:".
//
// Build: call/build.sh. Needs Screen Recording and Microphone for the app
// that launches it (the terminal, or whatever runs `call-listen`).

import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import ScreenCaptureKit

let rate: Double = 16_000

func note(_ text: String) {
    FileHandle.standardError.write(("ears: " + text + "\n").data(using: .utf8)!)
}

/// One writer for both sources, so frames never interleave mid-frame.
final class Writer: @unchecked Sendable {
    private let lock = NSLock()
    private let out = FileHandle.standardOutput

    func write(source: UInt8, samples: [Int16]) {
        guard !samples.isEmpty else { return }
        var frame = Data(capacity: 5 + samples.count * 2)
        frame.append(source)
        var count = UInt32(samples.count).littleEndian
        withUnsafeBytes(of: &count) { frame.append(contentsOf: $0) }
        samples.withUnsafeBytes { frame.append(contentsOf: $0) }
        lock.lock()
        defer { lock.unlock() }
        do {
            try out.write(contentsOf: frame)
        } catch {
            // The reader went away: there is nobody left to hear for.
            exit(0)
        }
    }
}

/// Any PCM buffer to 16 kHz mono Int16, through one AVAudioConverter per
/// input format.
final class Resampler {
    private let target = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true)!
    private var converter: AVAudioConverter?
    private var from: AVAudioFormat?

    func convert(_ buffer: AVAudioPCMBuffer) -> [Int16] {
        if from == nil || !(from!.isEqual(buffer.format)) {
            from = buffer.format
            converter = AVAudioConverter(from: buffer.format, to: target)
        }
        guard let converter else { return [] }
        let capacity = AVAudioFrameCount(
            Double(buffer.frameLength) * rate / buffer.format.sampleRate + 64)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
            return []
        }
        var fed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        if let error {
            note("convert failed: \(error.localizedDescription)")
            return []
        }
        guard let data = output.int16ChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: data[0], count: Int(output.frameLength)))
    }
}

enum Scope { case apps, daemonsOnly, everything }

/// Whether `name` names this app: its exact bundle id, its exact name, or
/// its name up to a "." or space ("zoom" for "zoom.us"). A bare substring let
/// "arc", the browser, match any app or bundle id containing "search".
func names(_ app: SCRunningApplication, _ name: String) -> Bool {
    if app.bundleIdentifier.lowercased() == name { return true }
    let title = app.applicationName.lowercased()
    if title == name { return true }
    guard !name.isEmpty, title.hasPrefix(name), let next = title.dropFirst(name.count).first else {
        return false
    }
    return next == "." || next == " "
}

final class SystemAudio: NSObject, SCStreamOutput, SCStreamDelegate {
    let writer: Writer
    var apps: [String] = []
    var scope = Scope.apps
    let resampler = Resampler()
    var stream: SCStream?

    init(writer: Writer) { self.writer = writer }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "ears", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "no display to attach system audio to"])
        }
        // The scope is always named by the caller, never defaulted. Hearing
        // everything the Mac plays was the default until 2026-10-02, and the
        // first test capture had Spotify under every word: a default that
        // widens is how a recorder hears what nobody agreed to.
        //
        // --daemons-only is FaceTime's scope: its call audio plays from
        // avconferenced, a daemon ScreenCaptureKit does not list as an app,
        // so "FaceTime only" heard twenty minutes of silence on a live call
        // on 2026-10-02. Excluding every app it does list leaves the daemons,
        // and none of the 41 listed apps on this Mac was a call daemon.
        let filter: SCContentFilter
        if scope == .daemonsOnly {
            note("hearing system daemons only (\(content.applications.count) apps excluded)")
            filter = SCContentFilter(
                display: display, excludingApplications: content.applications, exceptingWindows: [])
        } else if scope == .everything {
            note("hearing everything this Mac plays")
            filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        } else {
            let wanted = content.applications.filter { app in apps.contains { names(app, $0) } }
            guard !wanted.isEmpty else {
                let running = content.applications.map(\.applicationName).filter { !$0.isEmpty }
                throw NSError(domain: "ears", code: 4, userInfo: [
                    NSLocalizedDescriptionKey: "no running app matches \(apps.sorted()); running: \(running.sorted().joined(separator: ", "))"])
            }
            note("hearing only: " + wanted.map(\.applicationName).joined(separator: ", "))
            filter = SCContentFilter(display: display, including: wanted, exceptingWindows: [])
        }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = Int(rate)
        config.channelCount = 1
        // Audio is the point; the video side is kept as small and slow as
        // ScreenCaptureKit allows, because a stream must carry one.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "ears.system"))
        try await stream.startCapture()
        self.stream = stream
        note("system audio on")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sample.isValid,
              let description = sample.formatDescription,
              let asbd = description.audioStreamBasicDescription else { return }
        var streamDescription = asbd
        guard let format = AVAudioFormat(streamDescription: &streamDescription) else { return }
        let frames = AVAudioFrameCount(sample.numSamples)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sample, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList)
        guard status == noErr else { return }
        writer.write(source: 1, samples: resampler.convert(buffer))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        note("system audio stopped: \(error.localizedDescription)")
        exit(3)
    }
}

final class Microphone {
    let writer: Writer
    let engine = AVAudioEngine()
    let resampler = Resampler()

    init(writer: Writer) {
        self.writer = writer
        // A call app turning on voice processing reconfigures the input, and
        // AVAudioEngine stops without a word when that happens: on the
        // 2026-10-02 FaceTime call the mic went silent from the first second.
        NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { [weak self] _ in
            guard let self else { return }
            note("microphone reconfigured, restarting")
            self.engine.inputNode.removeTap(onBus: 0)
            do {
                try self.start()
            } catch {
                note("microphone restart failed: \(error.localizedDescription)")
            }
        }
    }

    func start() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            throw NSError(domain: "ears", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "no microphone input (permission, or no device)"])
        }
        input.installTap(onBus: 0, bufferSize: 1600, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.writer.write(source: 0, samples: self.resampler.convert(buffer))
        }
        try engine.start()
        note("microphone on: \(Int(format.sampleRate)) Hz, \(format.channelCount) ch")
    }
}

/// Which apps hold an audio input right now, as JSON lines of pid and bundle
/// id. CoreAudio's per-process objects (macOS 14 on) say this directly, which
/// is how a call is told apart from this tool's own capture: asking whether
/// the input device is busy says yes the moment call-ears itself is running.
func whoListens() -> [[String: Any]] {
    func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
    }
    var where_ = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &where_, 0, nil, &size) == noErr else {
        return []
    }
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &where_, 0, nil, &size, &objects) == noErr else {
        return []
    }
    var found: [[String: Any]] = []
    for object in objects {
        var running: UInt32 = 0
        var runningSize = UInt32(MemoryLayout<UInt32>.size)
        var runningAt = address(kAudioProcessPropertyIsRunningInput)
        guard AudioObjectGetPropertyData(object, &runningAt, 0, nil, &runningSize, &running) == noErr,
              running != 0 else { continue }
        var pid: pid_t = 0
        var pidSize = UInt32(MemoryLayout<pid_t>.size)
        var pidAt = address(kAudioProcessPropertyPID)
        _ = AudioObjectGetPropertyData(object, &pidAt, 0, nil, &pidSize, &pid)
        var bundle: CFString = "" as CFString
        var bundleSize = UInt32(MemoryLayout<CFString>.size)
        var bundleAt = address(kAudioProcessPropertyBundleID)
        _ = withUnsafeMutablePointer(to: &bundle) {
            AudioObjectGetPropertyData(object, &bundleAt, 0, nil, &bundleSize, $0)
        }
        found.append(["pid": Int(pid), "bundle": bundle as String])
    }
    return found
}

if CommandLine.arguments.contains("--who-listens") {
    for entry in whoListens() {
        let data = try! JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
    exit(0)
}

let argv = Array(CommandLine.arguments.dropFirst())
let arguments = Set(argv)
let writer = Writer()
let system = SystemAudio(writer: writer)
for (index, flag) in argv.enumerated() where index + 1 < argv.count {
    if flag == "--app" { system.apps.append(argv[index + 1].lowercased()) }
}
let scopes = [!system.apps.isEmpty, arguments.contains("--daemons-only"), arguments.contains("--all-audio")]
guard scopes.filter({ $0 }).count == 1 else {
    note("name exactly one scope: --app <name>..., --daemons-only or --all-audio")
    exit(64)
}
if arguments.contains("--daemons-only") { system.scope = .daemonsOnly }
if arguments.contains("--all-audio") { system.scope = .everything }
let microphone = Microphone(writer: writer)

if !arguments.contains("--no-mic") {
    do {
        try microphone.start()
    } catch {
        note("microphone failed: \(error.localizedDescription)")
    }
}

Task {
    do {
        try await system.start()
    } catch {
        note("system audio failed: \(error.localizedDescription)")
        exit(2)
    }
}

signal(SIGPIPE, SIG_IGN)
RunLoop.main.run()
