import SwiftUI

struct MintIdentityView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss
    @State private var ownerPubkey: String = ""
    @State private var displayName: String = ""
    @State private var birthday: Date = Calendar.current.date(byAdding: .year, value: -20, to: Date()) ?? Date()
    @State private var almaMater: String = ""
    @State private var hometown: String = ""
    @State private var minting: Bool = false
    @State private var result: MintedIdentity?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    form
                    if let identity = result {
                        successCard(identity)
                    }
                    if let error = error {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.red.opacity(0.9))
                    }
                    Button {
                        Task { await mint() }
                    } label: {
                        HStack {
                            if minting { ProgressView().tint(.black) }
                            Text(minting ? "Minting" : "Mint Amber Identity")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(Color.amberSignature))
                    }
                    .buttonStyle(.plain)
                    .disabled(minting || ownerPubkey.isEmpty || displayName.isEmpty)
                    .opacity((ownerPubkey.isEmpty || displayName.isEmpty) ? 0.5 : 1)

                    Text("Minting is idempotent. If you already have a cNFT on Solana, Amber returns the existing record instead of a second mint.")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.white.opacity(0.45))
                        .padding(.top, 4)
                }
                .padding(20)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Amber Identity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            SaturnGlyph(size: 36).frame(width: 56, height: 56)
            Text("Mint your Amber Identity")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
            Text("A Solana compressed NFT binds your profile to your own Pinecone namespace. Only you can decrypt the knowledge base keyed to this cNFT.")
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.65))
                .lineSpacing(2)
        }
    }

    private var form: some View {
        VStack(spacing: 10) {
            field("Solana wallet address", text: $ownerPubkey, icon: "wallet.pass.fill")
            field("Display name", text: $displayName, icon: "person.fill")
            datePicker
            field("Alma mater (optional)", text: $almaMater, icon: "building.columns.fill")
            field("Hometown (optional)", text: $hometown, icon: "mappin.and.ellipse")
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.amberSignature)
                .frame(width: 20)
            TextField("", text: text,
                      prompt: Text(placeholder).foregroundStyle(Color.white.opacity(0.4)))
                .foregroundStyle(.white)
                .tint(Color.amberSignature)
                .autocorrectionDisabled()
        }
        .padding(14)
        .amberSoftCard(cornerRadius: 14)
    }

    private var datePicker: some View {
        HStack {
            Image(systemName: "gift.fill")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.amberSignature)
                .frame(width: 20)
            DatePicker("Birthday", selection: $birthday, displayedComponents: .date)
                .datePickerStyle(.compact)
                .foregroundStyle(.white)
                .tint(Color.amberSignature)
        }
        .padding(14)
        .amberSoftCard(cornerRadius: 14)
    }

    private func successCard(_ identity: MintedIdentity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "checkmark.seal.fill")
                Text(identity.idempotent == true ? "Already minted" : "Minted")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(Color.amberSignature)
            if let asset = identity.assetId {
                Text("Asset ID: \(asset)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.7))
            }
            if let sig = identity.signature {
                Text("Tx: \(sig.prefix(24))")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.55))
            }
        }
        .padding(14)
        .amberGlowCard(cornerRadius: 14, glowOpacity: 0.45)
    }

    private func mint() async {
        minting = true
        defer { minting = false }
        error = nil
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let profile = MintProfile(
            displayName: displayName,
            birthday: formatter.string(from: birthday),
            birthdayTime: nil,
            birthLocation: nil,
            almaMater: almaMater.isEmpty ? nil : almaMater,
            hometown: hometown.isEmpty ? nil : hometown,
            personalityType: nil,
            personalityResult: nil
        )
        do {
            result = try await services.auth.mintIdentity(ownerPubkey: ownerPubkey, profile: profile)
            AmberHaptics.success()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            AmberHaptics.failure()
        }
    }
}
