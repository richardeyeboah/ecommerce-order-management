import SwiftUI

/// Staff accounts: who can sign in to Kintampo Manager and the web dashboard.
/// Everyone can see the list; the owner (store password) and admins can add and remove people.
struct StaffView: View {
    @State private var staff: [StaffMember] = []
    @State private var canManage = false
    @State private var loaded = false
    @State private var loadError: String?
    @State private var newEmail = ""
    @State private var adding = false
    @State private var actionError: String?
    @State private var notice: String?
    @State private var pendingRemove: StaffMember?

    private var me: StaffIdentity? { AdminStore.shared.identity }

    var body: some View {
        List {
            if canManage {
                Section {
                    TextField("Their email", text: $newEmail)
                        .textContentType(.emailAddress)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .onSubmit { Task { await add() } }
                        .accessibilityIdentifier("staffAddEmail")
                    Button(adding ? "Adding…" : "Add staff") { Task { await add() } }
                        .disabled(adding || !newEmail.contains("@"))
                } header: {
                    Text("Add someone")
                } footer: {
                    Text("They need a store account with this email first (sign up in the Kintampo app or on the website). Then they sign in here with \u{201C}My account\u{201D}.")
                }
            }

            if let notice {
                Section { Label(notice, systemImage: "checkmark.circle.fill").foregroundStyle(Brand.success) }
            }

            if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                }
            } else if !loaded {
                Section { SkeletonRows(count: 3, showsImage: false) }
            } else if staff.isEmpty {
                ContentUnavailableView(
                    "No staff accounts yet",
                    systemImage: "person.2",
                    description: Text("Everyone is using the store password. Add staff so the order history shows who did what.")
                )
            } else {
                Section {
                    ForEach(staff) { member in
                        StaffRow(member: member, isMe: member.email != nil && member.email == me?.email)
                            .swipeActions(edge: .trailing) {
                                if canManage, member.role == "staff", member.email != me?.email {
                                    Button("Remove") { pendingRemove = member }.tint(Brand.red)
                                }
                            }
                    }
                } header: {
                    Text("\(staff.count) with access")
                } footer: {
                    if canManage { Text("Swipe left to remove someone. They keep their customer account.") }
                }
            }
        }
        .navigationTitle("Staff")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            "Remove staff access?",
            isPresented: Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } }),
            titleVisibility: .visible,
            presenting: pendingRemove
        ) { member in
            Button("Remove \(member.displayName)", role: .destructive) { Task { await remove(member) } }
            Button("Cancel", role: .cancel) {}
        } message: { member in
            Text("\(member.displayName) is signed out of Kintampo Manager and the dashboard right away.")
        }
        .alert("Couldn't update staff", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private func load() async {
        do {
            let list = try await AdminAPI.shared.staff()
            staff = list.staff
            canManage = list.canManageStaff ?? false
            loadError = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
        loaded = true
    }

    private func add() async {
        let email = newEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard email.contains("@"), !adding else { return }
        adding = true
        defer { adding = false }
        do {
            staff = try await AdminAPI.shared.addStaff(email: email)
            notice = "\(email) can now sign in with their own password."
            newEmail = ""
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func remove(_ member: StaffMember) async {
        do {
            staff = try await AdminAPI.shared.removeStaff(id: member.id)
            notice = "\(member.displayName) no longer has staff access."
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            actionError = error.localizedDescription
        }
    }
}

private struct StaffRow: View {
    let member: StaffMember
    let isMe: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(initials)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(member.role == "admin" ? Brand.forest : Brand.inkMuted, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.displayName + (isMe ? " (you)" : ""))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Brand.ink)
                if let email = member.email, member.name != nil {
                    Text(email).font(.caption).foregroundStyle(Brand.inkMuted)
                }
            }
            Spacer()
            Text(member.role == "admin" ? "Admin" : "Staff")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background((member.role == "admin" ? Brand.forest : Brand.inkMuted).opacity(0.12), in: Capsule())
                .foregroundStyle(member.role == "admin" ? Brand.forest : Brand.inkMuted)
        }
        .accessibilityElement(children: .combine)
    }

    private var initials: String {
        let parts = member.displayName.split(whereSeparator: { $0 == " " || $0 == "@" || $0 == "." })
        return parts.prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}
