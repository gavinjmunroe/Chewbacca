// room-capture: the mic and the Mac's own output, mixed, in 16 kHz mono WAV chunks.
//
//   room-capture --out DIR [--chunk 15] [--status FILE] [--no-mic] [--no-system]
//   room-capture --probe            permission state and the app macOS charges it to, one JSON line, no prompt
//   room-capture --request          ask macOS for both permissions, then probe
//
// Why this exists: bin/room-listen hears only the mic, so on a call it records
// one side. Anarlog (MIT, github.com/fastrepl/anarlog) hears both, but it is a
// separate app with its own window and database, and the brief was that
// meetings are Chewbacca's own. This is the smallest piece that hears both:
// ScreenCaptureKit for what the Mac plays (SCStream with capturesAudio, with
// this process's own audio excluded), AVAudioEngine for the mic, summed into
// one track.
//
// Output contract, read by bin/lib/meeting_capture.py:
//   DIR/cNNNNNN-<start epoch ms>.wav    16-bit PCM, 16 kHz, mono
//   DIR/cNNNNNN-<start epoch ms>.json   levels for that chunk, per source
// The JSON is written before the WAV, and the WAV is renamed into place from a
// .part file, so a WAV that exists is always whole and always has its levels.
// Nothing leaves the machine: there is no network code in this file.

import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

// 16 kHz mono is what Whisper resamples everything to before it listens
// (openai/whisper audio.py SAMPLE_RATE = 16000), so capturing at it costs
// nothing in accuracy and a third of the disk of 48 kHz.
let outputRate = 16_000.0

struct Options {
    var outDir = ""
    // 15 s matches bin/room-listen, whose comment says it is guessed: long
    // enough for whole sentences, short enough to lag the room by under 30 s.
    var chunkSeconds = 15.0
    var statusPath = ""
    var useMic = true
    var useSystem = true
    var probe = false
    var request = false
}

func parseOptions() -> Options {
    var opts = Options()
    var args = Array(CommandLine.arguments.dropFirst())
    while !args.isEmpty {
        let arg = args.removeFirst()
        switch arg {
        case "--out": opts.outDir = args.isEmpty ? "" : args.removeFirst()
        case "--chunk": opts.chunkSeconds = Double(args.isEmpty ? "" : args.removeFirst()) ?? 15
        case "--status": opts.statusPath = args.isEmpty ? "" : args.removeFirst()
        case "--no-mic": opts.useMic = false
        case "--no-system": opts.useSystem = false
        case "--probe": opts.probe = true
        case "--request": opts.request = true
        default:
            FileHandle.standardError.write("room-capture: unknown argument \(arg)\n".data(using: .utf8)!)
            exit(64)
        }
    }
    // Below 2 s Whisper hears fragments; above 60 s a crash loses a minute.
    // Both bounds guessed, never measured.
    opts.chunkSeconds = min(max(opts.chunkSeconds, 2), 60)
    return opts
}

func micState() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not_asked"
    @unknown default: return "unknown"
    }
}

func screenState() -> String {
    CGPreflightScreenCaptureAccess() ? "granted" : "not_granted"
}

/// The app macOS charges this process's grants to. A command-line binary has
/// no bundle, so TCC asks on behalf of the app at the top of its launch chain
/// (VS Code, Terminal, Kyber), and that app is the one that has to be switched
/// on in Privacy & Security. The private libSystem function
/// responsibility_get_pid_responsible_for_pid answers it directly; it is
/// looked up at run time so a macOS without it only loses this field.
func responsibleApp() -> String {
    typealias Lookup = @convention(c) (pid_t) -> pid_t
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid")
    else { return "" }
    let pid = unsafeBitCast(symbol, to: Lookup.self)(getpid())
    guard pid > 0 else { return "" }
    var buffer = [CChar](repeating: 0, count: 4096)
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return "" }
    let path = String(cString: buffer)
    // "/A.app/Contents/Frameworks/B.app/Contents/MacOS/b" belongs to /A.app,
    // the same rule bin/chewbacca-permissions uses for the process chain.
    if let range = path.range(of: ".app/") {
        return String(path[..<range.lowerBound]) + ".app"
    }
    return path
}

func emitJSON(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
        print(text)
        fflush(stdout)
    }
}

/// Any input format to 16 kHz mono float. One converter per source, kept
/// across calls so the resampler's filter state carries over between buffers.
final class Resampler {
    let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outputRate, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?

    func convert(_ buffer: AVAudioPCMBuffer) -> [Float] {
        if converter == nil || converter!.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: target)
            converter?.downmix = true
        }
        guard let converter else { return [] }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * outputRate / buffer.format.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return [] }
        var fed = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, inputStatus in
            if fed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let channel = out.floatChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: channel[0], count: Int(out.frameLength)))
    }
}

