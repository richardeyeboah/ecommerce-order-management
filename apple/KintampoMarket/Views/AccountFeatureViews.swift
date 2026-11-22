import SwiftUI

// MARK: - Wishlist

struct WishlistView: View {
    @Bindable private var wishlist = WishlistStore.shared
    @Bindable private var auth = AuthStore.shared

    var body: some View {
        Group {
            if !auth.isSignedIn {
                ContentUnavailableView {
                    Label("Sign in to save items", systemImage: "heart")
                } description: {
                    Text("Your saved items sync to your account, on the app and the website.")
                } actions: {
                    Button("Sign in") { AppRouter.shared.requestedTab = 4 }
                        .buttonStyle(PrimaryButtonStyle())
                        .frame(maxWidth: 220)
                }
            } else if wishlist.isLoading && wishlist.products.isEmpty {
                List { SkeletonRows(count: 5) }
            } else if wishlist.products.isEmpty {
                ContentUnavailableView("No saved items", systemImage: "heart", description: Text("Tap the heart on any product."))
            } else {
                List {
                        ForEach(wishlist.products) { product in
                            NavigationLink(value: product) {
                                HStack(spacing: 12) {
                                    CachedProductImage(url: product.primaryImageURL)
                                        .frame(width: 56, height: 56)
                                        .clipped()
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(product.name).font(.subheadline.weight(.medium)).lineLimit(2)
                                        HStack(spacing: 6) {
                                            Text(product.displayPrice).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.red)
                                            Text(product.effectiveInStock ? "In stock" : "Out of stock")
                                                .font(.caption)
                                                .foregroundStyle(product.effectiveInStock ? Brand.success : Brand.inkMuted)
                                        }
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await wishlist.toggle(product) }
                                } label: { Label("Remove", systemImage: "heart.slash") }
                            }
                            .swipeActions(edge: .leading) {
                                if product.effectiveInStock {
                                    Button {
                                        CartStore.shared.add(product)
                                    } label: { Label("Add to cart", systemImage: "cart.badge.plus") }
                                    .tint(Brand.red)
                                }
                            }
                        }
                }
            }
        }
        .navigationTitle("Saved items")
        .navigationDestination(for: Product.self) { ProductDetailView(product: $0) }
        .task { await wishlist.refresh() }
        .refreshable { await wishlist.refresh() }
    }
}

// MARK: - Addresses

struct AddressesView: View {
    @Bindable private var auth = AuthStore.shared
    @State private var addresses: [SavedAddress] = []
    @State private var errorMessage: String?
    @State private var draft = AddressDraft()
    @State private var showAdd = false
    @State private var isSaving = false
    @State private var loaded = false

