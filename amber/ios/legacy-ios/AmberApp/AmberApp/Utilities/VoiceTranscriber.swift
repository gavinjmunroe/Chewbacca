import Foundation
import Combine
import Speech
import AVFoundation

/// Thin wrapper around SFSpeechRecognizer + AVAudioEngine. Streams partial
/// transcripts while the mic is live. Stop() resolves the continuation with
/// the final transcript or throws the last error.
@MainActor
final class VoiceTranscriber: ObservableObject {
    @Published var transcript: String = ""
    @Published var isListening: Bool = false
    @Published var error: String?

    private let recognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    init(locale: Locale = .current) {
        self.recognizer = SFSpeechRecognizer(locale: locale)
    }

    func requestAuthorization() async -> Bool {
        let status = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        return status == .authorized
    }

    func start() async {
        guard !isListening else { return }
        transcript = ""
        error = nil

        let granted = await requestAuthorization()
        guard granted, let recognizer, recognizer.isAvailable else {
            error = "Speech recognition is unavailable."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = "Could not start microphone."
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        self.request = req

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }

        audioEngine.prepare()
        do { try audioEngine.start() } catch {
            self.error = "Mic failed to start."
            return
        }

        isListening = true
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result = result {
                    self.transcript = result.bestTranscription.formattedString
                }
                if let error = error {
                    self.error = error.localizedDescription
                    await self.stop()
                }
            }
        }
    }

    func stop() async {
        guard isListening else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        isListening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
