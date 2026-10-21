import SwiftUI

struct ContactDetailView: View {
    @EnvironmentObject private var services: AmberServices
    let contact: NetworkContact
    @State private var warmPath: [NetworkContact] = []
    @State private var showIntroDraft = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                heroCard
                warmPathCard
                actionsRow
                notesCard
                Spacer().frame(height: 120)
            }
            .padding(.horizontal, 16)
        }
        .background(Color.black.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { warmPath = try await services.graph.warmPath(to: contact.id) }
            catch { services.crash.record(error, context: ["op": "warmPath"]) }
        }
        .sheet(isPresented: $showIntroDraft) {
            IntroDraftView(target: contact, path: warmPath)
                .environmentObject(services)
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                AvatarBubble(initials: contact.initials, color: contact.avatarColor, size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    Text(contact.name).font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                    Text(contact.role).font(.system(size: 13)).foregroundStyle(Color.white.opacity(0.6))
                    Text(contact.amberId)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.45))
                }
                Spacer()
            }
            if !contact.tags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(contact.tags, id: \.self) { tag in
                        Text(tag.text)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(tag.tint)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Capsule().fill(tag.tint.opacity(0.14)))
                    }
                }
            }
        }
        .padding(18)
        .amberGlowCard(cornerRadius: 22, glowOpacity: 0.45, fillOpacity: 0.03)
    }

    private var warmPathCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SaturnGlyph(size: 14)
                Text("WARM PATH").font(.system(size: 11, weight: .semibold)).tracking(1.1).foregroundStyle(Color.amberSignature)
            }

            if warmPath.isEmpty {
                AmberSkeleton(cornerRadius: 10).frame(height: 44)
            } else {
                HStack(spacing: 10) {
                    ForEach(Array(warmPath.enumerated()), id: \.element.id) { idx, node in
                        HStack(spacing: 6) {
                            AvatarBubble(initials: node.initials, color: node.avatarColor, size: 30)
                            Text(node.name.components(separatedBy: " ").first ?? node.name)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        if idx < warmPath.count - 1 {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.amberSignature)
                        }
                    }
                }
            }

            Text("\(contact.mutualCount) mutual connections across the graph.")
                .font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.55))
        }
        .padding(16)
        .amberSoftCard(cornerRadius: 20)
    }

    private var actionsRow: some View {
        HStack(spacing: 10) {
            Button {
                AmberHaptics.medium()
                showIntroDraft = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "paperplane.fill")
                    Text("Ask for Intro").font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Capsule().fill(Color.amberSignature))
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("Draft a warm intro request"))

            Button {
                AmberHaptics.select()
            } label: {
                Image(systemName: "message")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 44)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Message"))
        }
    }

    private var notesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("NOTES").font(.system(size: 11, weight: .semibold)).tracking(1.1).foregroundStyle(Color.white.opacity(0.45))
                Spacer()
                Button {} label: {
                    Image(systemName: "plus").font(.system(size: 11, weight: .bold)).foregroundStyle(Color.amberSignature)
                }
                .accessibilityLabel(Text("Add note"))
            }
            if let note = contact.note, !note.isEmpty {
                Text(note).font(.system(size: 13)).foregroundStyle(Color.white.opacity(0.8))
            } else {
                AmberEmptyState(
                    icon: "square.and.pencil",
                    title: "No notes yet",
                    message: "Add a note and Amber will factor it into future answers."
                )
            }
        }
        .padding(16)
        .amberSoftCard(cornerRadius: 20)
    }
}

struct IntroDraftView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss
    let target: NetworkContact
    let path: [NetworkContact]
    @State private var draft: String = ""
    @State private var sending = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Draft to \(path.first?.name ?? "the bridge contact")")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)

                TextEditor(text: $draft)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.04)))
                    .frame(minHeight: 180)
                    .foregroundStyle(.white)
                    .accessibilityLabel(Text("Intro message"))

                Button {
                    sending = true
                    Task {
                        AmberHaptics.success()
                        sending = false
                        dismiss()
                    }
                } label: {
                    HStack {
                        if sending { ProgressView().tint(.black) }
                        Text(sending ? "Sending" : "Send to \((path.first?.name.components(separatedBy: " ").first) ?? "bridge")")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Capsule().fill(Color.amberSignature))
                }
                .buttonStyle(.plain)
                .disabled(draft.isEmpty || sending)
                .opacity(draft.isEmpty ? 0.5 : 1)

                Spacer()
            }
            .padding(20)
            .background(Color.black.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                draft = "Hey \(path.first?.name.components(separatedBy: " ").first ?? "friend"), I'd love an intro to \(target.name) about \(target.tags.first?.text ?? "what we've been building"). Happy to send a forwardable if helpful."
            }
        }
    }
}
