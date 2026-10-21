import SwiftUI

struct AmberEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionLabel: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Color.white.opacity(0.05)).frame(width: 64, height: 64)
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(Color.amberSignature)
            }

            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)

            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.55))
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .frame(maxWidth: 280)

            if let label = actionLabel, let action = action {
                Button(action: action) {
                    Text(label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Color.amberSignature))
                        .shadow(color: Color.amberSignature.opacity(0.4), radius: 12, y: 0)
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
                .accessibilityHint(Text(label))
            }
        }
        .padding(32)
        .accessibilityElement(children: .combine)
    }
}

struct AmberErrorState: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.red.opacity(0.12)).frame(width: 56, height: 56)
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Color(hex: "FF7B72"))
            }
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.75))
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .frame(maxWidth: 300)
            if let retry = retry {
                Button(action: retry) {
                    Text("Try again")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Color.white.opacity(0.08)))
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Retry this request"))
            }
        }
        .padding(24)
        .accessibilityElement(children: .combine)
    }
}

struct AmberOfflineBanner: View {
    let isOnline: Bool
    var body: some View {
        if isOnline { EmptyView() } else {
            HStack(spacing: 8) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 12, weight: .semibold))
                Text("Offline. Amber is showing cached data.")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.amberSignature))
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .combine)
        }
    }
}

struct AmberToast: View {
    let text: String
    var tint: Color = .amberSignature
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.black)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Capsule().fill(tint))
            .shadow(color: tint.opacity(0.4), radius: 14, y: 0)
    }
}
