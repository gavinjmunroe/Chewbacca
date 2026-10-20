import Foundation
import ScreenCaptureKit
import AVFoundation
import Combine

/// Screen recording service using ScreenCaptureKit (macOS 13+)
@MainActor
class ScreenRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var availableDisplays: [SCDisplay] = []
    @Published var availableWindows: [SCWindow] = []
    @Published var selectedDisplay: SCDisplay?
    @Published var captureError: String?

    private var stream: SCStream?
    private var streamOutput: CaptureOutput?
    private var videoWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var startTime: CMTime?
    private var outputURL: URL?

    // MARK: - Content Discovery

    func refreshAvailableContent() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            availableDisplays = content.displays
            availableWindows = content.windows.filter { $0.isOnScreen }

            if selectedDisplay == nil {
                selectedDisplay = content.displays.first
            }
        } catch {
            captureError = "Failed to get available content: \(error.localizedDescription)"
        }
    }

    // MARK: - Recording

    func startRecording(includeAudio: Bool = true) async -> URL? {
        guard let display = selectedDisplay else {
            captureError = "No display selected"
            return nil
        }

        do {
            // Create output file
            let tempDir = FileManager.default.temporaryDirectory
            let filename = "NewLoom_\(UUID().uuidString).mov"
            outputURL = tempDir.appendingPathComponent(filename)

            guard let url = outputURL else { return nil }

            // Configure asset writer
            videoWriter = try AVAssetWriter(outputURL: url, fileType: .mov)

            // Video settings
            let videoSettings: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: display.width,
                AVVideoHeightKey: display.height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 5_000_000,
                    AVVideoMaxKeyFrameIntervalKey: 30,
                ],
            ]

            videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
            videoInput?.expectsMediaDataInRealTime = true

            if let videoInput = videoInput {
                videoWriter?.add(videoInput)
            }

            // Audio settings
            if includeAudio {
                let audioSettings: [String: Any] = [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVNumberOfChannelsKey: 2,
                    AVSampleRateKey: 44100.0,
                    AVEncoderBitRateKey: 128000,
                ]

                audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
                audioInput?.expectsMediaDataInRealTime = true

                if let audioInput = audioInput {
                    videoWriter?.add(audioInput)
                }
            }

            videoWriter?.startWriting()
            videoWriter?.startSession(atSourceTime: .zero)
            startTime = nil

            // Configure capture stream
            let filter = SCContentFilter(display: display, excludingWindows: [])

            let config = SCStreamConfiguration()
            config.width = display.width
            config.height = display.height
            config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            config.showsCursor = true
            config.capturesAudio = includeAudio
            config.sampleRate = 44100
            config.channelCount = 2

            streamOutput = CaptureOutput { [weak self] sampleBuffer, outputType in
                self?.processSampleBuffer(sampleBuffer, type: outputType)
            }

            stream = SCStream(filter: filter, configuration: config, delegate: nil)

            guard let stream = stream, let output = streamOutput else { return nil }

            try stream.addStreamOutput(output, type: .screen, sampleBufferQueueCapacity: 5)
            if includeAudio {
                try stream.addStreamOutput(output, type: .audio, sampleBufferQueueCapacity: 10)
            }

            try await stream.startCapture()
            isRecording = true

            return url
        } catch {
            captureError = "Failed to start recording: \(error.localizedDescription)"
            cleanupRecording()
            return nil
        }
    }

    func stopRecording() async -> URL? {
        guard isRecording else { return nil }

        do {
            try await stream?.stopCapture()
        } catch {
            captureError = "Error stopping capture: \(error.localizedDescription)"
        }

        // Finalize the asset writer
        videoInput?.markAsFinished()
        audioInput?.markAsFinished()

        await withCheckedContinuation { continuation in
            videoWriter?.finishWriting {
                continuation.resume()
            }
        }

        isRecording = false
        let url = outputURL
        cleanupRecording()
        return url
    }

    // MARK: - Sample Processing

    private func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, type: SCStreamOutputType) {
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if startTime == nil {
            startTime = timestamp
        }

        guard let startTime = startTime else { return }
        let adjustedTime = CMTimeSubtract(timestamp, startTime)

        switch type {
        case .screen:
            if let videoInput = videoInput, videoInput.isReadyForMoreMediaData {
                // Adjust timing
                if let adjustedBuffer = adjustTimestamp(sampleBuffer, to: adjustedTime) {
                    videoInput.append(adjustedBuffer)
                }
            }
        case .audio:
            if let audioInput = audioInput, audioInput.isReadyForMoreMediaData {
                if let adjustedBuffer = adjustTimestamp(sampleBuffer, to: adjustedTime) {
                    audioInput.append(adjustedBuffer)
                }
            }
        @unknown default:
            break
        }
    }

    private func adjustTimestamp(_ buffer: CMSampleBuffer, to time: CMTime) -> CMSampleBuffer? {
        var timingInfo = CMSampleTimingInfo(
            duration: CMSampleBufferGetDuration(buffer),
            presentationTimeStamp: time,
            decodeTimeStamp: .invalid
        )

        var newBuffer: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(
            allocator: nil,
            sampleBuffer: buffer,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleBufferOut: &newBuffer
        )
        return newBuffer
    }

    private func cleanupRecording() {
        stream = nil
        streamOutput = nil
        videoWriter = nil
        videoInput = nil
        audioInput = nil
        startTime = nil
    }
}

// MARK: - Capture Output Delegate

private class CaptureOutput: NSObject, SCStreamOutput {
    let handler: (CMSampleBuffer, SCStreamOutputType) -> Void

    init(handler: @escaping (CMSampleBuffer, SCStreamOutputType) -> Void) {
        self.handler = handler
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        handler(sampleBuffer, type)
    }
}
