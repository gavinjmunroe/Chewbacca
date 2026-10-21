import SwiftUI
import Contacts
import UserNotifications
import EventKit
import Photos
import HealthKit

struct PermissionPrimingView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss
    @State private var statuses: [AmberPermission: PermissionStatus] = [:]
    @State private var busy: AmberPermission?
    var onComplete: () -> Void = {}

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    VStack(spacing: 10) {
                        ForEach(AmberPermission.allCases, id: \.self) { permission in
                            permissionRow(permission)
                        }
                    }
                    Button {
                        AmberHaptics.success()
                        onComplete()
                        dismiss()
                    } label: {
                        Text("Done")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Capsule().fill(Color.amberSignature))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 8)
                }
                .padding(20)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Amber needs a few permissions")
            .navigationBarTitleDisplayMode(.inline)
            .task { await refreshAll() }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("The more you connect, the better Amber's answers.")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
            Text("Every permission stays on this device unless you explicitly upload. You can change your mind in Settings anytime.")
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.6))
                .lineSpacing(2)
        }
        .padding(.bottom, 8)
    }

    private func permissionRow(_ permission: AmberPermission) -> some View {
        let status = statuses[permission] ?? .undetermined
        return Button {
            Task { await request(permission) }
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(permission.color.opacity(0.15))
                        .frame(width: 44, height: 44)
                    Image(systemName: permission.icon)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(permission.color)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(permission.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(permission.rationale)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .lineSpacing(2)
                }
                Spacer()
                statusIndicator(status, busy: busy == permission)
            }
            .padding(14)
            .amberSoftCard(cornerRadius: 16)
        }
        .buttonStyle(.plain)
        .disabled(status == .authorized)
        .accessibilityHint(Text("Grant \(permission.title)"))
    }

    private func statusIndicator(_ status: PermissionStatus, busy: Bool) -> some View {
        Group {
            if busy {
                ProgressView().tint(Color.amberSignature)
            } else {
                switch status {
                case .authorized:
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.amberSignature)
                case .denied:
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.red.opacity(0.8))
                case .undetermined:
                    Image(systemName: "chevron.right").foregroundStyle(Color.white.opacity(0.4))
                }
            }
        }
    }

    private func refreshAll() async {
        for permission in AmberPermission.allCases {
            statuses[permission] = await permission.status()
        }
    }

    private func request(_ permission: AmberPermission) async {
        busy = permission
        defer { busy = nil }
        AmberHaptics.select()
        let granted = await permission.request()
        statuses[permission] = granted ? .authorized : .denied
        AmberHaptics.light()
    }
}

enum AmberPermission: CaseIterable {
    case contacts, notifications, calendar, photos, health

    var title: String {
        switch self {
        case .contacts:      return "Contacts"
        case .notifications: return "Notifications"
        case .calendar:      return "Calendar"
        case .photos:        return "Photos"
        case .health:        return "Apple Health"
        }
    }

    var rationale: String {
        switch self {
        case .contacts:      return "So Amber can map your real network and spot warm intros."
        case .notifications: return "So Amber can nudge you about check-ins and free windows."
        case .calendar:      return "So Amber knows who you met and when you're free."
        case .photos:        return "So Amber can surface shared memories with your people."
        case .health:        return "So Amber's daily reflections tie to your actual health data."
        }
    }

    var icon: String {
        switch self {
        case .contacts:      return "person.crop.circle"
        case .notifications: return "bell.badge"
        case .calendar:      return "calendar"
        case .photos:        return "photo.on.rectangle"
        case .health:        return "heart.fill"
        }
    }

    var color: Color {
        switch self {
        case .contacts:      return .tintBlue
        case .notifications: return .amberSignature
        case .calendar:      return .tintGreen
        case .photos:        return .tintPink
        case .health:        return Color(hex: "FF6B6B")
        }
    }

    func status() async -> PermissionStatus {
        switch self {
        case .contacts:
            switch CNContactStore.authorizationStatus(for: .contacts) {
            case .authorized: return .authorized
            case .denied, .restricted: return .denied
            default: return .undetermined
            }
        case .notifications:
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: return .authorized
            case .denied: return .denied
            default: return .undetermined
            }
        case .calendar:
            switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess, .authorized: return .authorized
            case .denied, .restricted: return .denied
            default: return .undetermined
            }
        case .photos:
            switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
            case .authorized, .limited: return .authorized
            case .denied, .restricted: return .denied
            default: return .undetermined
            }
        case .health:
            return HKHealthStore.isHealthDataAvailable() ? .undetermined : .denied
        }
    }

    func request() async -> Bool {
        switch self {
        case .contacts:
            return (try? await CNContactStore().requestAccess(for: .contacts)) ?? false
        case .notifications:
            return (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge, .provisional])) ?? false
        case .calendar:
            return (try? await EKEventStore().requestFullAccessToEvents()) ?? false
        case .photos:
            let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
            return status == .authorized || status == .limited
        case .health:
            return true
        }
    }
}

enum PermissionStatus { case authorized, denied, undetermined }
