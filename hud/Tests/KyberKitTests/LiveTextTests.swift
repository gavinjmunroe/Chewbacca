import AVFoundation
import Foundation
import Testing

@testable import KyberKit

@Suite("Live dictation text")
struct LiveTextTests {
    @Test("the newest word is typed the moment it is heard")
    func newestWordShows() {
        #expect(LiveText.live("Send me the deck") == "Send me the deck")
        #expect(LiveText.live("Send") == "Send")
    }

    @Test("the closing mark waits for the end, so it never blinks")
    func closingMarkWaits() {
        #expect(LiveText.live("Send me the deck.") == "Send me the deck")
        #expect(LiveText.live("Is it done?") == "Is it done")
        #expect(LiveText.live("Hey, Sam") == "Hey, Sam")
    }

    @Test("a revised word is deleted and retyped, never left behind")
    func revisionRetypes() {
        let edit = LiveText.edit(
            from: LiveText.live("text sara about"), to: LiveText.live("text Sarah about it"))
        #expect(edit.delete == "sara about".count)
        #expect(edit.insert == "Sarah about it")
    }

    @Test("an edit deletes only the tail that differs")
    func editIsMinimal() {
        let edit = LiveText.edit(from: "Hey Sam", to: "Hey Sam, can you")
        #expect(edit.delete == 0)
        #expect(edit.insert == ", can you")
        let fix = LiveText.edit(from: "deck for Northwynd", to: "deck for Northwind.")
        #expect(fix.delete == 3)
        #expect(fix.insert == "ind.")
        #expect(LiveText.edit(from: "same", to: "same") == (0, ""))
    }

    @Test("a turn's audio comes out as 16kHz mono WAV")
    func recorderWritesWav() throws {
        let format = try #require(
            AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4_800))
        buffer.frameLength = 4_800
        let recorder = AudioRecorder()
        recorder.append(buffer)
        recorder.append(buffer)
        let wav = try #require(recorder.wav16k())
        #expect(String(decoding: wav.prefix(4), as: UTF8.self) == "RIFF")
        // 0.2s at 16kHz, 2 bytes a sample, plus the 44-byte header.
        #expect(abs(wav.count - (44 + 3_200 * 2)) < 400)
    }
}
