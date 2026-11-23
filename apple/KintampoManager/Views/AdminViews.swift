import SwiftUI
#if os(iOS)
import UIKit
#endif

// MARK: - Store manager: orders queue

/// Staff-facing order management — same data and rules as the web `/admin/orders` dashboard.
struct AdminOrdersView: View {
    var initialStatus: String? = nil
    var initialQueue: AdminQueue? = nil
    @Bindable private var admin = AdminStore.shared

    var body: some View {
        Group {
            if !admin.checked {
                List { SkeletonRows(count: 6, showsImage: false) }
            } else if admin.isSignedIn {
                AdminOrderQueue(status: initialStatus, queue: initialQueue ?? (initialStatus == nil ? .needsAction : .all))
            } else {
                AdminSignInView()
            }
        }
        .navigationTitle("Manage orders")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await admin.restore() }
    }
}

struct AdminSignInView: View {
    enum Method: String, CaseIterable, Identifiable {
        case account, storePassword
        var id: String { rawValue }
        var label: String { self == .account ? "My account" : "Store password" }
    }

    @AppStorage("manager.signInMethod") private var method: Method = .account
    @AppStorage("manager.lastEmail") private var email = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        Form {
            Section {
                VStack(spacing: 12) {
                    Image("LogoMark")
                        .resizable()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .shadow(color: Brand.cardShadow, radius: 6, y: 2)
                        .accessibilityHidden(true)
                    Text("Store manager")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Brand.ink)
                    Text("Orders, labels, stock, payments and reviews for Kintampo staff.")
                        .font(.subheadline)
                        .foregroundStyle(Brand.inkMuted)
                        .multilineTextAlignment(.center)
                    HStack(spacing: 14) {
                        ForEach([("tray.full", "Orders"), ("printer", "Labels"), ("shippingbox", "Stock"), ("creditcard", "Payments")], id: \.1) { icon, label in
                            VStack(spacing: 4) {
                                Image(systemName: icon).font(.subheadline).foregroundStyle(Brand.forest)
                                Text(label).font(.caption2).foregroundStyle(Brand.inkMuted)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.top, 4)
                    .accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            }
            .listRowBackground(Color.clear)

            Section {
                Picker("Sign in with", selection: $method) {
                    ForEach(Method.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .onChange(of: method) { _, _ in errorMessage = nil }
            }

            Section {
                if method == .account {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("staffEmail")
                }
                SecureField(method == .account ? "Password" : "Store password", text: $password)
                    .textContentType(.password)
                    .accessibilityIdentifier("adminPassword")
                    .onSubmit { Task { await signIn() } }
                Button(isLoading ? "Signing in…" : "Sign in") { Task { await signIn() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!canSubmit)
                    .formButtonRow()
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Brand.red)
                }
            } footer: {
                Label(method == .account
                      ? "Your own store account (the one you shop with). The owner adds you under Staff."
                      : "The owner's shared password, same as the web dashboard.",
                      systemImage: "lock.fill")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var canSubmit: Bool {
        !password.isEmpty && !isLoading && (method == .storePassword || trimmedEmail.contains("@"))
    }

    private func signIn() async {
        guard canSubmit else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            try await AdminStore.shared.signIn(email: method == .account ? trimmedEmail : nil, password: password)
            password = ""
            errorMessage = nil
        } catch AppError.unauthorized {
            errorMessage = method == .account ? "Wrong email or password." : "Incorrect password."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AdminOrderQueue: View {
    @State var status: String?
    @State var queue: AdminQueue = .needsAction
    @State private var search = ""
    @State private var orders: [AdminOrder] = []
    @State private var hasMore = false
    @State private var counts: [String: Int] = [:]
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var loadError: String?

    private static let needsActionStatuses = ["ordered", "processing", "ready_for_pickup"]

    private func countLabel(_ value: Int?) -> String {
        guard let value else { return "" }
        return " (\(value))"
    }

    var body: some View {
        List {
            Section {
                Picker("Queue", selection: $queue) {
                    ForEach(AdminQueue.allCases) { item in
                        let count = counts.isEmpty || item == .toShip ? nil
                            : item == .needsAction ? Self.needsActionStatuses.reduce(0) { $0 + (counts[$1] ?? 0) }
                            : counts.values.reduce(0, +)
                        Text(item.label + countLabel(count)).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                Picker("Status", selection: $status) {
                    Text("Any status").tag(String?.none)
                    ForEach(OrderStatusFlow.all, id: \.self) { value in
                        Text(OrderStatusFlow.label(value, shippingMethod: nil) + countLabel(counts.isEmpty ? nil : counts[value] ?? 0))
                            .tag(Optional(value))
                    }
                }
                if !counts.isEmpty {
                    statusSummary
                }
            }

            if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                    Button("Retry") { Task { await reload() } }
                }
            } else if !loaded {
                Section { SkeletonRows(count: 6, showsImage: false) }
            } else if orders.isEmpty {
                Section {
                    Text(search.isEmpty ? "No orders here. Nice work." : "No orders match \u{201C}\(search)\u{201D}.")
                        .foregroundStyle(Brand.inkMuted)
                }
            } else {
                Section {
                    ForEach(orders) { order in
                        NavigationLink {
                            AdminOrderDetailView(orderID: order.id, onChange: { Task { await reload() } })
                        } label: {
                            AdminOrderRow(order: order)
                        }
                        .onAppear {
                            // Fetch the next page as the last row scrolls in.
                            if order.id == orders.last?.id { Task { await loadMore() } }
                        }
                    }
                    if hasMore {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                Spacer()
                                Text(loadingMore ? "Loading…" : "Load more orders")
                                Spacer()
                            }
                            .frame(minHeight: 44)
                        }
                        .disabled(loadingMore)
                        .accessibilityIdentifier("adminLoadMore")
                    }
                } header: {
                    Text("Showing \(orders.count)\(hasMore ? "+" : "") order\(orders.count == 1 ? "" : "s")")
                } footer: {
                    if !hasMore && orders.count > 10 {
                        Text("That's every order in this view.")
                    }
                }
            }

            Section {
                Button("Sign out of store manager", role: .destructive) {
                    Task { await AdminStore.shared.signOut() }
                }
            }
        }
        .searchable(text: $search, prompt: "Name, email or LQ number")
        .onSubmit(of: .search) { Task { await reload() } }
        .onChange(of: search) { _, value in
            if value.isEmpty { Task { await reload() } }
        }
        .onChange(of: queue) { _, _ in Task { await reload() } }
        .onChange(of: status) { _, _ in Task { await reload() } }
        .refreshable { await reload() }
        .task { await reload() }
    }

    /// Work waiting at each step, tappable to filter.
    private var statusSummary: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.needsActionStatuses, id: \.self) { value in
                    let count = counts[value] ?? 0
                    Button {
                        status = status == value ? nil : value
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(count)")
                                .font(.title3.weight(.bold))
                                .monospacedDigit()
                            Text(OrderStatusFlow.label(value, shippingMethod: nil))
                                .font(.caption2.weight(.semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(OrderStatusStyle.color(for: value))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(minWidth: 88, alignment: .leading)
                        .background(OrderStatusStyle.color(for: value).opacity(status == value ? 0.22 : 0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(count) \(OrderStatusFlow.label(value, shippingMethod: nil))")
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
    }

    private func reload() async {
        do {
            let page = try await AdminAPI.shared.orders(queue: queue, status: status, search: search)
            orders = page.orders
            hasMore = page.hasMore
            if let fresh = page.counts { counts = fresh }
            loadError = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
        loaded = true
    }

    private func loadMore() async {
        guard hasMore, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await AdminAPI.shared.orders(queue: queue, status: status, search: search, offset: orders.count)
            let seen = Set(orders.map(\.id))
            orders += page.orders.filter { !seen.contains($0.id) }
            hasMore = page.hasMore && !page.orders.isEmpty
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            // Keep what is shown; the button stays so staff can retry.
        }
    }
}

struct AdminOrderRow: View {
    let order: AdminOrder

    /// "12m", "3h", "2d": how long the customer has been waiting.
    private var age: String? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: order.createdAt) ?? {
            iso.formatOptions = [.withInternetDateTime]
            return iso.date(from: order.createdAt)
        }() else { return nil }
        let minutes = max(0, Int(Date().timeIntervalSince(date) / 60))
        if minutes < 60 { return "\(max(1, minutes))m" }
        if minutes < 60 * 24 { return "\(minutes / 60)h" }
        // Past two weeks a day count stops being useful; the row shows the date instead.
        guard minutes < 60 * 24 * 14 else { return nil }
        return "\(minutes / (60 * 24))d"
    }

    private var isOpen: Bool { ["ordered", "processing", "ready_for_pickup"].contains(order.status) }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: order.isPickup ? "storefront.fill" : "shippingbox.fill")
                .font(.subheadline)
                .foregroundStyle(order.isPickup ? Brand.gold : Brand.forest)
                .frame(width: 38, height: 38)
                .background((order.isPickup ? Brand.gold : Brand.forest).opacity(0.12),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityLabel(order.isPickup ? "Pickup" : "Shipping")
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(order.displayNumber).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                    if order.isUnpaid {
                        Text("UNPAID")
                            .font(.system(size: 9, weight: .heavy))
                            .tracking(0.5)
                            .foregroundStyle(Brand.gold)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Brand.gold.opacity(0.14), in: Capsule())
                    }
                }
                Text(order.customerName ?? order.customerEmail ?? "Customer")
                    .font(.caption)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if isOpen, let age {
                        Image(systemName: "clock").font(.system(size: 9, weight: .semibold))
                        Text("waiting \(age)")
                    } else {
                        Text(OrderStatusStyle.dateLabel(order.createdAt))
                    }
                }
                .font(.caption2)
                .foregroundStyle(Brand.inkMuted)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                if let total = order.totalAmount {
                    Text(String(format: "$%.2f", total))
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Brand.ink)
                        .monospacedDigit()
                }
                AdminStatusBadge(status: order.status, shippingMethod: order.shippingMethod)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct AdminStatusBadge: View {
    let status: String
    let shippingMethod: String?

    var body: some View {
        let color = OrderStatusStyle.color(for: status)
        Text(OrderStatusFlow.label(status, shippingMethod: shippingMethod))
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

// MARK: - Store manager: single order

struct AdminOrderDetailView: View {
    let orderID: String
    var onChange: () -> Void = {}


    @State private var detail: AdminOrderDetail?
    @State private var loadError: String?
    @State private var newStatus = ""
    @State private var trackingNumber = ""
    @State private var note = ""
    @State private var saving = false
    @State private var saveMessage: String?
    @State private var confirmNotify = false
    @State private var notifyMessage: String?
    @State private var itemImages: [String: URL] = [:]
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Could not load order", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") { Task { await load() } }
                }
            } else {
                Form {
                    Section { SkeletonRows(count: 4, showsImage: false) }
                    Section { SkeletonRows(count: 3) }
                }
            }
        }
        .navigationTitle("Order")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ detail: AdminOrderDetail) -> some View {
        let order = detail.order
        Form {
            Section {
                OrderSummaryCard(order: order, fulfillment: fulfillmentLabel(order.shippingMethod))
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            if order.status != "cancelled" {
                Section {
                    OrderProgressView(status: order.status, shippingMethod: order.shippingMethod,
                                      trackingNumber: order.trackingNumber, forStaff: true)
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.customerName ?? "Customer").font(.headline).foregroundStyle(Brand.ink)
                    if let email = order.customerEmail, !email.isEmpty {
                        Text(email).font(.subheadline).foregroundStyle(Brand.inkMuted).textSelection(.enabled)
                    }
                    if let phone = order.customerPhone, !phone.isEmpty {
                        Text(PhoneFormat.display(phone)).font(.subheadline).foregroundStyle(Brand.inkMuted)
                    }
                }
                .padding(.vertical, 2)
                CustomerActionBar(order: order, onEmailUpdate: { confirmNotify = true })
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    .confirmationDialog("Email \(order.customerEmail ?? "the customer") the current status?",
                                        isPresented: $confirmNotify, titleVisibility: .visible) {
                        Button("Send email") { Task { await notify(orderID: order.id) } }
                    } message: {
                        Text("Sends the \(OrderStatusFlow.label(order.status, shippingMethod: order.shippingMethod)) email again\(order.trackingNumber.map { ", with tracking \($0)" } ?? "").")
                    }
                if order.isPickup {
                    if let contact = order.pickupContactName, !contact.isEmpty {
                        LabeledContent("Picking up", value: contact)
                    }
                } else if !order.addressSummary.isEmpty {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "mappin.and.ellipse").foregroundStyle(Brand.forest).frame(width: 20)
                        Text(order.addressSummary).font(.callout).textSelection(.enabled)
                    }
                }
                if let notifyMessage {
                    Text(notifyMessage).font(.caption).foregroundStyle(Brand.inkMuted)
                }
            } header: {
                Text("Customer")
            }

            PackListSection(items: detail.items, images: itemImages, orderID: order.id)

            if order.needsCarrierLabel {
                ShippingLabelSection(order: order) { Task { await load(); onChange() } }
            }

            OrderPaymentSection(order: order) { Task { await load(); onChange() } }

            Section {
                if let next = OrderStatusFlow.next(after: order.status, shippingMethod: order.shippingMethod) {
                    Button("Mark \(OrderStatusFlow.label(next, shippingMethod: order.shippingMethod))") {
                        newStatus = next
                        Task { await save(orderID: order.id) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving)
                    .formButtonRow()
                    .accessibilityIdentifier("advanceStatus")
                }
                Picker("Set status", selection: $newStatus) {
                    ForEach(OrderStatusFlow.choices(for: order.shippingMethod), id: \.self) { value in
                        Text(OrderStatusFlow.label(value, shippingMethod: order.shippingMethod)).tag(value)
                    }
                }
                if !order.isPickup {
                    TextField("Tracking number", text: $trackingNumber)
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
                }
                TextField("Note for the customer (optional)", text: $note, axis: .vertical)
                    .lineLimit(1...4)
                Button(saving ? "Saving…" : "Save update") { Task { await save(orderID: order.id) } }
                    .disabled(saving || !hasChanges(order))
                if let saveMessage {
                    Text(saveMessage).font(.caption).foregroundStyle(Brand.inkMuted)
                }
            } header: {
                Text("Update")
            } footer: {
                Text("Status changes email the customer automatically.")
            }

            if !detail.logs.isEmpty {
                Section("History") {
                    ForEach(detail.logs.reversed()) { log in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(OrderStatusFlow.label(log.toStatus, shippingMethod: order.shippingMethod))
                                .font(.subheadline.weight(.medium))
                            Text([OrderStatusStyle.dateLabel(log.changedAt), log.changedBy.flatMap(AdminOrderDetailViewLabels.actor)]
                                    .compactMap { $0 }.joined(separator: " · "))
                                .font(.caption)
                                .foregroundStyle(Brand.inkMuted)
                            if let note = log.note, !note.isEmpty {
                                Text(note).font(.caption).foregroundStyle(Brand.ink)
                            }
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .refreshable { await load() }
    }

    private func fulfillmentLabel(_ method: String?) -> String {
        ShippingMethodOption(rawValue: method ?? "")?.label ?? (method ?? "—").capitalized
    }

    private func hasChanges(_ order: AdminOrder) -> Bool {
        newStatus != order.status
            || trackingNumber.trimmingCharacters(in: .whitespaces) != (order.trackingNumber ?? "")
            || !note.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func load() async {
        do {
            let fresh = try await AdminAPI.shared.order(id: orderID)
            detail = fresh
            let ids = Array(Set(fresh.items.compactMap(\.productId)))
            if itemImages.isEmpty, !ids.isEmpty,
               let products = try? await SupabaseService.shared.fetchProductsByIDs(ids) {
                itemImages = Dictionary(uniqueKeysWithValues: products.compactMap { p in p.primaryImageURL.map { (p.id, $0) } })
            }
            newStatus = fresh.order.status
            trackingNumber = fresh.order.trackingNumber ?? ""
            loadError = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func notify(orderID: String) async {
        do {
            try await AdminAPI.shared.notifyCustomer(orderID: orderID)
            notifyMessage = "Email sent."
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            notifyMessage = error.localizedDescription
        }
    }

    private func save(orderID: String) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            try await AdminAPI.shared.updateStatus(
                orderID: orderID, status: newStatus, trackingNumber: trackingNumber, note: note
            )
            note = ""
            saveMessage = "Saved."
            await load()
            onChange()
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            saveMessage = error.localizedDescription
        }
    }
}
