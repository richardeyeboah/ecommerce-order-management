import SwiftUI

// MARK: - Store manager hub

/// Entry point for store staff: sales, the order queue, stock and reviews in one place.
/// Uses the same admin password session as the web dashboard.
struct StoreManagerView: View {
    @Bindable private var admin = AdminStore.shared

    var body: some View {
        Group {
            if !admin.checked {
                List { SkeletonRows(count: 8, showsImage: false) }
            } else if admin.isSignedIn {
                ManagerDashboard()
            } else {
                AdminSignInView()
            }
        }
        .navigationTitle("Store manager")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await admin.restore() }
    }
}

private struct ManagerDashboard: View {
    @State private var range: ManagerRange = .today
    @State private var summary: ManagerSummary?
    @State private var loadError: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            Section {
                Picker("Period", selection: $range) {
                    ForEach(ManagerRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            if let summary {
                Section {
                    kpis(summary)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                workQueue(summary)
                if !summary.lowStock.isEmpty { lowStock(summary) }
                if !summary.bestSellers.isEmpty { bestSellers(summary) }
                if !summary.recentOrders.isEmpty { recentOrders(summary) }
            } else if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                }
            } else {
                Section {
                    Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                        GridRow { KPITileSkeleton(); KPITileSkeleton() }
                        GridRow { KPITileSkeleton(); KPITileSkeleton() }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section { SkeletonRows(count: 4, showsImage: false) }
            }

            Section {
                NavigationLink { AdminOrdersView() } label: {
                    Label("Orders", systemImage: "list.clipboard")
                }
                NavigationLink { InventoryView() } label: {
                    Label("Products & stock", systemImage: "shippingbox")
                }
                NavigationLink { ReviewModerationView() } label: {
                    Label("Reviews", systemImage: "star.bubble")
                }
                Button {
                    openURL(AppConfig.siteURL.appending(path: "admin"))
                } label: {
                    Label("Full web dashboard", systemImage: "safari")
                }
            } header: {
                Text("Manage")
            } footer: {
                Text("Refunds, shipping labels, announcements and new products are on the web dashboard.")
            }

            Section {
                Button("Sign out of store manager", role: .destructive) {
                    Task { await AdminStore.shared.signOut() }
                }
            }
        }
        .refreshable { await load() }
        .task(id: range) { await load() }
    }

    private func load() async {
        do {
            summary = try await AdminAPI.shared.summary(range: range)
            loadError = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD"))
    }

    private func kpis(_ s: ManagerSummary) -> some View {
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            GridRow {
                KPITile(title: "Sales", value: money(s.gross), change: s.grossChange, highlight: true)
                KPITile(title: "Orders", value: "\(s.orders)", change: nil)
            }
            GridRow {
                KPITile(title: "Average order", value: money(s.averageOrder), change: nil)
                KPITile(title: "Items sold", value: s.units.formatted(.number.precision(.fractionLength(0))), change: nil)
            }
        }
        .accessibilityIdentifier("managerKPIs")
    }

    @ViewBuilder
    private func workQueue(_ s: ManagerSummary) -> some View {
        Section("Needs attention") {
            NavigationLink { AdminOrdersView() } label: {
                QueueRow(icon: "tray.full", title: "Orders to handle", count: s.needsAction, tint: Brand.red)
            }
            if let toShip = s.toShip {
                NavigationLink { AdminOrdersView(initialQueue: .toShip) } label: {
                    QueueRow(icon: "shippingbox", title: "Orders to ship", count: toShip, tint: Brand.forest)
                }
            }
            NavigationLink { AdminOrdersView(initialStatus: "ready_for_pickup") } label: {
                QueueRow(icon: "storefront", title: "Waiting for pickup", count: s.readyForPickup, tint: Brand.gold)
            }
            NavigationLink { ReviewModerationView() } label: {
                QueueRow(icon: "star.bubble", title: "Reviews to approve", count: s.pendingReviews, tint: Brand.forest)
            }
            NavigationLink { InventoryView(initialFilter: .out) } label: {
                QueueRow(icon: "exclamationmark.triangle", title: "Sold out products", count: s.outOfStock, tint: Brand.inkMuted)
            }
            if s.unpaidCount > 0 {
                QueueRow(icon: "creditcard", title: "Unpaid phone orders", count: s.unpaidCount, tint: Brand.gold)
            }
        }
    }

    private func lowStock(_ s: ManagerSummary) -> some View {
        Section {
            ForEach(s.lowStock) { item in
                NavigationLink { InventoryView(initialSearch: item.name) } label: {
                    HStack(spacing: 12) {
                        CachedProductImage(url: item.imageURL.flatMap(URL.init(string:)))
                            .frame(width: 40, height: 40)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        Text(item.name).font(.subheadline).lineLimit(2)
                        Spacer()
                        Text("\(item.stockQuantity ?? 0) left")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Brand.gold)
                            .monospacedDigit()
                    }
                }
            }
        } header: {
            Text("Running low")
        } footer: {
            Text("Products with 5 or fewer left.")
        }
    }

