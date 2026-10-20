import SwiftUI

struct TransformView: View {
    @EnvironmentObject var appState: AppState

    private let structures = [
        ("auto", "Auto-detect best structure"),
        ("pyramid", "Pyramid Principle"),
        ("scr", "Situation-Complication-Resolution"),
        ("mece", "MECE Framework"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Transform")
                    .font(.title)
                    .fontWeight(.bold)
                Text("Apply BMA training modules for McKinsey-style dialogue")
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
                    } else if let transformed = appState.transformedText {
                        // Results
                        VStack(alignment: .leading, spacing: 16) {
                            // Score and stats
                            HStack(spacing: 24) {
                                ScoreCircle(score: appState.improvementScore)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Structure: \(appState.structureUsed.replacingOccurrences(of: "_", with: " "))")
                                        .font(.system(size: 13, weight: .medium))
                                    Text("\(appState.transformationsCount) transformations applied")
                                        .font(.system(size: 12))
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                            }

                            Divider()

                            // Before / After comparison
                            HStack(alignment: .top, spacing: 16) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Label("Original", systemImage: "text.badge.minus")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundColor(.red)

                                    Text(appState.transcriptText ?? "")
                                        .font(.system(size: 12))
                                        .lineSpacing(3)
                                        .foregroundColor(.secondary)
                                        .padding(12)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color.red.opacity(0.05))
                                        .cornerRadius(10)
                                }

                                VStack(alignment: .leading, spacing: 8) {
                                    Label("Transformed", systemImage: "text.badge.plus")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundColor(.green)

                                    Text(transformed)
                                        .font(.system(size: 12))
                                        .lineSpacing(3)
                                        .padding(12)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color.green.opacity(0.05))
                                        .cornerRadius(10)
                                }
                            }
                        }

                        Button(action: {
                            appState.completedSteps.insert(.transform)
                            appState.currentStep = .generate
                        }) {
                            Text("Continue to Generate")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Color(red: 0.39, green: 0.4, blue: 0.95))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    } else {
                        // Structure picker and transform button
                        VStack(spacing: 20) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Communication Framework")
                                    .font(.system(size: 13, weight: .semibold))

                                VStack(spacing: 8) {
                                    ForEach(structures, id: \.0) { structure in
                                        Button(action: { appState.targetStructure = structure.0 }) {
                                            HStack {
                                                Image(systemName: appState.targetStructure == structure.0 ? "checkmark.circle.fill" : "circle")
                                                    .foregroundColor(appState.targetStructure == structure.0 ? Color(red: 0.39, green: 0.4, blue: 0.95) : .secondary)
                                                Text(structure.1)
                                                    .font(.system(size: 13))
                                                Spacer()
                                            }
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 10)
                                            .background(appState.targetStructure == structure.0 ? Color(red: 0.39, green: 0.4, blue: 0.95).opacity(0.1) : Color.clear)
                                            .cornerRadius(8)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }

                            // BMA Module badges
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Modules Applied")
                                    .font(.system(size: 13, weight: .semibold))

                                FlowLayout(spacing: 6) {
                                    ModuleBadge(label: "Vocabulary Upgrade", color: .blue)
                                    ModuleBadge(label: "Filler Removal", color: .red)
                                    ModuleBadge(label: "Hedge Strengthening", color: .orange)
                                    ModuleBadge(label: "Action Orientation", color: .green)
                                    ModuleBadge(label: "Structure", color: .purple)
                                }
                            }

                            Button(action: {
                                Task { await appState.transform() }
                            }) {
                                HStack {
                                    Image(systemName: "sparkles")
                                    Text("Transform with BMA Modules")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(appState.transcriptText != nil ? Color(red: 0.39, green: 0.4, blue: 0.95) : Color.gray)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            .buttonStyle(.plain)
                            .disabled(appState.transcriptText == nil)
                        }
                    }
                }
                .padding(32)
            }
        }
    }
}

struct ScoreCircle: View {
    let score: Int

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.1), lineWidth: 6)
                .frame(width: 64, height: 64)

            Circle()
                .trim(from: 0, to: CGFloat(score) / 100.0)
                .stroke(
                    score >= 70 ? Color.green : (score >= 40 ? Color.orange : Color.red),
                    style: StrokeStyle(lineWidth: 6, lineCap: .round)
                )
                .frame(width: 64, height: 64)
                .rotationEffect(.degrees(-90))

            Text("\(score)")
                .font(.system(size: 18, weight: .bold))
        }
    }
}

struct ModuleBadge: View {
    let label: String
    let color: Color

    var body: some View {
        Text(label)
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.1))
            .foregroundColor(color)
            .cornerRadius(6)
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}
