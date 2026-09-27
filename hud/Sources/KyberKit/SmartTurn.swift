import AVFoundation
import CoreML
import Foundation
import os

/// When a wake-mode turn is over, read from the audio instead of a clock.
///
/// Wake mode ended a turn after 1.1s with no new partial, and a pause cannot
/// tell "I am finished" from "I am thinking" (docs/VOICE-RESEARCH.md, "End of
/// turn is a model, not a silence timer"). Pipecat's Smart Turn v3.2 reads the
/// last eight seconds of 16kHz audio and answers with the probability that the
/// speaker has finished. It is asked at a short pause, and a yes ends the turn
/// there. A no, a missing model or a failed prediction leaves the old timer to
/// end it, so a turn never takes longer than it did before.
///
/// Push to talk does not use any of this: the key is the end of the turn.
public enum EndOfTurn {
    /// How long after the recogniser's last partial the model is asked.
    ///
    /// 0.2s is Pipecat's `VAD_STOP_SECS`, the silence after which Pipecat runs
    /// Smart Turn (pipecat `audio/vad/vad_analyzer.py`, read 2026-09-27). Here
    /// it counts from the last partial, not from the audio, and the partial
    /// already trails the last word, so the window holds more trailing silence
    /// than Pipecat's does. Not measured on this machine.
    public static let onset: TimeInterval = 0.2

    /// The pause that ends the turn whatever the model said. This is the 1.1s
    /// silence timer wake mode has always used, kept as the ceiling so a model
    /// that says "not finished", or is not installed, is never slower than
    /// before.
    public static let ceiling: TimeInterval = 1.1

    /// Above this the person has finished. It is upstream's own cut:
    /// `inference.py` in pipecat-ai/smart-turn calls a turn complete at a
    /// probability over 0.5. The CoreML export's model card measured, at this
    /// cut, 8.5% of unfinished turns called finished and 5.6% of finished ones
    /// kept waiting, on 1,000 clips of Pipecat's v3.2 test set. Never measured
    /// on Kyber's own audio.
    public static let threshold = 0.5

    /// How much quiet the audio has to end in before the model is asked: the
    /// same 0.2s of silence Pipecat's VAD waits out before it asks
    /// (`VAD_STOP_SECS`). A pause in partials is only a stand-in for silence,
    /// and the recogniser can go that long without a new partial while the
    /// person is still talking. Measured 2026-09-27 on a clip of `say` cut
    /// straight after "Remind me to call my mom and", with no pause at all:
    /// the model called it finished at 0.83.
    public static let quietTail: TimeInterval = 0.2

    /// A 20ms frame is quiet below a tenth of the loudest frame in the window,
    /// 20dB down. Guessed, never measured. It errs the safe way: a room that
    /// never gets that quiet only leaves the silence timer to end the turn.
    public static let quietRatio: Float = 0.1

    /// The model's input, from its config.json: 8s at 16kHz, `[1, 128000]`.
    public static let sampleRate = 16_000.0
    public static let windowSeconds = 8.0
    public static let windowSamples = 128_000

    /// Whether this answer ends the turn now. No answer never does.
    public static func isFinished(_ probability: Double?) -> Bool {
        guard let probability else { return false }
        return probability > threshold
    }

    /// The audio, at 16kHz, ends in `quietTail` of quiet after something
    /// louder. False for audio that is still loud at the end, and for audio
    /// that never had anything in it.
    public static func endsInQuiet(_ samples: [Float]) -> Bool {
        let frame = 320
        let tailFrames = Int(quietTail * sampleRate) / frame
        let frames = samples.count / frame
        guard frames > tailFrames else { return false }
        var levels = [Float](repeating: 0, count: frames)
        let start = samples.count - frames * frame
        for index in 0..<frames {
            var sum: Float = 0
            for sample in samples[(start + index * frame)..<(start + (index + 1) * frame)] {
                sum += sample * sample
            }
            levels[index] = (sum / Float(frame)).squareRoot()
        }
        guard let peak = levels.max(), peak > 0 else { return false }
        return levels.suffix(tailFrames).allSatisfy { $0 < peak * quietRatio }
    }

    /// Exactly `windowSamples` long, most recent audio last. A longer turn
    /// keeps its end; a shorter one gets zeros in front. Both are how the
    /// model was trained (upstream `audio_utils.truncate_audio_to_last_n_seconds`).
    public static func window(_ samples: [Float]) -> [Float] {
        if samples.count >= windowSamples { return Array(samples.suffix(windowSamples)) }
        return [Float](repeating: 0, count: windowSamples - samples.count) + samples
    }
}

/// Anything that can say how likely it is that a turn is over. The real one is
/// `SmartTurn`; tests hand the listener a stub so they never need the model.
public protocol TurnPredictor: Sendable {
    /// Probability from 0 to 1 that the speaker has finished, given
    /// `EndOfTurn.windowSamples` samples at 16kHz. Nil when there is no
    /// answer, which the listener treats as "keep waiting".
    func completion(of window: [Float]) async -> Double?
}

