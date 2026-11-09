import AVFoundation
import Foundation
import Testing

@testable import KyberKit

/// Stands in for Smart Turn, so none of this needs the model on disk.
actor StubPredictor: TurnPredictor {
    let answer: Double?
    /// Runs while the "model" is working, to play speech that resumes then.
    let meanwhile: (@Sendable () async -> Void)?
    private(set) var asked: [Int] = []

    init(answer: Double?, meanwhile: (@Sendable () async -> Void)? = nil) {
        self.answer = answer
        self.meanwhile = meanwhile
    }

    func completion(of window: [Float]) async -> Double? {
        asked.append(window.count)
        await meanwhile?()
        return answer
    }
}

/// A tone at the given rate, as the tap would hand it over, then `quiet`
/// seconds of digital silence.
func toneBuffer(seconds: Double, quiet: Double = 0, rate: Double = 48_000) -> AVAudioPCMBuffer? {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else {
        return nil
    }
    let loud = Int(seconds * rate)
    let frames = AVAudioFrameCount(Double(loud) + quiet * rate)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
          let samples = buffer.floatChannelData?[0]
    else { return nil }
    buffer.frameLength = frames
    for index in 0..<Int(frames) {
        samples[index] = index < loud ? 0.1 * sin(Float(index) * 2 * .pi * 220 / Float(rate)) : 0
    }
    return buffer
}

func tone16k(seconds: Double, quiet: Double = 0) -> [Float] {
    guard let buffer = toneBuffer(seconds: seconds, quiet: quiet, rate: 16_000),
          let samples = buffer.floatChannelData?[0]
    else { return [] }
    return Array(UnsafeBufferPointer(start: samples, count: Int(buffer.frameLength)))
}

@Suite("End of turn")
struct EndOfTurnTests {
    @Test("a short turn gets zeros in front, a long one keeps its end")
    func windowShape() {
        let short = EndOfTurn.window([1, 2, 3])
        #expect(short.count == EndOfTurn.windowSamples)
        #expect(Array(short.suffix(3)) == [1, 2, 3])
        #expect(short.dropLast(3).allSatisfy { $0 == 0 })

        let long = (0..<(EndOfTurn.windowSamples + 500)).map { Float($0) }
        let kept = EndOfTurn.window(long)
        #expect(kept.count == EndOfTurn.windowSamples)
        #expect(kept.first == 500)
        #expect(kept.last == Float(EndOfTurn.windowSamples + 499))
    }

    @Test("no answer never ends a turn, and the cut is strictly above one half")
    func verdict() {
        #expect(!EndOfTurn.isFinished(nil))
        #expect(!EndOfTurn.isFinished(0.2))
        #expect(!EndOfTurn.isFinished(0.5), "upstream calls a turn complete above 0.5, not at it")
        #expect(EndOfTurn.isFinished(0.51))
        #expect(EndOfTurn.onset < EndOfTurn.ceiling, "the model must be asked before the timer ends the turn")
    }

    @Test("only audio that has gone quiet after speech is worth asking about")
    func quietTail() {
        #expect(EndOfTurn.endsInQuiet(tone16k(seconds: 1.5, quiet: 0.3)))
        #expect(!EndOfTurn.endsInQuiet(tone16k(seconds: 1.5)), "still talking")
        #expect(!EndOfTurn.endsInQuiet(tone16k(seconds: 1.5, quiet: 0.1)), "quiet, but not for long enough")
        #expect(!EndOfTurn.endsInQuiet([Float](repeating: 0, count: 16_000)), "nothing was said")
        #expect(!EndOfTurn.endsInQuiet([]))
    }

    @Test("the ring keeps the last eight seconds and hands them over at 16kHz")
    func ringResamples() throws {
        let audio = TurnAudio()
        #expect(audio.samples16k().isEmpty, "before any audio there is nothing to ask about")
        // Ten seconds from a 48kHz device, in the tap's 1024-frame buffers.
        let second = try #require(toneBuffer(seconds: 1))
        let format = second.format
        for _ in 0..<10 {
            var offset = 0
            while offset < Int(second.frameLength) {
                let count = min(1_024, Int(second.frameLength) - offset)
                let chunk = try #require(
                    AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)))
                chunk.frameLength = AVAudioFrameCount(count)
                let from = try #require(second.floatChannelData?[0])
                try #require(chunk.floatChannelData?[0]).update(from: from + offset, count: count)
                audio.append(chunk)
                offset += count
            }
        }
        let resampled = audio.samples16k()
        #expect(abs(resampled.count - EndOfTurn.windowSamples) < 1_600,
                "eight seconds at 16kHz, give or take the converter's edges")
        let peak = resampled.map { abs($0) }.max() ?? 0
        #expect(peak > 0.08 && peak < 0.12, "the tone survives the resample at its level")
    }

    @Test("a 16kHz device is handed over as it came, oldest first")
    func ringAtModelRate() throws {
        let audio = TurnAudio()
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000))
        buffer.frameLength = 16_000
        let samples = try #require(buffer.floatChannelData?[0])
        // Nine one-second buffers, each filled with its own index: the first
        // must have rolled out of the eight-second ring.
        for second in 0..<9 {
            samples.update(repeating: Float(second), count: 16_000)
            audio.append(buffer)
        }
        let kept = audio.samples16k()
        #expect(kept.count == EndOfTurn.windowSamples)
        #expect(kept.first == 1)
        #expect(kept.last == 8)
    }
}

