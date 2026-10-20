import SwiftUI

struct GenerateView: View {
    @EnvironmentObject var appState: AppState

    private let voices: [(id: String, name: String, category: String)] = [
        ("21m00Tcm4TlvDq8ikWAM", "Rachel", "Professional"),
        ("AZnzlk1XvdvUeBnXmlld", "Domi", "Professional"),
        ("EXAVITQu4vr4xnSDxMaL", "Bella", "Warm"),
        ("ErXwobaYiN019PkySvjV", "Antoni", "Authoritative"),
        ("MF3mGyEYCl7XYWbV9V6O", "Elli", "Narrative"),
        ("TxGEqnHWrfWFTfGW9XjX", "Josh", "Deep"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Generate")
                    .font(.title)
                    .fontWeight(.bold)
                Text("Synthesize polished audio with ElevenLabs voice cloning")
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
                    } else if appState.synthesizedAudioURL != nil {
                        // Results
                        VStack(spacing: 16) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 48))
                                .foregroundColor(.green)

                            Text("Audio Generated")
                                .font(.headline)

                            Text("Voice: \(appState.selectedVoiceName ?? "Unknown")")
                                .foregroundColor(.secondary)

                            // Audio player placeholder
                            HStack {
                                Image(systemName: "play.circle.fill")
                                    .font(.system(size: 32))
                                    .foregroundColor(Color(red: 0.39, green: 0.4, blue: 0.95))

                                VStack(alignment: .leading) {
                                    Text("Transformed Audio")
                                        .font(.system(size: 13, weight: .medium))
                                    Text(formatMs(appState.synthesizedDurationMs))
                                        .font(.system(size: 12))
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                            }
                            .padding(16)
                            .background(Color.secondary.opacity(0.05))
                            .cornerRadius(12)

                            Button(action: {
                                appState.completedSteps.insert(.generate)
                                appState.currentStep = .share
                            }) {
                                Text("Continue to Share")
                                    .fontWeight(.semibold)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(Color(red: 0.39, green: 0.4, blue: 0.95))
                                    .foregroundColor(.white)
                                    .cornerRadius(10)
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        // Voice selection
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Select Voice")
                                .font(.system(size: 13, weight: .semibold))

                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                            ], spacing: 12) {
                                ForEach(voices, id: \.id) { voice in
                                    VoiceCard(
                                        name: voice.name,
                                        category: voice.category,
                                        isSelected: appState.selectedVoiceId == voice.id,
                                        action: {
                                            appState.selectedVoiceId = voice.id
                                            appState.selectedVoiceName = voice.name
                                        }
                                    )
                                }
                            }
                        }

                        // Preview of transformed text
                        if let text = appState.transformedText {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Script Preview")
                                    .font(.system(size: 13, weight: .semibold))

                                Text(text)
                                    .font(.system(size: 12))
                                    .lineSpacing(3)
                                    .foregroundColor(.secondary)
                                    .lineLimit(6)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.secondary.opacity(0.05))
                                    .cornerRadius(10)
                            }
                        }

                        Button(action: {
                            Task { await appState.synthesize() }
                        }) {
                            HStack {
                                Image(systemName: "speaker.wave.3")
                                Text("Generate Audio")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(appState.selectedVoiceId != nil && appState.transformedText != nil
                                ? Color(red: 0.39, green: 0.4, blue: 0.95) : Color.gray)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                        .disabled(appState.selectedVoiceId == nil || appState.transformedText == nil)
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

struct VoiceCard: View {
    let name: String
    let category: String
    var isSelected: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: "person.wave.2")
                    .font(.system(size: 20))
                    .foregroundColor(isSelected ? Color(red: 0.39, green: 0.4, blue: 0.95) : .secondary)

                Text(name)
                    .font(.system(size: 13, weight: .semibold))

                Text(category)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(isSelected ? Color(red: 0.39, green: 0.4, blue: 0.95).opacity(0.1) : Color.secondary.opacity(0.05))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color(red: 0.39, green: 0.4, blue: 0.95) : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}
