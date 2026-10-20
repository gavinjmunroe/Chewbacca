import SwiftUI

struct RecordView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingFilePicker = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 4) {
                Text("Record")
                    .font(.title)
                    .fontWeight(.bold)
                Text("Capture your screen, camera, and audio")
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(32)

            Divider()

            ScrollView {
                VStack(spacing: 24) {
                    // Recording area
                    if appState.recordingState == .idle || appState.recordingState == .stopped {
                        // Source selection
                        HStack(spacing: 16) {
                            SourceCard(
                                icon: "desktopcomputer",
                                title: "Screen",
                                subtitle: "Capture your display",
                                isSelected: true
                            )

                            SourceCard(
                                icon: "camera",
                                title: "Camera",
                                subtitle: "Include webcam",
                                isSelected: appState.cameraEnabled,
                                action: { appState.cameraEnabled.toggle() }
                            )
                        }

                        // Start recording button
                        Button(action: { appState.startRecording() }) {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(Color.red)
                                    .frame(width: 12, height: 12)
                                Text("Start Recording")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.red)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)

                        // Or import existing video
                        Divider()

                        Button(action: { showingFilePicker = true }) {
                            HStack(spacing: 8) {
                                Image(systemName: "doc.badge.plus")
                                Text("Import Existing Video")
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color.secondary.opacity(0.1))
                            .foregroundColor(.primary)
                            .cornerRadius(10)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                        .fileImporter(
                            isPresented: $showingFilePicker,
                            allowedContentTypes: [.movie, .video, .mpeg4Movie, .quickTimeMovie],
                            allowsMultipleSelection: false
                        ) { result in
                            if case .success(let urls) = result, let url = urls.first {
                                Task {
                                    await appState.uploadVideo(fileURL: url)
                                }
                            }
                        }

                    } else {
                        // Recording in progress
                        VStack(spacing: 24) {
                            // Preview area
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color.black)
                                .frame(height: 300)
                                .overlay(
                                    VStack(spacing: 16) {
                                        Image(systemName: "record.circle")
                                            .font(.system(size: 48))
                                            .foregroundColor(.red)
                                            .opacity(appState.recordingState == .paused ? 0.5 : 1.0)
                                            .animation(.easeInOut(duration: 0.8).repeatForever(), value: appState.recordingState)

                                        Text(appState.recordingState == .paused ? "Paused" : "Recording")
                                            .font(.headline)
                                            .foregroundColor(.white)
                                    }
                                )

                            // Timer
                            Text(appState.formattedDuration)
                                .font(.system(size: 48, weight: .bold, design: .monospaced))
                                .foregroundColor(appState.recordingState == .paused ? .orange : .red)

                            // Controls
                            HStack(spacing: 16) {
                                Button(action: {
                                    if appState.recordingState == .paused {
                                        appState.resumeRecording()
                                    } else {
                                        appState.pauseRecording()
                                    }
                                }) {
                                    HStack {
                                        Image(systemName: appState.recordingState == .paused ? "play.fill" : "pause.fill")
                                        Text(appState.recordingState == .paused ? "Resume" : "Pause")
                                    }
                                    .frame(width: 140)
                                    .padding(.vertical, 12)
                                    .background(Color.secondary.opacity(0.15))
                                    .cornerRadius(10)
                                }
                                .buttonStyle(.plain)

                                Button(action: { appState.stopRecording() }) {
                                    HStack {
                                        Image(systemName: "stop.fill")
                                        Text("Stop")
                                            .fontWeight(.semibold)
                                    }
                                    .frame(width: 140)
                                    .padding(.vertical, 12)
                                    .background(Color.red)
                                    .foregroundColor(.white)
                                    .cornerRadius(10)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(32)
            }
        }
    }
}

struct SourceCard: View {
    let icon: String
    let title: String
    let subtitle: String
    var isSelected: Bool = false
    var action: (() -> Void)?

    var body: some View {
        Button(action: { action?() }) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 24))
                    .foregroundColor(isSelected ? Color(red: 0.39, green: 0.4, blue: 0.95) : .secondary)

                Text(title)
                    .font(.system(size: 13, weight: .semibold))

                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(isSelected ? Color(red: 0.39, green: 0.4, blue: 0.95).opacity(0.1) : Color.secondary.opacity(0.05))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color(red: 0.39, green: 0.4, blue: 0.95) : Color.secondary.opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