@Suite("End of turn in wake mode")
struct WakeEndOfTurnTests {
    @MainActor
    static func listener(_ predictor: TurnPredictor?) -> (VoiceListener, () -> [String]) {
        let voice = VoiceListener()
        voice.enterWakeForTesting(predictor: predictor)
        var heard: [String] = []
        voice.onSignal = { signal in
            if case .heard(let text) = signal { heard.append(text) }
        }
        return (voice, { heard })
    }

    @MainActor
    static func speak(_ voice: VoiceListener) throws {
        voice.appendAudioForTesting(try #require(toneBuffer(seconds: 2, quiet: 0.4)))
    }

    @Test("without the model the silence timer ends the turn, exactly as before")
    @MainActor
    func noModelKeepsTheTimer() async throws {
        let (voice, heard) = Self.listener(nil)
        try Self.speak(voice)
        voice.receivedForTesting("hey chewy what time is it", isFinal: false)
        #expect(await voice.firePauseForTesting() == false, "no model, so no pause check is armed")
        #expect(heard().isEmpty)
        #expect(voice.fireSilenceForTesting())
        #expect(heard() == ["what time is it"])
    }

    @Test("a finished turn is sent at the pause, and the timer is then inert")
    @MainActor
    func finishedCommitsEarly() async throws {
        let model = StubPredictor(answer: 0.93)
        let (voice, heard) = Self.listener(model)
        try Self.speak(voice)
        let turn = voice.receivedForTesting("hey chewy what time is it", isFinal: false)
        #expect(await voice.firePauseForTesting())
        #expect(heard() == ["what time is it"])
        #expect(await model.asked == [EndOfTurn.windowSamples], "asked once, with the full window")
        #expect(voice.fireSilenceForTesting() == false, "the early commit disarms the ceiling")
        // The recogniser revises the partial after the words stop. The turn
        // was restarted, so the revision cannot become a second request.
        voice.receivedForTesting("Hey Chewy, what time is it?", isFinal: false, turn: turn)
        #expect(voice.fireSilenceForTesting() == false)
        #expect(heard() == ["what time is it"])
    }

    @Test("an unfinished turn waits for the timer")
    @MainActor
    func unfinishedWaits() async throws {
        let (voice, heard) = Self.listener(StubPredictor(answer: 0.2))
        try Self.speak(voice)
        voice.receivedForTesting("hey chewy remind me to call my mom and", isFinal: false)
        #expect(await voice.firePauseForTesting())
        #expect(heard().isEmpty)
        #expect(voice.fireSilenceForTesting())
        #expect(heard() == ["remind me to call my mom and"])
    }

    @Test("a model that fails is a model that says wait")
    @MainActor
    func failureWaits() async throws {
        let (voice, heard) = Self.listener(StubPredictor(answer: nil))
        try Self.speak(voice)
        voice.receivedForTesting("hey chewy play some jazz", isFinal: false)
        #expect(await voice.firePauseForTesting())
        #expect(heard().isEmpty)
        #expect(voice.fireSilenceForTesting())
        #expect(heard() == ["play some jazz"])
    }

    @Test("speech that resumes while the model runs wins over its answer")
    @MainActor
    func resumedSpeechMakesTheAnswerStale() async throws {
        let voice = VoiceListener()
        let model = StubPredictor(answer: 0.95) { @Sendable in
            await MainActor.run {
                _ = voice.receivedForTesting(
                    "hey chewy remind me to call my mom and tell her", isFinal: false)
            }
        }
        voice.enterWakeForTesting(predictor: model)
        var heard: [String] = []
        voice.onSignal = { signal in
            if case .heard(let text) = signal { heard.append(text) }
        }
        try Self.speak(voice)
        voice.receivedForTesting("hey chewy remind me to call my mom and", isFinal: false)
        #expect(await voice.firePauseForTesting())
        #expect(heard.isEmpty, "the answer was about a pause the person talked through")
        #expect(voice.fireSilenceForTesting())
        #expect(heard == ["remind me to call my mom and tell her"])
    }

    @Test("the room's talk without the wake word never reaches the model")
    @MainActor
    func unaddressedSpeechIsNotAsked() async throws {
        let model = StubPredictor(answer: 0.99)
        let (voice, heard) = Self.listener(model)
        try Self.speak(voice)
        voice.receivedForTesting("so anyway I was telling her about the trip", isFinal: false)
        #expect(await voice.firePauseForTesting() == false)
        #expect(await model.asked.isEmpty)
        #expect(voice.fireSilenceForTesting())
        #expect(heard().isEmpty, "and the timer still drops it, as it always did")
    }

    @Test("audio still loud at the pause is not asked about, and the timer ends the turn")
    @MainActor
    func stillTalkingWaits() async throws {
        let model = StubPredictor(answer: 0.99)
        let (voice, heard) = Self.listener(model)
        voice.appendAudioForTesting(try #require(toneBuffer(seconds: 2)))
        voice.receivedForTesting("hey chewy remind me to call my mom and", isFinal: false)
        #expect(await voice.firePauseForTesting())
        #expect(await model.asked.isEmpty)
        #expect(heard().isEmpty)
        #expect(voice.fireSilenceForTesting())
        #expect(heard() == ["remind me to call my mom and"])
    }

    @Test("with no audio to read the model is not asked and the timer ends the turn")
    @MainActor
    func noAudioWaits() async throws {
        let model = StubPredictor(answer: 0.99)
        let (voice, heard) = Self.listener(model)
        voice.receivedForTesting("hey chewy what is due", isFinal: false)
        #expect(await voice.firePauseForTesting())
        #expect(await model.asked.isEmpty)
        #expect(heard().isEmpty)
        #expect(voice.fireSilenceForTesting())
        #expect(heard() == ["what is due"])
    }
}