/// Two queues of 16 kHz samples, one per source, cut into chunks on a clock.
final class Mixer {
    private let lock = NSLock()
    private var mic: [Float] = []
    private var system: [Float] = []

    func append(_ samples: [Float], mic isMic: Bool) {
        lock.lock()
        if isMic { mic.append(contentsOf: samples) } else { system.append(contentsOf: samples) }
        lock.unlock()
    }

    /// Up to `count` samples from each source, summed. A source that delivered
    /// less is padded with silence (ScreenCaptureKit can go quiet when nothing
    /// plays). Leftover beyond one second is dropped so a source running fast
    /// against the wall clock cannot drift the two tracks apart without bound.
    func take(_ count: Int) -> (mixed: [Float], micFrames: Int, systemFrames: Int, micRMS: Double, systemRMS: Double) {
        lock.lock()
        defer { lock.unlock() }
        let micTake = Array(mic.prefix(count))
        let systemTake = Array(system.prefix(count))
        mic.removeFirst(micTake.count)
        system.removeFirst(systemTake.count)
        let keep = Int(outputRate)
        if mic.count > keep { mic.removeFirst(mic.count - keep) }
        if system.count > keep { system.removeFirst(system.count - keep) }
        let length = max(micTake.count, systemTake.count)
        var mixed = [Float](repeating: 0, count: length)
        for i in 0..<length {
            let sum = (i < micTake.count ? micTake[i] : 0) + (i < systemTake.count ? systemTake[i] : 0)
            mixed[i] = min(max(sum, -1), 1)
        }
        return (mixed, micTake.count, systemTake.count, rms(micTake), rms(systemTake))
    }

    private func rms(_ samples: [Float]) -> Double {
        guard !samples.isEmpty else { return 0 }
        var total = 0.0
        for s in samples { total += Double(s) * Double(s) }
        return (total / Double(samples.count)).squareRoot()
    }
}

func wavData(_ samples: [Float]) -> Data {
    var data = Data()
    func put<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    let bytes = UInt32(samples.count * 2)
    data.append(contentsOf: Array("RIFF".utf8)); put(UInt32(36) + bytes)
    data.append(contentsOf: Array("WAVE".utf8))
    data.append(contentsOf: Array("fmt ".utf8)); put(UInt32(16)); put(UInt16(1)); put(UInt16(1))
    put(UInt32(outputRate)); put(UInt32(outputRate) * 2); put(UInt16(2)); put(UInt16(16))
    data.append(contentsOf: Array("data".utf8)); put(bytes)
    for s in samples { put(Int16(max(-32768, min(32767, (s * 32767).rounded())))) }
    return data
}

func dbfs(_ value: Double) -> Double {
    value > 0 ? (20 * log10(value) * 10).rounded() / 10 : -120
}

final class SystemAudio: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "room-capture.system")
    private let screenQueue = DispatchQueue(label: "room-capture.screen")
    private let resampler = Resampler()
    private let mixer: Mixer
    var onStop: ((String) -> Void)?

    init(mixer: Mixer) { self.mixer = mixer }

    func start(completion: @escaping (String?) -> Void) {
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
            guard let content, let display = content.displays.first else {
                completion("no shareable display: \(error?.localizedDescription ?? "none listed")")
                return
            }
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 48_000
            config.channelCount = 2
            // Video cannot be switched off on macOS 13/14, so it is made as
            // cheap as the API allows: a 2x2 frame once a second.
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            let stream = SCStream(filter: filter, configuration: config, delegate: self)
            do {
                try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.audioQueue)
                // Without a screen output, ScreenCaptureKit logs "stream output
                // NOT found. Dropping frame" once a second into the log file.
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.screenQueue)
            } catch {
                completion("could not attach output: \(error.localizedDescription)")
                return
            }
            stream.startCapture { error in
                if let error {
                    completion(error.localizedDescription)
                } else {
                    self.stream = stream
                    completion(nil)
                }
            }
        }
    }

    func stop() {
        let done = DispatchSemaphore(value: 0)
        guard let stream else { return }
        stream.stopCapture { _ in done.signal() }
        _ = done.wait(timeout: .now() + 2)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let description = CMSampleBufferGetFormatDescription(sampleBuffer),
              let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return }
        var asbd = basic.pointee
        guard let format = AVAudioFormat(streamDescription: &asbd) else { return }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
        buffer.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList)
        guard status == noErr else { return }
        mixer.append(resampler.convert(buffer), mic: false)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onStop?(error.localizedDescription)
    }
}

final class Microphone {
    private let engine = AVAudioEngine()
    private let resampler = Resampler()
    private let mixer: Mixer

    init(mixer: Mixer) { self.mixer = mixer }

