import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss

    @State private var appLockOn: Bool = false
    @State private var prefs = NotificationPreferences()
    @State private var showDeleteConfirm = false
    @State private var showMintSheet = false

    private let privacyPolicyURL = URL(string: "https://amberorg.ai/privacy")!
    private let termsURL = URL(string: "https://amberorg.ai/terms")!
    private let supportURL = URL(string: "https://amberorg.ai/support")!

    var body: some View {
        NavigationStack {
            Form {
                Section("Amber Identity") {
                    LabeledContent("Amber ID", value: (try? amberId()) ?? "amber:—")
                        .foregroundStyle(.white)
                    if services.auth.hasMintedIdentity {
                        Label("cNFT minted on Solana", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(Color.amberSignature)
                    } else {
                        Button("Mint Amber Identity") { showMintSheet = true }
                    }
                }

                Section("Security") {
                    Toggle("Require Face ID to open Amber", isOn: $appLockOn)
                        .onChange(of: appLockOn) { _, new in
                            Task {
                                try? await services.auth.setAppLockEnabled(new)
                                AmberHaptics.select()
                            }
                        }
                    NavigationLink("Backup and export", destination: DataExportFlow())
                    NavigationLink("Audit log", destination: AuditLogView())
                }

                Section("Notifications") {
                    Toggle("Warm intros", isOn: $prefs.intros)
                    Toggle("Reminders", isOn: $prefs.reminders)
                    Toggle("Memories", isOn: $prefs.memories)
                    Toggle("Events", isOn: $prefs.events)
                }
                .onChange(of: prefs) { _, new in services.notifications.preferences = new }

                Section("Integrations") {
                    NavigationLink("Manage connected apps", destination: IntegrationsManagerView())
                    NavigationLink("Review permissions", destination: PermissionPrimingView())
                }

                Section("About") {
                    Link("Privacy policy", destination: privacyPolicyURL)
                    Link("Terms of service", destination: termsURL)
                    Link("Support", destination: supportURL)
                    LabeledContent("Version", value: versionString)
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        Task {
                            try? await services.auth.signOut()
                            dismiss()
                        }
                    }
                    Button("Delete account", role: .destructive) { showDeleteConfirm = true }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.black)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            .task {
                appLockOn = services.auth.appLockEnabled
                prefs = services.notifications.preferences
            }
            .sheet(isPresented: $showMintSheet) {
                MintIdentityView().environmentObject(services)
            }
            .alert("Delete account?", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task {
                        try? await services.auth.deleteAccount()
                        dismiss()
                    }
                }
            } message: {
                Text("This permanently removes your graph, memories, and cNFT references from Amber.")
            }
        }
        .preferredColorScheme(.dark)
    }

    private func amberId() throws -> String { "amber:matthew-31k" }

    private var versionString: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "\(v) (\(b))"
    }
}

struct IntegrationsManagerView: View {
    @EnvironmentObject private var services: AmberServices
    @State private var apps: [ConnectedApp] = []
    @State private var busy: Set<ConnectedApp.Provider> = []

    var body: some View {
        List(apps) { app in
            HStack(spacing: 12) {
                Image(systemName: app.systemIcon).foregroundStyle(app.tint).frame(width: 30)
                Text(app.name).foregroundStyle(.white)
                Spacer()
                if busy.contains(app.provider) {
                    ProgressView().tint(Color.amberSignature)
                } else {
                    Toggle("", isOn: Binding(
                        get: { app.isConnected },
                        set: { new in Task { await toggle(app, connect: new) } }
                    )).labelsHidden().tint(Color.amberSignature)
                }
            }
            .listRowBackground(Color.clear)
        }
        .scrollContentBackground(.hidden)
        .background(Color.black)
        .navigationTitle("Integrations")
        .task { await load() }
    }

    private func load() async {
        do { apps = try await services.integrations.list() }
        catch { services.crash.record(error, context: ["op": "integrations.list"]) }
    }

    private func toggle(_ app: ConnectedApp, connect: Bool) async {
        busy.insert(app.provider)
        defer { busy.remove(app.provider) }
        if connect {
            do {
                let session = try await services.integrations.connect(app.provider)
                await UIApplication.shared.open(session.authorizeURL)
            } catch {}
        } else {
            try? await services.integrations.disconnect(app.provider)
        }
        await load()
    }
}

struct DataExportView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Export your data")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
            Text("Download every contact, memory, and ingested signal as a signed JSON archive. You can import it into any compliant Amber client.")
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.65))
                .lineSpacing(3)
            Button {
                AmberHaptics.select()
            } label: {
                Text("Request export")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Capsule().fill(Color.amberSignature))
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(20)
        .background(Color.black.ignoresSafeArea())
        .navigationTitle("Export")
    }
}