    private func bestSellers(_ s: ManagerSummary) -> some View {
        Section("Best sellers · \(s.label.lowercased())") {
            ForEach(Array(s.bestSellers.enumerated()), id: \.element.id) { index, item in
                HStack(spacing: 12) {
                    Text("\(index + 1)")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Brand.inkMuted)
                        .frame(width: 20)
                    Text(item.name).font(.subheadline).lineLimit(2)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(money(item.revenue)).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text("\(Int(item.units)) sold").font(.caption).foregroundStyle(Brand.inkMuted)
                    }
                }
            }
        }
    }

    private func recentOrders(_ s: ManagerSummary) -> some View {
        Section("Latest orders") {
            ForEach(s.recentOrders) { order in
                NavigationLink {
                    AdminOrderDetailView(orderID: order.id, onChange: { Task { await load() } })
                } label: {
                    AdminOrderRow(order: order)
                }
            }
        }
    }
}

private struct KPITile: View {
    let title: String
    let value: String
    let change: Double?
    var highlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(highlight ? Brand.kenteGold : Brand.inkMuted)
            Text(value)
                .font(.title2.weight(.bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(highlight ? .white : Brand.ink)
            if let change {
                Label(
                    "\(change >= 0 ? "+" : "")\(change.formatted(.number.precision(.fractionLength(0))))% vs before",
                    systemImage: change >= 0 ? "arrow.up.right" : "arrow.down.right"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(highlight ? .white.opacity(0.85) : (change >= 0 ? Brand.success : Brand.red))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
        .padding(14)
        .background(highlight ? Brand.forest : Brand.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            if !highlight { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Brand.line) }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct KPITileSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 60, height: 10)
            RoundedRectangle(cornerRadius: 6).fill(Color.gray.opacity(0.12)).frame(width: 100, height: 24)
        }
        .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
        .padding(14)
        .background(Brand.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityHidden(true)
    }
}

private struct QueueRow: View {
    let icon: String
    let title: String
    let count: Int
    let tint: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .frame(width: 28)
            Text(title)
            Spacer()
            Text("\(count)")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background((count > 0 ? tint : Brand.inkMuted).opacity(0.14), in: Capsule())
                .foregroundStyle(count > 0 ? tint : Brand.inkMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Products & stock

struct InventoryView: View {
    var initialFilter: InventoryFilter = .all
    var initialSearch: String = ""

    @State private var filter: InventoryFilter = .all
    @State private var search = ""
    @State private var products: [ManagerProduct] = []
    @State private var hasMore = false
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var loadError: String?
    @State private var editing: ManagerProduct?
    @State private var didApplyInitial = false

    var body: some View {
        List {
            Section {
                Picker("Show", selection: $filter) {
                    ForEach(InventoryFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                    Button("Retry") { Task { await reload() } }
                }
            } else if !loaded {
                Section { SkeletonRows(count: 8) }
            } else if products.isEmpty {
                Section {
                    Text(search.isEmpty ? "Nothing here." : "No products match \u{201C}\(search)\u{201D}.")
                        .foregroundStyle(Brand.inkMuted)
                }
            } else {
                Section {
                    ForEach(products) { product in
                        Button { editing = product } label: { InventoryRow(product: product) }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing) {
                                Button(product.inStock ? "Sold out" : "In stock") {
                                    Task { await toggleStock(product) }
                                }
                                .tint(product.inStock ? Brand.inkMuted : Brand.success)
                            }
                            .onAppear {
                                if product.id == products.last?.id { Task { await loadMore() } }
                            }
                    }
                    if hasMore {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                Spacer()
                                Text(loadingMore ? "Loading…" : "Load more products")
                                Spacer()
                            }
                            .frame(minHeight: 44)
                        }
                        .disabled(loadingMore)
                    }
                } header: {
                    Text("\(products.count)\(hasMore ? "+" : "") product\(products.count == 1 ? "" : "s")")
                } footer: {
                    Text("Tap to change price or stock. Swipe to mark sold out.")
                }
            }
        }
        .navigationTitle("Products & stock")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .searchable(text: $search, prompt: "Name, brand or category")
        .onSubmit(of: .search) { Task { await reload() } }
        .onChange(of: search) { _, value in
            if value.isEmpty { Task { await reload() } }
        }
        .onChange(of: filter) { _, _ in Task { await reload() } }
        .refreshable { await reload() }
        .task {
            if !didApplyInitial {
                didApplyInitial = true
                filter = initialFilter
                search = initialSearch
            }
            await reload()
        }
        .sheet(item: $editing) { product in
            NavigationStack {
                ProductStockEditor(product: product) { updated in
                    if let index = products.firstIndex(where: { $0.id == updated.id }) {
                        products[index] = updated
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func reload() async {
        do {
            let page = try await AdminAPI.shared.products(search: search, filter: filter)
            products = page.products
            hasMore = page.hasMore
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
        guard let page = try? await AdminAPI.shared.products(search: search, filter: filter, offset: products.count) else { return }
        let seen = Set(products.map(\.id))
        products += page.products.filter { !seen.contains($0.id) }
        hasMore = page.hasMore && !page.products.isEmpty
    }

    private func toggleStock(_ product: ManagerProduct) async {
        do {
            try await AdminAPI.shared.setInStock(id: product.id, inStock: !product.inStock)
            if let index = products.firstIndex(where: { $0.id == product.id }) {
                products[index].inStock.toggle()
            }
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
    }
}

private struct InventoryRow: View {
    let product: ManagerProduct

    var body: some View {
        HStack(spacing: 12) {
            CachedProductImage(url: product.imageURL.flatMap(URL.init(string:)))
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(product.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Brand.ink)
                    .lineLimit(2)
                Text([product.category, product.packLabel].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Brand.inkMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(product.price.formatted(.currency(code: "USD")))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Brand.ink)
                Text(product.stockLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(stockColor)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }

    private var stockColor: Color {
        if !product.inStock { return Brand.red }
        if let quantity = product.stockQuantity, quantity <= 5 { return Brand.gold }
        return Brand.success
    }
}

private struct ProductStockEditor: View {
    let product: ManagerProduct
    let onSaved: (ManagerProduct) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var priceText: String
    @State private var tracksCount: Bool
    @State private var quantity: Int
    @State private var inStock: Bool
    @State private var saving = false
    @State private var errorMessage: String?

    init(product: ManagerProduct, onSaved: @escaping (ManagerProduct) -> Void) {
        self.product = product
        self.onSaved = onSaved
        _priceText = State(initialValue: String(format: "%.2f", product.price))
        _tracksCount = State(initialValue: product.stockQuantity != nil)
        _quantity = State(initialValue: product.stockQuantity ?? 0)
        _inStock = State(initialValue: product.inStock)
    }

    private var price: Double? {
        Double(priceText.replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespaces))
    }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    CachedProductImage(url: product.imageURL.flatMap(URL.init(string:)))
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Text(product.name).font(.headline)
                }
            }
            Section("Price") {
                TextField("Price", text: $priceText)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                    .accessibilityIdentifier("editPrice")
                if price == nil || (price ?? 0) <= 0 {
                    Text("Enter a price above $0.").font(.caption).foregroundStyle(.red)
                }
            }
            Section {
                Toggle("Track how many are left", isOn: $tracksCount)
                if tracksCount {
                    Stepper(value: $quantity, in: 0...9999) {
                        HStack {
                            Text("In stock")
                            Spacer()
                            Text("\(quantity)").monospacedDigit().fontWeight(.semibold)
                        }
                    }
                    .accessibilityIdentifier("editQuantity")
                } else {
                    Toggle("Available to buy", isOn: $inStock)
                }
            } header: {
                Text("Stock")
            } footer: {
                Text(tracksCount
                     ? "Customers can't add more than this. At 0 the product shows as sold out."
                     : "Turn off to show the product as sold out.")
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Edit product")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(saving ? "Saving…" : "Save") { Task { await save() } }
                    .disabled(saving || price == nil || (price ?? 0) <= 0)
                    .accessibilityIdentifier("saveProduct")
            }
        }
    }

    private func save() async {
        guard let price else { return }
        saving = true
        defer { saving = false }
        let count = tracksCount ? quantity : nil
        let available = tracksCount ? quantity > 0 : inStock
        do {
            try await AdminAPI.shared.updateProduct(id: product.id, price: price, stockQuantity: count, inStock: available)
            var updated = product
            updated.price = price
            updated.stockQuantity = count
            updated.inStock = available
            onSaved(updated)
            dismiss()
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Reviews

struct ReviewModerationView: View {
    @State private var reviews: [ManagerReview] = []
    @State private var loaded = false
    @State private var loadError: String?

    var body: some View {
        List {
            if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                }
            } else if !loaded {
                Section { SkeletonRows(count: 4, showsImage: false) }
            } else if reviews.isEmpty {
                ContentUnavailableView("No reviews waiting", systemImage: "checkmark.bubble",
                                       description: Text("New customer reviews appear here before they go live."))
            } else {
                Section {
                    ForEach(reviews) { review in
                        ReviewCard(review: review)
                            .swipeActions(edge: .leading) {
                                Button("Approve") { Task { await approve(review) } }.tint(Brand.success)
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Delete", role: .destructive) { Task { await remove(review) } }
                            }
                    }
                } footer: {
                    Text("Swipe right to publish, left to delete.")
                }
            }
        }
        .navigationTitle("Reviews")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do {
            reviews = try await AdminAPI.shared.pendingReviews()
            loadError = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
        loaded = true
    }

    private func approve(_ review: ManagerReview) async {
        await act(on: review) { try await AdminAPI.shared.approveReview(id: review.id) }
    }

    private func remove(_ review: ManagerReview) async {
        await act(on: review) { try await AdminAPI.shared.deleteReview(id: review.id) }
    }

    private func act(on review: ManagerReview, _ work: () async throws -> Void) async {
        do {
            try await work()
            withAnimation(.easeOut(duration: 0.2)) { reviews.removeAll { $0.id == review.id } }
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            loadError = error.localizedDescription
        }
    }
}

private struct ReviewCard: View {
    let review: ManagerReview

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 2) {
                    ForEach(1...5, id: \.self) { star in
                        Image(systemName: star <= review.rating ? "star.fill" : "star")
                            .font(.caption)
                            .foregroundStyle(Brand.gold)
                    }
                }
                .accessibilityLabel("\(review.rating) out of 5 stars")
                Spacer()
                Text(OrderStatusStyle.dateLabel(review.createdAt))
                    .font(.caption2)
                    .foregroundStyle(Brand.inkMuted)
            }
            if let productName = review.productName {
                Text(productName).font(.subheadline.weight(.semibold))
            }
            if let comment = review.comment, !comment.isEmpty {
                Text(comment).font(.subheadline).foregroundStyle(Brand.ink)
            }
            Text("— \(review.reviewerName ?? "Customer")")
                .font(.caption)
                .foregroundStyle(Brand.inkMuted)
        }
        .padding(.vertical, 4)
    }
}
