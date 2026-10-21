import SwiftUI
import UniformTypeIdentifiers

/// Builds a signed JSON export of the user's graph, memories, and settings.
/// Writes to a temp URL and presents iOS ShareSheet so the user can save to
/// iCloud Drive, AirDrop, or email.
struct DataExportFlow: View {
    @EnvironmentObject private var services: AmberServices
    @State private var exportURL: URL?
    @State private var building = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            if let error = error {
                Text(error).foregroundStyle(Color.red.opacity(0.9)).font(.system(size: 12))
            }
            Button {
                Task { await build() }
            } label: {
                HStack {
                    if building { ProgressView().tint(.black) }
                    Text(building ? "Preparing" : "Build export")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Capsule().fill(Color.amberSignature))
            }
            .buttonStyle(.plain)
            .disabled(building)
            Spacer()
        }
        .padding(20)
        .background(Color.black.ignoresSafeArea())
        .navigationTitle("Export")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: Binding(
            get: { exportURL.map { URLWrapper(url: $0) } },
            set: { exportURL = $0?.url }
        )) { wrapper in
            ShareSheet(items: [wrapper.url])
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Export everything Amber has learned about your network.")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
            Text("You get a signed JSON archive. You can re-import it into any compliant Amber client, or share with your own tools.")
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.6))
                .lineSpacing(2)
        }
    }

    private func build() async {
        building = true
        defer { building = false }
        do {
            let contacts = try await services.contacts.fetch(circle: .all, query: "")
            let memories = try await services.profile.memories(limit: 1000)
            let profile = try await services.profile.current()

            struct Export: Codable {
                let exportedAt: String
                let profile: AmberProfile
                let contacts: [NetworkContact]
                let memories: [NetworkMemory]
            }
            let export = Export(
                exportedAt: ISO8601DateFormatter().string(from: Date()),
                profile: profile, contacts: contacts, memories: memories
            )
            let data = try JSONEncoder().encode(export)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("amber-export-\(Int(Date().timeIntervalSince1970)).json")
            try data.write(to: url, options: .atomic)
            exportURL = url
            AmberHaptics.success()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            AmberHaptics.failure()
        }
    }
}

private struct URLWrapper: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
