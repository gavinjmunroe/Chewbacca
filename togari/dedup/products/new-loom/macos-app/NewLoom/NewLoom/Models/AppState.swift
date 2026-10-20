import Foundation
import SwiftUI
import Combine

enum WorkflowStep: Int, CaseIterable, Identifiable {
    case record = 0
    case process = 1
    case transform = 2
    case generate = 3
    case share = 4

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .record: return "Record"
        case .process: return "Process"
        case .transform: return "Transform"
        case .generate: return "Generate"
        case .share: return "Share"
        }
    }

    var icon: String {
        switch self {
        case .record: return "record.circle"
        case .process: return "waveform"
        case .transform: return "sparkles"
        case .generate: return "speaker.wave.3"
        case .share: return "square.and.arrow.up"
        }
    }

    var subtitle: String {
        switch self {
        case .record: return "Capture screen, camera & audio"
        case .process: return "Upload & transcribe recording"
        case .transform: return "Apply McKinsey communication frameworks"
        case .generate: return "Synthesize polished audio"
        case .share: return "Share your presentation"
        }
    }
}

enum RecordingState {
    case idle
    case recording
    case paused
    case stopped
}

@MainActor
class AppState: ObservableObject {
    @Published var currentStep: WorkflowStep = .record
    @Published var completedSteps: Set<WorkflowStep> = []
    @Published var recordingState: RecordingState = .idle
    @Published var recordingDuration: TimeInterval = 0
    @Published var cameraEnabled: Bool = true
    @Published var selectedMicrophoneId: String?

    // Recording data
    @Published var recordingId: String?
    @Published var videoURL: URL?

    // Transcript
    @Published var transcriptText: String?
    @Published var transcriptWordCount: Int = 0
    @Published var transcriptDurationMs: Int = 0

    // Transform
    @Published var transformedText: String?
    @Published var improvementScore: Int = 0
    @Published var structureUsed: String = ""
    @Published var transformationsCount: Int = 0
    @Published var targetStructure: String = "auto"

    // Synthesize
    @Published var selectedVoiceId: String?
    @Published var selectedVoiceName: String?
    @Published var synthesizedAudioURL: URL?
    @Published var synthesizedDurationMs: Int = 0

    // Share
    @Published var shareURL: String?

    // UI State
    @Published var isProcessing: Bool = false
    @Published var processingMessage: String = ""
    @Published var errorMessage: String?

    private var timer: Timer?
    private let apiBase = "http://localhost:4200"

    // MARK: - Recording

