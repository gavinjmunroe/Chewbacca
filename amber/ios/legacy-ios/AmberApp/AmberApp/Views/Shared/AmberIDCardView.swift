import SwiftUI
import CoreImage.CIFilterBuiltins

struct AmberIDCardView: View {
    let profile: AmberProfile
    @Environment(\.dismiss) private var dismiss
    @State private var snapshot: UIImage?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 24) {
                        cardBody
                            .drawingGroup()
                            .padding(.horizontal, 20)
                            .padding(.top, 12)

                        HStack(spacing: 10) {
                            Button {
                                AmberHaptics.select()
                                snapshot = renderCardToImage()
                            } label: {
                                Label("Save image", systemImage: "square.and.arrow.down")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(Capsule().fill(Color.white.opacity(0.06)))
                                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
                            }
                            .buttonStyle(.plain)

                            Button {
                                AmberHaptics.medium()
                                snapshot = renderCardToImage()
                            } label: {
                                Label("Share", systemImage: "square.and.arrow.up")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.black)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(Capsule().fill(Color.amberSignature))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 20)
                    }
                }
            }
            .navigationTitle("Amber ID")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .sheet(item: Binding(
                get: { snapshot.map { SnapshotWrapper(image: $0) } },
                set: { snapshot = $0?.image }
            )) { wrapper in
                ShareSheet(items: [wrapper.image])
            }
        }
        .preferredColorScheme(.dark)
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                AvatarBubble(initials: profile.initials, color: profile.avatarColor, size: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text(profile.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                    Text(profile.role)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.white.opacity(0.65))
                }
                Spacer()
                SaturnGlyph(size: 28).frame(width: 40, height: 40)
            }

            qrCode
                .frame(width: 180, height: 180)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white))
                .frame(maxWidth: .infinity, alignment: .center)

            VStack(alignment: .leading, spacing: 4) {
                Text("SCAN TO CONNECT")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(Color.amberSignature)
                Text(profile.amberId)
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white)
            }

            HStack {
                Text("\(profile.streakDays)d streak")
                Divider().frame(width: 0.5).background(Color.white.opacity(0.2)).frame(height: 14)
                Text("\(profile.mutualsCount) mutuals")
                Divider().frame(width: 0.5).background(Color.white.opacity(0.2)).frame(height: 14)
                Text(profile.freeSlotLabel + " free")
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.white.opacity(0.55))
        }
        .padding(22)
        .background(
            LinearGradient(
                colors: [Color(hex: "1A1205"), Color.black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(
                    LinearGradient(colors: [Color.amberSignature.opacity(0.65), Color.amberSignature.opacity(0.1)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    lineWidth: 1
                )
        )
        .shadow(color: Color.amberSignature.opacity(0.3), radius: 18, y: 0)
    }

    private var qrCode: some View {
        Group {
            if let image = makeQRCode(for: "https://amberorg.ai/u/\(profile.amberId)") {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.1))
            }
        }
    }

    private func makeQRCode(for string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.setValue(Data(string.utf8), forKey: "inputMessage")
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?
            .transformed(by: CGAffineTransform(scaleX: 10, y: 10)) else { return nil }
        guard let cg = context.createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    @MainActor
    private func renderCardToImage() -> UIImage {
        let renderer = ImageRenderer(content:
            cardBody
                .padding(20)
                .background(Color.black)
                .frame(width: 360)
                .preferredColorScheme(.dark)
        )
        renderer.scale = UIScreen.main.scale
        return renderer.uiImage ?? UIImage()
    }
}

private struct SnapshotWrapper: Identifiable {
    let image: UIImage
    var id: String { "\(image.hash)" }
}