/// Smart Turn v3.2 on Core ML.
///
/// Upstream ships ONNX only. This is the compiled Core ML export at
/// aufklarer/Smart-Turn-v3.2-CoreML, converted from upstream's
/// `smart-turn-v3.2-gpu.onnx` with the Whisper log-mel front end inside the
/// model, so it takes raw samples. `hud/scripts/fetch-smart-turn.sh` fetches it
/// at a pinned revision and checks every file's hash, and setup runs that.
/// Like Whisper's model it is optional: without it wake mode keeps its timer.
public actor SmartTurn: TurnPredictor {
    public static var modelURL: URL {
        URL(fileURLWithPath: NSHomeDirectory() + "/.bob/smart-turn/smart_turn.mlmodelc")
    }

    private static let log = Logger(subsystem: "kyber", category: "voice")
    private let model: MLModel
    /// Reused for every prediction: 512KB that would otherwise be allocated
    /// at every pause.
    private let input: MLMultiArray

    public init(contentsOf url: URL) throws {
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuAndNeuralEngine
        model = try MLModel(contentsOf: url, configuration: configuration)
        input = try MLMultiArray(
            shape: [1, NSNumber(value: EndOfTurn.windowSamples)], dataType: .float32)
    }

    /// The model, loaded and run once on silence so the first real pause does
    /// not pay for the Neural Engine's first compile. Nil when it is not
    /// installed or will not load, and the listener then keeps its timer.
    public static func load(from url: URL = modelURL) async -> SmartTurn? {
        guard FileManager.default.fileExists(atPath: url.path) else {
            log.notice("voice.endpoint model=missing")
            return nil
        }
        let started = Date()
        do {
            let model = try SmartTurn(contentsOf: url)
            let silence = [Float](repeating: 0, count: EndOfTurn.windowSamples)
            guard await model.completion(of: silence) != nil else {
                log.error("voice.endpoint model=failed reason=first_prediction")
                return nil
            }
            log.notice(
                "voice.endpoint model=loaded ms=\(Int(Date().timeIntervalSince(started) * 1000))")
            return model
        } catch {
            log.error("voice.endpoint model=failed \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    public func completion(of window: [Float]) -> Double? {
        guard window.count == EndOfTurn.windowSamples else { return nil }
        input.withUnsafeMutableBufferPointer(ofType: Float.self) { pointer, _ in
            window.withUnsafeBufferPointer { source in
                guard let from = source.baseAddress, let to = pointer.baseAddress else { return }
                to.update(from: from, count: window.count)
            }
        }
        do {
            let features = try MLDictionaryFeatureProvider(
                dictionary: ["audio": MLFeatureValue(multiArray: input)])
            let output = try model.prediction(from: features)
            guard let value = output.featureValue(for: "probability")?.multiArrayValue,
                  value.count > 0
            else { return nil }
            return value[0].doubleValue
        } catch {
            Self.log.error("voice.endpoint predict failed \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}

/// The last eight seconds the microphone heard in wake mode, for the model.
///
/// Kept at the device's own rate and resampled only when the model is asked,
/// so the realtime audio thread does a copy and nothing else. Filled on that
/// thread and read from another; the lock is the only thing shared, which is
/// why `@unchecked Sendable` is honest here.
public final class TurnAudio: @unchecked Sendable {
    private let lock = NSLock()
    private var ring: [Float] = []
    private var next = 0
    private var filled = 0
    private var rate: Double = 0

    public init() {}

    public func reset() {
        lock.lock()
        defer { lock.unlock() }
        ring = []
        next = 0
        filled = 0
        rate = 0
    }

    /// One tap buffer, already mono. An interleaved buffer is read as its
    /// first channel.
    public func append(_ buffer: AVAudioPCMBuffer) {
        guard let data = buffer.floatChannelData?[0] else { return }
        let rate = buffer.format.sampleRate
        let count = Int(buffer.frameLength)
        let stride = buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1
        guard rate > 0, count > 0 else { return }
        lock.lock()
        defer { lock.unlock() }
        if rate != self.rate {
            // The first buffer, or a new input device. The only allocation
            // this ever does on the audio thread.
            self.rate = rate
            ring = [Float](repeating: 0, count: Int(rate * EndOfTurn.windowSeconds))
            next = 0
            filled = 0
        }
        let capacity = ring.count
        ring.withUnsafeMutableBufferPointer { ring in
            for index in 0..<count {
                ring[next] = data[index * stride]
                next += 1
                if next == capacity { next = 0 }
            }
        }
        filled = min(filled + count, capacity)
    }

    /// Oldest first, at the rate the device delivered it.
    func recent() -> (samples: [Float], rate: Double) {
        lock.lock()
        defer { lock.unlock() }
        guard filled > 0 else { return ([], rate) }
        if filled < ring.count { return (Array(ring[0..<filled]), rate) }
        return (Array(ring[next...] + ring[..<next]), rate)
    }

    /// Oldest first, at the model's 16kHz. Empty before any audio arrived.
    public func samples16k() -> [Float] {
        let (samples, rate) = recent()
        guard !samples.isEmpty else { return [] }
        if rate == EndOfTurn.sampleRate { return samples }
        return Self.resample(samples, from: rate)
    }

    static func resample(_ samples: [Float], from rate: Double) -> [Float] {
        guard let source = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
              let target = AVAudioFormat(
                  standardFormatWithSampleRate: EndOfTurn.sampleRate, channels: 1),
              let converter = AVAudioConverter(from: source, to: target),
              let input = AVAudioPCMBuffer(
                  pcmFormat: source, frameCapacity: AVAudioFrameCount(samples.count)),
              let output = AVAudioPCMBuffer(
                  pcmFormat: target,
                  frameCapacity: AVAudioFrameCount(
                      Double(samples.count) * EndOfTurn.sampleRate / rate) + 1_024),
              let into = input.floatChannelData?[0]
        else { return [] }
        input.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { from in
            if let base = from.baseAddress { into.update(from: base, count: samples.count) }
        }
        var fed = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in
            if fed {
                state.pointee = .endOfStream
                return nil
            }
            fed = true
            state.pointee = .haveData
            return input
        }
        guard status != .error, error == nil, let out = output.floatChannelData?[0]
        else { return [] }
        return Array(UnsafeBufferPointer(start: out, count: Int(output.frameLength)))
    }
}
