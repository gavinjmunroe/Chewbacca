import SwiftUI
import Contacts

struct AddContactView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss

    @State private var name: String = ""
    @State private var role: String = ""
    @State private var email: String = ""
    @State private var phone: String = ""
    @State private var circle: NetworkCircle = .inner
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                        .autocorrectionDisabled()
                    TextField("Role", text: $role)
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    TextField("Phone", text: $phone)
                        .textContentType(.telephoneNumber)
                        .keyboardType(.phonePad)
                }
                Section("Circle") {
                    Picker("Circle", selection: $circle) {
                        ForEach(NetworkCircle.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                if let error {
                    Text(error).foregroundStyle(Color.red)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.black)
            .navigationTitle("Add Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView() } else { Text("Save").bold() }
                    }
                    .disabled(name.isEmpty || saving)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let initials = name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined().uppercased()
        let contact = NetworkContact(
            name: name,
            initials: initials,
            role: role,
            avatarColorHex: NetworkTint.blue,
            amberId: "amber:new-\(Int.random(in: 100...999))k",
            circle: circle,
            email: email.isEmpty ? nil : email,
            phone: phone.isEmpty ? nil : phone
        )
        do {
            try await services.contacts.upsert(contact)
            AmberHaptics.success()
            dismiss()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            AmberHaptics.failure()
        }
    }
}