    func startRecording() {
        recordingState = .recording
        recordingDuration = 0
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.recordingDuration += 1
            }
        }
    }

    func pauseRecording() {
        recordingState = .paused
        timer?.invalidate()
        timer = nil
    }

    func resumeRecording() {
        recordingState = .recording
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.recordingDuration += 1
            }
        }
    }

    func stopRecording() {
        recordingState = .stopped
        timer?.invalidate()
        timer = nil
        completedSteps.insert(.record)
        currentStep = .process
    }

    // MARK: - API Calls

    func uploadVideo(fileURL: URL) async {
        isProcessing = true
        processingMessage = "Uploading video..."
        errorMessage = nil

        do {
            var request = URLRequest(url: URL(string: "\(apiBase)/api/upload")!)
            request.httpMethod = "POST"

            let boundary = UUID().uuidString
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

            let videoData = try Data(contentsOf: fileURL)
            var body = Data()
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"video\"; filename=\"recording.webm\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: video/webm\r\n\r\n".data(using: .utf8)!)
            body.append(videoData)
            body.append("\r\n--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"title\"\r\n\r\n".data(using: .utf8)!)
            body.append("Recording \(Date().formatted())".data(using: .utf8)!)
            body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 201 else {
                throw APIError.uploadFailed
            }

            let result = try JSONDecoder().decode(UploadResponse.self, from: data)
            recordingId = result.recordingId
            videoURL = fileURL
            isProcessing = false
        } catch {
            errorMessage = "Upload failed: \(error.localizedDescription)"
            isProcessing = false
        }
    }

    func transcribe() async {
        guard let recordingId = recordingId else { return }

        isProcessing = true
        processingMessage = "Transcribing audio..."
        errorMessage = nil

        do {
            var request = URLRequest(url: URL(string: "\(apiBase)/api/transcribe")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(["recordingId": recordingId])

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw APIError.transcriptionFailed
            }

            let result = try JSONDecoder().decode(TranscriptResponse.self, from: data)
            transcriptText = result.fullText
            transcriptWordCount = result.wordCount
            transcriptDurationMs = result.durationMs
            completedSteps.insert(.process)
            currentStep = .transform
            isProcessing = false
        } catch {
            errorMessage = "Transcription failed: \(error.localizedDescription)"
            isProcessing = false
        }
    }

    func transform() async {
        guard let recordingId = recordingId else { return }

        isProcessing = true
        processingMessage = "Transforming with BMA modules..."
        errorMessage = nil

        do {
            var request = URLRequest(url: URL(string: "\(apiBase)/api/transform")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")

            let body: [String: String] = [
                "recordingId": recordingId,
                "targetStructure": targetStructure,
            ]
            request.httpBody = try JSONEncoder().encode(body)

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw APIError.transformFailed
            }

            let result = try JSONDecoder().decode(TransformResponse.self, from: data)
            transformedText = result.transformedText
            improvementScore = result.improvementScore
            structureUsed = result.structureUsed
            transformationsCount = result.transformationsApplied.count
            completedSteps.insert(.transform)
            currentStep = .generate
            isProcessing = false
        } catch {
            errorMessage = "Transform failed: \(error.localizedDescription)"
            isProcessing = false
        }
    }

    func synthesize() async {
        guard let recordingId = recordingId, let voiceId = selectedVoiceId else { return }

        isProcessing = true
        processingMessage = "Generating audio with ElevenLabs..."
        errorMessage = nil

        do {
            var request = URLRequest(url: URL(string: "\(apiBase)/api/synthesize")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")

            let body: [String: String] = [
                "recordingId": recordingId,
                "voiceId": voiceId,
                "voiceName": selectedVoiceName ?? voiceId,
            ]
            request.httpBody = try JSONEncoder().encode(body)

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw APIError.synthesisFailed
            }

            let result = try JSONDecoder().decode(SynthesizeResponse.self, from: data)
            synthesizedAudioURL = URL(string: "\(apiBase)\(result.audioUrl)")
            synthesizedDurationMs = result.durationMs
            shareURL = "\(apiBase)/api/recordings/\(recordingId)"
            completedSteps.insert(.generate)
            currentStep = .share
            isProcessing = false
        } catch {
            errorMessage = "Synthesis failed: \(error.localizedDescription)"
            isProcessing = false
        }
    }

    // MARK: - Helpers

    var formattedDuration: String {
        let mins = Int(recordingDuration) / 60
        let secs = Int(recordingDuration) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - API Types

enum APIError: Error, LocalizedError {
    case uploadFailed
    case transcriptionFailed
    case transformFailed
    case synthesisFailed

    var errorDescription: String? {
        switch self {
        case .uploadFailed: return "Failed to upload video"
        case .transcriptionFailed: return "Failed to transcribe audio"
        case .transformFailed: return "Failed to transform transcript"
        case .synthesisFailed: return "Failed to synthesize audio"
        }
    }
}

struct UploadResponse: Codable {
    let recordingId: String
    let videoUrl: String
    let message: String
}

struct TranscriptResponse: Codable {
    let recordingId: String
    let fullText: String
    let durationMs: Int
    let wordCount: Int
}

struct TransformationApplied: Codable {
    let moduleType: String
    let originalSnippet: String
    let transformedSnippet: String
    let explanation: String
}

struct TransformResponse: Codable {
    let recordingId: String
    let transformedText: String
    let transformationsApplied: [TransformationApplied]
    let improvementScore: Int
    let structureUsed: String
    let wordCountOriginal: Int
    let wordCountTransformed: Int
}

struct SynthesizeResponse: Codable {
    let recordingId: String
    let audioUrl: String
    let voiceId: String
    let voiceName: String
    let durationMs: Int
}