    var body: some View {
        Group {
            if !auth.isSignedIn {
                ContentUnavailableView("Sign in required", systemImage: "mappin.and.ellipse", description: Text("Save addresses for faster checkout."))
            } else if loaded && addresses.isEmpty {
                ContentUnavailableView {
                    Label("No saved addresses", systemImage: "mappin.and.ellipse")
                } description: {
                    Text("Add one to autofill checkout.")
                } actions: {
                    Button("Add address") { showAdd = true }
                        .buttonStyle(PrimaryButtonStyle())
                        .frame(maxWidth: 200)
                }
            } else {
                List {
                    ForEach(addresses) { address in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(address.label?.isEmpty == false ? address.label! : "Address")
                                    .font(.subheadline.weight(.semibold))
                                if address.isDefault {
                                    Text("Default")
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Brand.gold.opacity(0.18))
                                        .foregroundStyle(Brand.gold)
                                        .clipShape(Capsule())
                                }
                            }
                            Text(address.fullName).font(.subheadline)
                            Text(address.oneLine).font(.caption).foregroundStyle(Brand.inkMuted)
                        }
                        .padding(.vertical, 2)
                        .swipeActions {
                            Button(role: .destructive) {
                                Task {
                                    try? await SupabaseService.shared.deleteAddress(id: address.id)
                                    await reload()
                                }
                            } label: { Label("Delete", systemImage: "trash") }
                        }
                    }
                }
            }
        }
        .navigationTitle("Addresses")
        .toolbar {
            if auth.isSignedIn {
                Button { showAdd = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add address")
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack {
                Form {
                    Section("Label") {
                        TextField("Home, Work…", text: $draft.label)
                    }
                    Section("Recipient") {
                        TextField("Full name", text: $draft.fullName)
                            #if os(iOS)
                            .textContentType(.name)
                            #endif
                        TextField("Phone", text: $draft.phone)
                            #if os(iOS)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            #endif
                    }
                    Section("Address") {
                        TextField("Street address", text: $draft.line1)
                            #if os(iOS)
                            .textContentType(.streetAddressLine1)
                            #endif
                        TextField("Apt / suite (optional)", text: $draft.line2)
                        TextField("City", text: $draft.city)
                            #if os(iOS)
                            .textContentType(.addressCity)
                            #endif
                        TextField("State", text: $draft.state)
                            #if os(iOS)
                            .textContentType(.addressState)
                            .textInputAutocapitalization(.characters)
                            #endif
                        TextField("ZIP", text: $draft.postalCode)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            .textContentType(.postalCode)
                            #endif
                    }
                    Section {
                        Toggle("Default address", isOn: $draft.isDefault)
                    }
                    if let errorMessage {
                        Section { Text(errorMessage).foregroundStyle(Brand.red).font(.caption) }
                    }
                }
                .navigationTitle("Add address")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAdd = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                            .disabled(isSaving || !draft.isValid)
                    }
                }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
    }

    private func reload() async {
        guard auth.isSignedIn else { return }
        addresses = (try? await SupabaseService.shared.fetchAddresses()) ?? []
        loaded = true
    }

    private func save() async {
        errorMessage = nil
        isSaving = true
        defer { isSaving = false }
        let address = SavedAddress(
            id: UUID().uuidString,
            userId: auth.userId,
            label: draft.label.trimmingCharacters(in: .whitespaces),
            fullName: draft.fullName.trimmingCharacters(in: .whitespaces),
            phone: draft.phone.trimmingCharacters(in: .whitespaces),
            line1: draft.line1.trimmingCharacters(in: .whitespaces),
            line2: draft.line2.trimmingCharacters(in: .whitespaces),
            city: draft.city.trimmingCharacters(in: .whitespaces),
            state: draft.state.trimmingCharacters(in: .whitespaces).uppercased(),
            country: "United States",
            postalCode: draft.postalCode.trimmingCharacters(in: .whitespaces),
            isDefault: draft.isDefault
        )
        do {
            try await SupabaseService.shared.saveAddress(address)
            showAdd = false
            draft = AddressDraft()
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AddressDraft {
    var label = "Home"
    var fullName = ""
    var phone = ""
    var line1 = ""
    var line2 = ""
    var city = "Columbus"
    var state = "OH"
    var postalCode = ""
    var isDefault = true

    var isValid: Bool {
        fullName.trimmingCharacters(in: .whitespaces).count >= 2
            && !line1.trimmingCharacters(in: .whitespaces).isEmpty
            && !city.trimmingCharacters(in: .whitespaces).isEmpty
            && state.trimmingCharacters(in: .whitespaces).count == 2
            && postalCode.filter(\.isNumber).count == 5
    }
}

// MARK: - Bundles

struct BundlesView: View {
    @State private var bundles: [ProductBundle] = []
    @State private var errorMessage: String?
    @State private var loaded = false

    var body: some View {
        Group {
            if let errorMessage, bundles.isEmpty {
                ContentUnavailableView("Could not load", systemImage: "shippingbox", description: Text(errorMessage))
            } else if !loaded {
                List { SkeletonRows(count: 4) }
            } else if bundles.isEmpty {
                ContentUnavailableView("No bundles yet", systemImage: "shippingbox", description: Text("Check back soon."))
            } else {
                List(bundles) { bundle in
                    NavigationLink(value: bundle) {
                        HStack(spacing: 12) {
                            CachedProductImage(url: bundle.image)
                                .frame(width: 64, height: 64)
                                .clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(bundle.name).font(.subheadline.weight(.semibold))
                                if let desc = bundle.description, !desc.isEmpty {
                                    Text(desc).font(.caption).foregroundStyle(Brand.inkMuted).lineLimit(2)
                                }
                                if bundle.discountPercent > 0 {
                                    Text("Save \(Int(bundle.discountPercent))%")
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Brand.gold.opacity(0.18))
                                        .foregroundStyle(Brand.gold)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .navigationTitle("Bundles")
        .navigationDestination(for: ProductBundle.self) { BundleDetailView(bundle: $0) }
        .navigationDestination(for: Product.self) { ProductDetailView(product: $0) }
        .task {
            do { bundles = try await SupabaseService.shared.fetchBundles() }
            catch { errorMessage = error.localizedDescription }
            loaded = true
        }
    }
}

struct BundleDetailView: View {
    let bundle: ProductBundle
    @State private var products: [(Product, Int)] = []
    @State private var added = false
    @State private var loaded = false

    private var listTotal: Double { products.reduce(0) { $0 + $1.0.price * Double($1.1) } }
    private var discounted: Double { listTotal * (1 - bundle.discountPercent / 100) }
    private var allAvailable: Bool { !products.isEmpty && products.allSatisfy { $0.0.effectiveInStock } }

    var body: some View {
        List {
            if bundle.image != nil {
                Section {
                    CachedProductImage(url: bundle.image)
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .clipped()
                        .listRowInsets(EdgeInsets())
                }
            }
            if let desc = bundle.description, !desc.isEmpty {
                Section { Text(desc).font(.body).foregroundStyle(Brand.inkMuted) }
            }
            Section("Includes") {
                if !loaded {
                    SkeletonRows(count: 3)
                } else if products.isEmpty {
                    Text("No items in this bundle yet.").foregroundStyle(Brand.inkMuted)
                }
                ForEach(products, id: \.0.id) { product, qty in
                    NavigationLink(value: product) {
                        HStack(spacing: 12) {
                            CachedProductImage(url: product.primaryImageURL)
                                .frame(width: 44, height: 44)
                                .clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(product.name).font(.subheadline).lineLimit(2)
                                Text("Qty \(qty)\(product.effectiveInStock ? "" : " · Out of stock")")
                                    .font(.caption)
                                    .foregroundStyle(product.effectiveInStock ? Brand.inkMuted : Brand.red)
                            }
                            Spacer()
                            Text(String(format: "$%.2f", product.price * Double(qty)))
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                        }
                    }
                }
            }
            if !products.isEmpty {
                Section {
                    LabeledContent("Items total") {
                        Text(String(format: "$%.2f", listTotal)).monospacedDigit()
                    }
                    if bundle.discountPercent > 0 {
                        LabeledContent("Bundle price") {
                            Text(String(format: "$%.2f", discounted))
                                .fontWeight(.semibold).foregroundStyle(Brand.red).monospacedDigit()
                        }
                        Text("Bundle discount is applied at checkout.")
                            .font(.caption).foregroundStyle(Brand.inkMuted)
                    }
                }
                Section {
                    Button {
                        for (product, qty) in products where product.effectiveInStock {
                            CartStore.shared.add(product, quantity: qty)
                        }
                        added = true
                        Task {
                            try? await Task.sleep(nanoseconds: 1_500_000_000)
                            added = false
                        }
                    } label: {
                        Label(added ? "Added to cart" : (allAvailable ? "Add bundle to cart" : "Add available items"),
                              systemImage: added ? "checkmark" : "cart.badge.plus")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(products.isEmpty || !products.contains { $0.0.effectiveInStock })
                    .formButtonRow()
                }
            }
        }
        .navigationTitle(bundle.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            let rows = (try? await SupabaseService.shared.fetchBundleItems(bundleID: bundle.id)) ?? []
            let ids = rows.map(\.productId)
            let fetched = (try? await SupabaseService.shared.fetchProductsByIDs(ids)) ?? []
            let map = Dictionary(fetched.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            products = rows.compactMap { row in
                guard let p = map[row.productId], !StorefrontCatalog.isHidden(p) else { return nil }
                return (p, row.quantity)
            }
            loaded = true
        }
    }
}

// MARK: - Orders

struct OrdersView: View {
    @Bindable private var auth = AuthStore.shared
    @State private var orders: [TrackedOrder] = []
    @State private var loadError: String?
    @State private var loaded = false
    @State private var hasMore = false
    @State private var loadingMore = false

    var body: some View {
        Group {
            if !auth.isSignedIn {
                ContentUnavailableView("Sign in to see orders", systemImage: "list.bullet.rectangle", description: Text("Or use Track order with your order number."))
            } else if let loadError {
                ContentUnavailableView {
                    Label("Could not load orders", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { Task { await reload() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(maxWidth: 160)
                }
            } else if !loaded {
                List { SkeletonRows(count: 6, showsImage: false) }
            } else if orders.isEmpty {
                ContentUnavailableView("No orders yet", systemImage: "list.bullet.rectangle", description: Text("Your orders appear here after checkout."))
            } else {
                List {
                    ForEach(orders, id: \.id) { order in
                        NavigationLink {
                            OrderDetailView(order: order)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(order.displayNumber).font(.subheadline.weight(.semibold))
                                    Text(OrderStatusStyle.dateLabel(order.createdAt))
                                        .font(.caption).foregroundStyle(Brand.inkMuted)
                                    OrderStatusBadge(status: order.status)
                                }
                                Spacer()
                                if let total = order.totalAmount {
                                    Text(String(format: "$%.2f", total))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Brand.ink)
                                        .monospacedDigit()
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .onAppear {
                            if order.id == orders.last?.id { Task { await loadMore() } }
                        }
                    }
                    if hasMore {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                Spacer()
                                Text(loadingMore ? "Loading…" : "Show older orders")
                                Spacer()
                            }
                            .frame(minHeight: 44)
                        }
                        .disabled(loadingMore)
                        .accessibilityIdentifier("ordersLoadMore")
                    }
                }
            }
        }
        .navigationTitle("Orders")
        .task { await reload() }
        .refreshable { await reload() }
    }

    private func reload() async {
        loadError = nil
        do {
            guard try await auth.validAccessToken() != nil else { orders = []; loaded = true; return }
            let page = try await SupabaseService.shared.fetchMyOrders()
            orders = page.orders
            hasMore = page.hasMore
        } catch { loadError = error.localizedDescription }
        loaded = true
    }

    private func loadMore() async {
        guard hasMore, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let page = try? await SupabaseService.shared.fetchMyOrders(offset: orders.count) else { return }
        let seen = Set(orders.map(\.id))
        orders += page.orders.filter { !seen.contains($0.id) }
        hasMore = page.hasMore
    }
}

enum OrderStatusStyle {
    static func color(for status: String) -> Color {
        switch status.lowercased() {
        case "delivered", "picked_up", "completed", "complete": return Brand.success
        case "shipped", "out_for_delivery", "ready_for_pickup", "ready": return Brand.gold
        case "cancelled", "canceled", "refunded", "failed": return Brand.inkMuted
        default: return Brand.red
        }
    }

    static func label(_ status: String) -> String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func dateLabel(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? {
            parser.formatOptions = [.withInternetDateTime]
            return parser.date(from: iso)
        }()
        guard let date else { return iso.prefix(10).description }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

struct OrderStatusBadge: View {
    let status: String
    var body: some View {
        let color = OrderStatusStyle.color(for: status)
        Text(OrderStatusStyle.label(status))
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

// MARK: - Sign up

struct SignUpView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable private var auth = AuthStore.shared
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var termsAccepted = false

    private var passwordStrong: Bool {
        password.count >= 8
            && password.contains(where: \.isUppercase)
            && password.contains(where: \.isLowercase)
            && password.contains(where: \.isNumber)
            && password.contains(where: { !$0.isLetter && !$0.isNumber })
    }
    private var emailValid: Bool {
        let t = email.trimmingCharacters(in: .whitespaces)
        let parts = t.split(separator: "@")
        return parts.count == 2 && parts[1].contains(".")
    }
    private var canSubmit: Bool {
        !isLoading && termsAccepted && emailValid && passwordStrong
            && !firstName.trimmingCharacters(in: .whitespaces).isEmpty
            && !lastName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        Form {
            if auth.hasSocialSignIn {
                Section {
                    SocialSignInButtons(onSignedIn: { dismiss() })
                } header: {
                    Text("Quick sign-up")
                }
            }
            Section("Name") {
                TextField("First name", text: $firstName)
                    #if os(iOS)
                    .textContentType(.givenName)
                    .textInputAutocapitalization(.words)
                    #endif
                TextField("Last name", text: $lastName)
                    #if os(iOS)
                    .textContentType(.familyName)
                    .textInputAutocapitalization(.words)
                    #endif
            }
            Section("Contact") {
                TextField("Email", text: $email)
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                TextField("Phone (optional)", text: $phone)
                    #if os(iOS)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    #endif
            }
            Section {
                SecureField("Password", text: $password)
                    #if os(iOS)
                    .textContentType(.newPassword)
                    #endif
                PasswordRules(password: password)
            } header: {
                Text("Password")
            }
            Section {
                Toggle("I agree to the Terms and Privacy Policy", isOn: $termsAccepted)
                    .tint(Brand.red)
                HStack(spacing: 16) {
                    Link("Terms", destination: AppConfig.siteURL.appending(path: "terms"))
                    Link("Privacy Policy", destination: AppConfig.siteURL.appending(path: "privacy"))
                }
                .font(.caption)
                .foregroundStyle(Brand.red)
            }
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                        .foregroundStyle(Brand.red).font(.caption)
                }
            }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        if isLoading { ProgressView().tint(.white) }
                        Text(isLoading ? "Creating…" : "Create account")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
                .formButtonRow()
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Create account")
        .task { await auth.loadSocialProviders() }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        }
    }

    private func submit() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            try await AuthStore.shared.signUp(
                email: email.trimmingCharacters(in: .whitespaces),
                password: password,
                firstName: firstName.trimmingCharacters(in: .whitespaces),
                lastName: lastName.trimmingCharacters(in: .whitespaces),
                phone: phone.trimmingCharacters(in: .whitespaces)
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PasswordRules: View {
    let password: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            rule("8+ characters", password.count >= 8)
            rule("Upper and lower case", password.contains(where: \.isUppercase) && password.contains(where: \.isLowercase))
            rule("A number", password.contains(where: \.isNumber))
            rule("A symbol", password.contains(where: { !$0.isLetter && !$0.isNumber }))
        }
        .font(.caption)
    }

    private func rule(_ text: String, _ ok: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: ok ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(ok ? Brand.success : Brand.inkMuted)
            Text(text).foregroundStyle(ok ? Brand.ink : Brand.inkMuted)
        }
    }
}
