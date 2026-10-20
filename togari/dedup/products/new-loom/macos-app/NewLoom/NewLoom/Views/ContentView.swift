import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 280)
        } detail: {
            DetailView()
        }
        .frame(minWidth: 900, minHeight: 600)
    }
}

// MARK: - Sidebar

struct SidebarView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Logo header
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(LinearGradient(
                        colors: [Color(red: 0.39, green: 0.4, blue: 0.95), Color.purple],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Text("NL")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                    )

                Text("New Loom")
                    .font(.title2)
                    .fontWeight(.bold)

                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            Divider()

            // Workflow steps
            ScrollView {
                VStack(spacing: 4) {
                    ForEach(WorkflowStep.allCases) { step in
                        StepRow(step: step)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }

            Spacer()

            // Status bar
            if appState.isProcessing {
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.7)
                    Text(appState.processingMessage)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }

            if let error = appState.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(8)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct StepRow: View {
    let step: WorkflowStep
    @EnvironmentObject var appState: AppState

    private var isActive: Bool { appState.currentStep == step }
    private var isCompleted: Bool { appState.completedSteps.contains(step) }

    var body: some View {
        Button(action: { appState.currentStep = step }) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(isCompleted ? Color.green : (isActive ? Color(red: 0.39, green: 0.4, blue: 0.95) : Color.gray.opacity(0.2)))
                        .frame(width: 28, height: 28)

                    if isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        Text("\(step.rawValue + 1)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(isActive ? .white : .secondary)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(step.title)
                        .font(.system(size: 13, weight: isActive ? .semibold : .medium))
                        .foregroundColor(isActive ? .primary : .secondary)

                    Text(step.subtitle)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                if isActive {
                    Image(systemName: step.icon)
                        .font(.system(size: 12))
                        .foregroundColor(Color(red: 0.39, green: 0.4, blue: 0.95))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(isActive ? Color(red: 0.39, green: 0.4, blue: 0.95).opacity(0.1) : Color.clear)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Detail View

struct DetailView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            switch appState.currentStep {
            case .record:
                RecordView()
            case .process:
                ProcessView()
            case .transform:
                TransformView()
            case .generate:
                GenerateView()
            case .share:
                ShareView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
