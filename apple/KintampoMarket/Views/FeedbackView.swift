import SwiftUI

/// Native form for `/api/feedback` — same validation as the web feedback page.
struct FeedbackView: View {
    private static let categories = [
        ("suggestion", "Suggestion"),
        ("product", "Product request"),
        ("bug", "Something is broken"),
        ("other", "Other"),
    ]

    @Bindable private var auth = AuthStore.shared
    @State private var name = ""
    @State private var email = ""
    @State private var category = "suggestion"
    @State private var message = ""
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var sent = false

    private var trimmedMessage: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var emailLooksValid: Bool {
        let value = email.trimmingCharacters(in: .whitespaces)
        return value.contains("@") && value.split(separator: "@").last?.contains(".") == true && !value.contains(" ")
    }

    var body: some View {
        Form {
            if sent {
                Section {
                    Label("Thanks! The store team will read this.", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Brand.success)
                    Button("Send another") {
                        message = ""
                        sent = false
                    }
                }
            } else {
                Section("About you") {
                    TextField("Name (optional)", text: $name)
                    TextField("Email", text: $email)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                }
                Section {
                    Picker("Topic", selection: $category) {
                        ForEach(Self.categories, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    TextField("Tell us what you think", text: $message, axis: .vertical)
                        .lineLimit(4...10)
                } header: {
                    Text("Feedback")
                } footer: {
                    Text("\(trimmedMessage.count)/2000 · at least 10 characters")
                }
                Section {
                    Button(sending ? "Sending…" : "Send feedback") { Task { await send() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(sending || !emailLooksValid || trimmedMessage.count < 10 || trimmedMessage.count > 2000)
                        .formButtonRow()
                    if let errorMessage {
                        Text(errorMessage).font(.caption).foregroundStyle(.red)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Feedback")
        .onAppear {
            if email.isEmpty { email = auth.email }
            if name.isEmpty { name = auth.profile?.fullName ?? "" }
        }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            try await APIClient.shared.sendFeedback(
                name: name.trimmingCharacters(in: .whitespaces),
                email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                category: category,
                message: trimmedMessage
            )
            errorMessage = nil
            sent = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
