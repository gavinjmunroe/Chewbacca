import SwiftUI

struct EditContactView: View {
    @EnvironmentObject private var services: AmberServices
    @Environment(\.dismiss) private var dismiss
    let original: NetworkContact

    @State private var name: String
    @State private var role: String
    @State private var email: String
    @State private var phone: String
    @State private var circle: NetworkCircle
    @State private var busy = false
    @State private var confirmDelete = false

    init(contact: NetworkContact) {
        self.original = contact
        _name = State(initialValue: contact.name)
        _role = State(initialValue: contact.role)
        _email = State(initialValue: contact.email ?? "")
        _phone = State(initialValue: contact.phone ?? "")
        _circle = State(initialValue: contact.circle)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name).textContentType(.name)
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

                Section {
                    Button("Delete contact", role: .destructive) { confirmDelete = true }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.black)
            .navigationTitle("Edit Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if busy { ProgressView() } else { Text("Save").bold() }
                    }
                    .disabled(name.isEmpty || busy)
                }
            }
            .confirmationDialog("Delete \(original.name)?",
                                isPresented: $confirmDelete,
                                titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    Task {
                        try? await services.contacts.delete(id: original.id)
                        AmberHaptics.warning()
                        dismiss()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes them from your Inner Circle. Ingestion records are retained for audit unless you also request a data purge.")
            }
        }
        .preferredColorScheme(.dark)
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let updated = NetworkContact(
            id: original.id,
            name: name,
            initials: name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined().uppercased(),
            role: role,
            avatarColorHex: original.avatarColorHex,
            mutualCount: original.mutualCount,
            warmPath: original.warmPath,
            tags: original.tags,
            amberId: original.amberId,
            note: original.note,
            circle: circle,
            email: email.isEmpty ? nil : email,
            phone: phone.isEmpty ? nil : phone,
            lastContactedAt: original.lastContactedAt
        )
        do {
            try await services.contacts.upsert(updated)
            AmberHaptics.success()
            dismiss()
        } catch {
            AmberHaptics.failure()
        }
    }
}
