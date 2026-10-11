// The Mac's own output through a Core Audio process tap, with no display.
//
// Ported from Anarlog (MIT, Copyright (c) 2023-present Fastrepl, Inc.,
// github.com/fastrepl/anarlog), crates/audio-actual/src/speaker/macos.rs:
// a mono global tap that excludes no process, a private aggregate device
// whose tap list holds only that tap (auto start off), and an IO proc that
// hands each buffer on. Anarlog records the call's side this way and only
// this way.
//
// Here it is the fallback, used when ScreenCaptureKit lists no display: on
// 2026-10-10 at 22:21 and 22:25, with the display asleep, the
// SCShareableContent call returned none with onScreenWindowsOnly true and
// with false, so the ScreenCaptureKit path recorded nothing at all.
// ScreenCaptureKit stays first because it runs under the Screen Recording
// grant Kyber already holds; the tap runs under System Audio Recording,
// which macOS asks for separately.

import AVFoundation
import CoreAudio
import Foundation

@available(macOS 14.2, *)
final class TapAudio {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let queue = DispatchQueue(label: "room-capture.tap")
    private let resampler = Resampler()
    private let mixer: Mixer

    init(mixer: Mixer) { self.mixer = mixer }

    /// nil once audio is flowing, else what went wrong in a few words.
    func start() -> String? {
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        var status = AudioHardwareCreateProcessTap(description, &tap)
        guard status == noErr, tap != kAudioObjectUnknown else { return "process tap refused (OSStatus \(status))" }
        tapID = tap

        var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMain)
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        status = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &asbd)
        guard status == noErr, let format = AVAudioFormat(streamDescription: &asbd) else {
            stop()
            return "tap format unreadable (OSStatus \(status))"
        }

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Chewbacca room-capture",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: false,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString]],
        ]
        var device = AudioObjectID(kAudioObjectUnknown)
        status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device)
        guard status == noErr else {
            stop()
            return "aggregate device refused (OSStatus \(status))"
        }
        aggregateID = device

        status = AudioDeviceCreateIOProcIDWithBlock(&procID, device, queue) { [weak self] _, input, _, _, _ in
            guard let self,
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: input, deallocator: nil),
                  buffer.frameLength > 0 else { return }
            self.mixer.append(self.resampler.convert(buffer), mic: false)
        }
        guard status == noErr, let procID else {
            stop()
            return "IO proc refused (OSStatus \(status))"
        }
        status = AudioDeviceStart(device, procID)
        guard status == noErr else {
            stop()
            return "device did not start (OSStatus \(status))"
        }
        return nil
    }

    func stop() {
        if aggregateID != kAudioObjectUnknown {
            if let procID {
                AudioDeviceStop(aggregateID, procID)
                AudioDeviceDestroyIOProcID(aggregateID, procID)
            }
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
    }
}
