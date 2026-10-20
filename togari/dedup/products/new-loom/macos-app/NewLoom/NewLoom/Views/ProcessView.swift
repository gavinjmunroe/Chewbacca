import SwiftUI

struct ProcessView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Process")
                    .font(.title)
                    .fontWeight(.bold)
                Text("Upload and transcribe your recording")
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(32)

            Divider()

            ScrollView {
                VStack(spacing: 24) {
                    if appState.isProcessing {
                        VStack(spacing: 16) {
                            ProgressView()
                                .scaleEffect(1.5)
                            Text(appState.processingMessage)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 60)
                    } else if let transcript = appState.transcriptText {
                        // Transcript result
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Transcript", systemImage: "text.alignleft")
                                .font(.headline)

                            Text(transcript)
                                .font(.system(size: 13))
                                .lineSpacing(4)
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.secondary.opacity(0.05))
                                .cornerRadius(12)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.secondary.opacity(0.1), lineWidth: 1)
                                )

                            HStack(spacing: 24) {
                                StatView(value: "\(appState.transcriptWordCount)", label: "Words")
                                StatView(value: formatMs(appState.transcriptDurationMs), label: "Duration")
                            }
                        }

                        Button(action: {
                            appState.completedSteps.insert(.process)
                            appState.currentStep = .transform
                        }) {
                            Text("Continue to Transform")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Color(red: 0.39, green: 0.4, blue: 0.95))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    } else {
                        // Transcribe button
                        VStack(spacing: 16) {
                            Image(systemName: "waveform")
                                .font(.system(size: 48))
                                .foregroundColor(.secondary.opacity(0.5))

                            Text(appState.recordingId != nil ? "Ready to transcribe" : "Record or import a video first")
                                .foregroundColor(.secondary)

                            Button(action: {
                                Task { await appState.transcribe() }
                            }) {
                                HStack {
                                    Image(systemName: "waveform")
                                    Text("Transcribe Audio")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(appState.recordingId != nil ? Color(red: 0.39, green: 0.4, blue: 0.95) : Color.gray)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            .buttonStyle(.plain)
                            .disabled(appState.recordingId == nil)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    }
                }
                .padding(32)
            }
        }
    }

    func formatMs(_ ms: Int) -> String {
        let secs = ms / 1000
        let mins = secs / 60
        let remainingSecs = secs % 60
        return String(format: "%d:%02d", mins, remainingSecs)
    }
}

struct StatView: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Color(red: 0.39, green: 0.4, blue: 0.95))
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.secondary)
                .textCase(.uppercase)
        }
    }
}
