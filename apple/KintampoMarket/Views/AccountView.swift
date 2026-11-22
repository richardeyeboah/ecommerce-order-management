import SwiftUI

struct AccountView: View {
    @Bindable private var auth = AuthStore.shared
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var showSignUp = false
    @State private var editName = ""
    @State private var editPhone = ""
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var deleteError: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            if auth.isSignedIn {
                Section("Account") {
                    Text(auth.email).font(.subheadline)
                    TextField("Full name", text: $editName)
                    TextField("Phone", text: $editPhone)
                    Button("Save profile") {
                        Task {
                            do {
                                try await auth.updateProfile(fullName: editName, phone: editPhone)
                                errorMessage = nil
                            } catch { errorMessage = error.localizedDescription }
                        }
                    }
                    .foregroundStyle(Brand.red)
                    if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(.red) }
                    Button("Sign out", role: .destructive) {
                        Task { await auth.signOut() }
                    }
                }

                Section("Your store") {
                    NavigationLink("Orders") { OrdersView() }
                    NavigationLink("Saved items") { WishlistView() }
                    NavigationLink("Addresses") { AddressesView() }
                    NavigationLink("Password") { ChangePasswordView() }
                }

                Section {
                    Button(deleting ? "Deleting account…" : "Delete account", role: .destructive) {
                        confirmDelete = true
                    }
                    .disabled(deleting)
                    .accessibilityIdentifier("deleteAccount")
                    if let deleteError {
                        Text(deleteError).font(.caption).foregroundStyle(.red)
                    }
                } footer: {
                    Text("Removes your login, saved addresses and saved items. Past orders stay in the store's records for receipts, returns and taxes.")
                }
                .alert("Delete your account?", isPresented: $confirmDelete) {
                    Button("Delete permanently", role: .destructive) {
                        Task {
                            deleting = true
                            defer { deleting = false }
                            do {
                                try await auth.deleteAccount()
                                deleteError = nil
                            } catch {
                                deleteError = error.localizedDescription
                            }
                        }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This can't be undone. \(auth.email) will be signed out and can't sign in again.")
                }
            } else {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Sign in to Kintampo")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(Brand.ink)
                        Text("Track orders, save favourites and check out faster.")
                            .font(.subheadline)
                            .foregroundStyle(Brand.inkMuted)
                    }
                    .padding(.vertical, 4)
                    if auth.hasSocialSignIn {
                        SocialSignInButtons()
                            .listRowSeparator(.hidden)
                    }
                    TextField("Email", text: Binding(
                        get: { auth.email },
                        set: { auth.email = $0 }
                    ))
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
                    SecureField("Password", text: $password)
                    Button("Sign in") {
                        Task {
                            isLoading = true
                            defer { isLoading = false }
                            do {
                                try await auth.signIn(
                                    email: auth.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                                    password: password
                                )
                                password = ""
                                errorMessage = nil
                            } catch {
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(auth.email.isEmpty || password.isEmpty || isLoading)
                    .formButtonRow()
                    Button("Create account") { showSignUp = true }
                    NavigationLink("Forgot password") { ForgotPasswordView() }
                    if let errorMessage {
                        Text(errorMessage).font(.caption).foregroundStyle(.red)
                    }
                }
            }

            Section("Browse") {
                NavigationLink("Bundles") { BundlesView() }
                NavigationLink("Recipes") { RecipesView() }
                NavigationLink("Track order") { TrackOrderView() }
                NavigationLink("Send feedback") { FeedbackView() }
            }

            Section {
                NavigationLink("FAQ") { StoreWebPage(title: "FAQ", path: "faq") }
                NavigationLink("Shipping") { StoreWebPage(title: "Shipping", path: "shipping") }
                NavigationLink("Returns") { StoreWebPage(title: "Returns", path: "returns") }
                NavigationLink("Privacy") { StoreWebPage(title: "Privacy", path: "privacy") }
                NavigationLink("Terms") { StoreWebPage(title: "Terms", path: "terms") }
            } header: {
                Text("Store info")
            } footer: {
                // Push alerts need an APNs key (paid Apple Developer account) and a server sender;
                // until then, say what actually happens instead of offering a switch that does nothing.
                Text("Order updates come by email: we write when your order is ready for pickup or ships, with tracking.")
            }

            Section("Store") {
                LabeledContent("Phone", value: StoreConfig.phone)
                LabeledContent("Email", value: StoreConfig.supportEmail)
                LabeledContent("Hours", value: StoreConfig.hours)
                Button("Open website") { openURL(AppConfig.siteURL) }
            }

            Section {
                NavigationLink {
                    StoreManagerView()
                } label: {
                    Label("Store manager", systemImage: "storefront")
                }
                .accessibilityIdentifier("storeManager")
            } header: {
                Text("For store staff")
            } footer: {
                Text("Sales, orders, stock and reviews. Uses the web admin password.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Account")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            editName = auth.profile?.fullName ?? ""
            editPhone = auth.profile?.phone ?? ""
        }
        .onChange(of: auth.profile?.fullName) { _, _ in
            editName = auth.profile?.fullName ?? ""
            editPhone = auth.profile?.phone ?? ""
        }
        .sheet(isPresented: $showSignUp) {
            NavigationStack { SignUpView() }
        }
        .task {
            await auth.loadSocialProviders()
            if auth.isSignedIn {
                await WishlistStore.shared.refresh()
            }
        }
    }
}