    func start() -> String? {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return "no input device" }
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.mixer.append(self.resampler.convert(buffer), mic: true)
        }
        do {
            try engine.start()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

final class Recorder {
    let opts: Options
    let mixer = Mixer()
    var index = 0
    var chunkStart = Date()
    var status: [String: Any] = [:]
    let statusLock = NSLock()
    var timer: DispatchSourceTimer?
    let clock = DispatchQueue(label: "room-capture.clock")
    lazy var system = SystemAudio(mixer: mixer)
    lazy var mic = Microphone(mixer: mixer)

    init(opts: Options) { self.opts = opts }

    func setStatus(_ key: String, _ value: Any) {
        statusLock.lock()
        status[key] = value
        status["updated_at"] = ISO8601DateFormatter().string(from: Date())
        let snapshot = status
        statusLock.unlock()
        guard !opts.statusPath.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]) else { return }
        let part = opts.statusPath + ".part"
        if FileManager.default.createFile(atPath: part, contents: data) {
            _ = try? FileManager.default.replaceItemAt(URL(fileURLWithPath: opts.statusPath), withItemAt: URL(fileURLWithPath: part))
        }
    }

    func run() {
        try? FileManager.default.createDirectory(atPath: opts.outDir, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        // An existing folder keeps its old mode through createDirectory.
        chmod(opts.outDir, 0o700)
        setStatus("pid", Int(getpid()))
        setStatus("state", "starting")
        setStatus("chunks", 0)
        setStatus("mic_permission", micState())
        setStatus("screen_permission", screenState())

        if opts.useMic {
            if let problem = mic.start() {
                setStatus("mic", "off: \(problem)")
            } else {
                // AVAudioEngine starts even without permission and then hands
                // over silence, so "on" here means the device opened; the
                // per-chunk levels are what prove it heard anything.
                setStatus("mic", micState() == "granted" ? "on" : "on, permission \(micState())")
            }
        } else {
            setStatus("mic", "off: --no-mic")
        }

        if opts.useSystem {
            system.onStop = { [weak self] why in self?.setStatus("system", "stopped: \(why)") }
            system.start { [weak self] problem in
                self?.setStatus("system", problem.map { "off: \($0)" } ?? "on")
            }
        } else {
            setStatus("system", "off: --no-system")
        }

        chunkStart = Date()
        let timer = DispatchSource.makeTimerSource(queue: clock)
        timer.schedule(deadline: .now() + opts.chunkSeconds, repeating: opts.chunkSeconds)
        timer.setEventHandler { [weak self] in self?.cut(final: false) }
        timer.resume()
        self.timer = timer
        setStatus("state", "recording")
    }

    func cut(final: Bool) {
        let started = chunkStart
        chunkStart = Date()
        let wanted = Int(outputRate * opts.chunkSeconds)
        let piece = mixer.take(wanted)
        // A last piece under a second is a stop press, not speech; Whisper
        // returns hallucinated filler on clips that short.
        if piece.mixed.isEmpty || (final && piece.mixed.count < Int(outputRate)) { return }
        index += 1
        let stem = String(format: "c%06d-%013lld", index, Int64(started.timeIntervalSince1970 * 1000))
        let base = (opts.outDir as NSString).appendingPathComponent(stem)
        let levels: [String: Any] = [
            "index": index, "start_ms": Int64(started.timeIntervalSince1970 * 1000),
            "seconds": Double(piece.mixed.count) / outputRate,
            "mic_frames": piece.micFrames, "system_frames": piece.systemFrames,
            "mic_dbfs": dbfs(piece.micRMS), "system_dbfs": dbfs(piece.systemRMS),
        ]
        if let json = try? JSONSerialization.data(withJSONObject: levels, options: [.sortedKeys]) {
            FileManager.default.createFile(atPath: base + ".json", contents: json)
        }
        let part = base + ".wav.part"
        if FileManager.default.createFile(atPath: part, contents: wavData(piece.mixed)) {
            try? FileManager.default.moveItem(atPath: part, toPath: base + ".wav")
        }
        setStatus("chunks", index)
        setStatus("last_chunk", levels)
    }

    func shutdown() {
        timer?.cancel()
        clock.sync { cut(final: true) }
        mic.stop()
        system.stop()
        setStatus("state", "stopped")
    }
}

// Every chunk is someone's voice, so nothing this process writes is readable
// by another account: files 0600, folders 0700, whatever the shell's umask.
umask(0o077)
let opts = parseOptions()

if opts.request {
    let asked = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in asked.signal() }
    _ = asked.wait(timeout: .now() + 120)
    _ = CGRequestScreenCaptureAccess()
}
if opts.probe || opts.request {
    emitJSON(["mic": micState(), "screen": screenState(), "responsible_app": responsibleApp()])
    exit(0)
}
guard !opts.outDir.isEmpty else {
    FileHandle.standardError.write("room-capture: --out DIR is required\n".data(using: .utf8)!)
    exit(64)
}

let recorder = Recorder(opts: opts)
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
        recorder.shutdown()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}
recorder.run()
dispatchMain()
