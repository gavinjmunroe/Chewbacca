import SwiftUI

struct ShareView: View {
    @EnvironmentObject var appState: AppState
    @State private var copied = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Share")
                    .font(.title)
                    .fontWeight(.bold)
                Text("Share your polished presentation")
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(32)

            Divider()

            ScrollView {
                VStack(spacing: 24) {
                    // Success banner
                    if appState.completedSteps.contains(.generate) {
                        HStack(spacing: 12) {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 28))
                                .foregroundColor(.green)

                            VStack(alignment: .leading, spacing: 2) {
                                Text("Presentation Ready")
                                    .font(.headline)
                                Text("Your recording has been transformed and synthesized")
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                        }
                        .padding(16)
                        .background(Color.green.opacity(0.08))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.green.opacity(0.2), lineWidth: 1)
                        )
                    }

                    // Share link
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Share Link")
                            .font(.system(size: 13, weight: .semibold))

                        HStack(spacing: 8) {
                            TextField("Share link", text: .constant(appState.shareURL ?? "Complete all steps to generate a link"))
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12))
                                .disabled(true)

                            Button(action: {
                                if let url = appState.shareURL {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(url, forType: .string)
                                    copied = true
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                        copied = false
                                    }
                                }
                            }) {
                                Text(copied ? "Copied!" : "Copy")
                                    .font(.system(size: 12, weight: .medium))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Color.secondary.opacity(0.1))
                                    .cornerRadius(6)
                            }
                            .buttonStyle(.plain)
                            .disabled(appState.shareURL == nil)
                        }
                    }

                    Divider()

                    // Download options
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Downloads")
                            .font(.system(size: 13, weight: .semibold))

                        DownloadRow(
                            icon: "film",
                            title: "Original Video",
                            subtitle: "The raw recording",
                            enabled: appState.videoURL != nil
                        )

                        DownloadRow(
                            icon: "waveform",
                            title: "Transformed Audio",
                            subtitle: "Synthesized with ElevenLabs",
                            enabled: appState.synthesizedAudioURL != nil
                        )

                        DownloadRow(
                            icon: "doc.text",
                            title: "Transformed Script",
                            subtitle: "McKinsey-style transcript",
                            enabled: appState.transformedText != nil
                        )
                    }

                    Divider()

                    // Summary stats
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Summary")
                            .font(.system(size: 13, weight: .semibold))

                        HStack(spacing: 32) {
                            StatView(value: "\(appState.transcriptWordCount)", label: "Original Words")
                            StatView(
                                value: "\(appState.transformedText?.split(separator: " ").count ?? 0)",
                                label: "Final Words"
                            )
                            StatView(value: "\(appState.improvementScore)", label: "Score")
                        }
                    }

                    // New recording button
                    Button(action: resetWorkflow) {
                        HStack {
                            Image(systemName: "plus.circle")
                            Text("New Recording")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(red: 0.39, green: 0.4, blue: 0.95))
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .buttonStyle(.plain)
                }
                .padding(32)
            }
        }
    }

    func resetWorkflow() {
        appState.currentStep = .record
        appState.completedSteps = []
        appState.recordingState = .idle
        appState.recordingDuration = 0
        appState.recordingId = nil
        appState.videoURL = nil
        appState.transcriptText = nil
        appState.transformedText = nil
        appState.synthesizedAudioURL = nil
        appState.shareURL = nil
        appState.improvementScore = 0
        appState.transformationsCount = 0
    }
}

struct DownloadRow: View {
    let icon: String
    let title: String
    let subtitle: String
    var enabled: Bool = true

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(enabled ? Color(red: 0.39, green: 0.4, blue: 0.95) : .secondary)
                .frame(width: 32, height: 32)
                .background(enabled ? Color(red: 0.39, green: 0.4, blue: 0.95).opacity(0.1) : Color.secondary.opacity(0.05))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            Spacer()

            Button(action: {}) {
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 18))
                    .foregroundColor(enabled ? Color(red: 0.39, green: 0.4, blue: 0.95) : .secondary.opacity(0.3))
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
        }
        .padding(12)
        .background(Color.secondary.opacity(0.03))
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.secondary.opacity(0.1), lineWidth: 1)
        )
        .opacity(enabled ? 1.0 : 0.5)
    }
}
