import SwiftUI

struct HomeView: View {
    @Bindable private var catalog = CatalogStore.shared
    @Bindable private var recent = RecentlyViewedStore.shared
    @Bindable private var cart = CartStore.shared
    @State private var announcements: [Announcement] = Announcement.fallback
    @State private var bestsellers: [Product] = []
    @State private var buyAgain: [Product] = []
    @Bindable private var auth = AuthStore.shared
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Shelves are derived from the whole catalog; work them out once per update.
        let staples = HomeMerchandising.staples(from: catalog.products)
        let trending = HomeMerchandising.trending(
            from: catalog.products, excluding: Set((staples + bestsellers).map(\.id))
        )
        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HomeSearchBar().padding(.horizontal)

                AnnouncementTicker(items: announcements) { open($0) }

                WelcomeHero(inStock: catalog.products.filter(\.effectiveInStock).count)
                    .padding(.horizontal)

                if !AppConfig.isConfigured {
                    ConfigBanner().padding(.horizontal)
                }

                utilityStrip

                categories

                if !buyAgain.isEmpty {
                    productShelf("Buy it again", subtitle: "Restock from your past orders", products: buyAgain)
                }

                if !bestsellers.isEmpty {
                    productShelf("Bestsellers", subtitle: "Most ordered by our customers", products: bestsellers)
                }

                productShelf("Yam, fufu & staples", subtitle: "Plantain, fufu, yam and pantry essentials", products: staples)

                WhatsAppCard().padding(.horizontal)

                productShelf("Trending this week", subtitle: "Popular across the store", products: trending)

                newArrivals

                if !recent.products.isEmpty {
                    recentlyViewed
                }

                quickLinks

                StoreInfoCard().padding(.horizontal)
            }
            .padding(.vertical)
        }
        .background(Brand.surface.ignoresSafeArea())
        .navigationTitle("Home")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Image("LogoMark")
                        .resizable()
                        .frame(width: 26, height: 26)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    Text("Kintampo")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(Brand.ink)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Kintampo African Market")
            }
            ToolbarItem(placement: .primaryAction) {
                NavigationLink {
                    WishlistView()
                } label: {
                    Image(systemName: "heart")
                }
                .accessibilityLabel("Saved items")
            }
        }
        .refreshable {
            await catalog.reload()
            await loadMerchandising()
        }
        .task { await loadMerchandising() }
        // Warm the photos for the first screens of shelves as soon as the catalog arrives.
        .task(id: catalog.products.count) {
            let first = staples.prefix(10) + catalog.featured(limit: 12)
            ImageCache.shared.prefetch(first.compactMap(\.primaryImageURL))
        }
        .task(id: auth.userId) { await loadBuyAgain() }
        .navigationDestination(for: Product.self) { ProductDetailView(product: $0) }
        .navigationDestination(for: String.self) { ShopView(initialCategory: $0) }
    }

    private var utilityStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                UtilityChip(icon: "mappin.and.ellipse", text: "Free pickup · Columbus")
                UtilityChip(icon: "shippingbox.fill", text: "Free shipping $\(StoreConfig.freeShippingThreshold)+")
                UtilityChip(icon: "clock.fill", text: "Ships in 24h")
                UtilityChip(icon: "lock.fill", text: "Secure checkout")
            }
            .padding(.horizontal)
        }
    }

    /// Announcements and bestsellers load side by side.
    private func loadMerchandising() async {
        async let rows = try? SupabaseService.shared.fetchAnnouncements()
        async let top = APIClient.shared.bestsellers()
        if let rows = await rows, !rows.isEmpty { announcements = rows }
        let best = StorefrontCatalog.visible(await top)
        if best != bestsellers { bestsellers = best }
        ImageCache.shared.prefetch(best.compactMap(\.primaryImageURL))
    }

    /// Items from the customer's last few orders, most often bought first, that are in stock now.
    private func loadBuyAgain() async {
        guard auth.isSignedIn,
              let recent = try? await SupabaseService.shared.fetchMyOrders(pageSize: 5).orders,
              !recent.isEmpty
        else {
            buyAgain = []
            return
        }
        var counts: [String: Int] = [:]
        await withTaskGroup(of: [OrderLineItem].self) { group in
            for order in recent {
                group.addTask { (try? await SupabaseService.shared.fetchOrderItems(orderID: order.id)) ?? [] }
            }
            for await items in group {
                for item in items {
                    if let id = item.productId { counts[id, default: 0] += item.quantity }
                }
            }
        }
        let ranked = counts.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.map(\.key)
        guard let products = try? await SupabaseService.shared.fetchProductsByIDs(Array(ranked.prefix(30))) else { return }
        let byID = Dictionary(uniqueKeysWithValues: StorefrontCatalog.visible(products).map { ($0.id, $0) })
        buyAgain = Array(ranked.compactMap { byID[$0] }.filter(\.effectiveInStock).prefix(10))
    }

    /// Product links stay in the app; anything else opens the website page.
    private func open(_ href: String) {
        let url = href.hasPrefix("http") ? URL(string: href) : URL(string: href, relativeTo: AppConfig.siteURL)?.absoluteURL
        guard let url else { return }
        if AppRouter.productID(from: url) != nil { AppRouter.shared.open(url) } else { openURL(url) }
    }

    @ViewBuilder
    private func productShelf(_ title: String, subtitle: String, products: [Product]) -> some View {
        if !products.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    SectionHeader(title: title)
                    Text(subtitle).font(.caption).foregroundStyle(Brand.inkMuted)
                }
                .padding(.horizontal)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(products) { product in
                            NavigationLink(value: product) {
                                ProductCard(product: product, compact: true)
                                    .frame(width: typeSize.isAccessibilitySize ? 240 : 150)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }

    /// Departments that actually have stock, biggest first — mirrors the website's department grid.
    private var departments: [(name: String, count: Int)] {
        let counts = Dictionary(grouping: catalog.products.filter(\.effectiveInStock), by: \.category)
            .mapValues(\.count)
        return counts.filter { !$0.key.isEmpty }
            .map { (name: $0.key, count: $0.value) }
            .sorted { $0.count == $1.count ? $0.name < $1.name : $0.count > $1.count }
    }

    private var categories: some View {
        let tile = DepartmentTile.size(for: typeSize)
        return VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Shop by department", action: { AppRouter.shared.requestedTab = 1 }).padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHGrid(rows: [GridItem(.fixed(tile.height), spacing: 10), GridItem(.fixed(tile.height), spacing: 10)], spacing: 10) {
                    ForEach(departments, id: \.name) { dept in
                        NavigationLink(value: dept.name) {
                            DepartmentTile(
                                name: dept.name,
                                count: dept.count,
                                imageURL: StoreConfig.categoryImageURL(dept.name)
                                    ?? catalog.products.first { $0.category == dept.name && $0.primaryImageURL != nil }?.primaryImageURL
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
            .frame(height: tile.height * 2 + 10)
        }
    }

    private var newArrivals: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "New arrivals").padding(.horizontal)

            if catalog.isLoading && catalog.products.isEmpty {
                SkeletonGrid().padding(.horizontal)
            } else if let errorMessage = catalog.errorMessage, catalog.products.isEmpty {
                VStack(spacing: 10) {
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(Brand.inkMuted)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await catalog.reload() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(maxWidth: 160)
                }
                .frame(maxWidth: .infinity)
                .brandCard(padding: 20)
                .padding(.horizontal)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 280 : 150), spacing: 12)], spacing: 12) {
                    ForEach(catalog.featured(limit: 12)) { product in
                        NavigationLink(value: product) {
                            ProductCard(product: product)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    private var recentlyViewed: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Recently viewed").padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(recent.products.prefix(8)) { product in
                        NavigationLink(value: product) {
                            ProductCard(product: product, compact: true, showQuickAdd: false)
                                .frame(width: 140)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    private var quickLinks: some View {
        VStack(spacing: 8) {
            NavigationLink { BundlesView() } label: {
                QuickLinkRow(icon: "shippingbox.fill", title: "Bundles", subtitle: "Save on curated sets")
            }
            .buttonStyle(.plain)
            NavigationLink { RecipesView() } label: {
                QuickLinkRow(icon: "fork.knife", title: "Recipes", subtitle: "Shop ingredients in one tap")
            }
            .buttonStyle(.plain)
            NavigationLink { TrackOrderView() } label: {
                QuickLinkRow(icon: "location.fill", title: "Track an order", subtitle: "Pickup and shipping status")
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal)
    }
}

/// Looks like a search field (the first thing shoppers reach for); opens Shop with the
/// keyboard up, so search works the same everywhere.
private struct HomeSearchBar: View {
    var body: some View {
        Button {
            AppRouter.shared.openSearch()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Brand.inkMuted)
                Text("Search fufu, gari, palm oil…")
                    .foregroundStyle(Brand.inkMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(.body)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(Brand.card)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Brand.line))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Search products")
        .accessibilityAddTraits(.isSearchField)
        .accessibilityIdentifier("homeSearch")
    }
}

/// The website's admin-managed announcements. Static: one card, or a row the customer swipes
/// through. Nothing advances on its own (no idle motion after load).
private struct AnnouncementTicker: View {
    let items: [Announcement]
    let onOpen: (String) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if items.count == 1, let item = items.first {
            card(item).padding(.horizontal)
        } else if !items.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items) { item in
                        card(item).containerRelativeFrame(.horizontal) { width, _ in width * 0.86 }
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal)
            }
            .scrollTargetBehavior(.viewAligned)
        }
    }

    private func card(_ item: Announcement) -> some View {
        Button {
            if let href = item.href, !href.isEmpty { onOpen(href) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "megaphone.fill").font(.caption).foregroundStyle(Brand.gold)
                Text(item.message)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Brand.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? 6 : 2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if item.href?.isEmpty == false {
                    Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Brand.inkMuted)
                }
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Brand.gold.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.message)
    }
}

/// WhatsApp is how many customers already order from the store.
private struct WhatsAppCard: View {
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .title3) private var iconSize: CGFloat = 44

    var body: some View {
        Button {
            if let url = StoreConfig.whatsAppURL(message: "Hi Kintampo! I'd like to place an order / ask a question.") {
                openURL(url)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "message.fill")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: iconSize, height: iconSize)
                    .background(Color(hex: 0x25D366))
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Order or ask on WhatsApp").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                    Text("Can't find something? Message the store.").font(.caption).foregroundStyle(Brand.inkMuted)
                }
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption.weight(.bold)).foregroundStyle(Brand.inkMuted)
            }
            .brandCard(padding: 12)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens WhatsApp")
    }
}

/// Welcome banner at the top of Home: store photo, greeting, and the two main ways in.
/// The photo is a background, so the text sets the height and can grow with Dynamic Type.
private struct WelcomeHero: View {
    let inStock: Int
    @Bindable private var auth = AuthStore.shared
    @Environment(\.dynamicTypeSize) private var typeSize

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
        let first = auth.profile?.fullName?.split(separator: " ").first.map(String.init)
        return first.map { "\(part), \($0)" } ?? part
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(greeting.uppercased())
                .font(.caption.weight(.bold))
                .tracking(1.2)
                .foregroundStyle(Brand.kenteGold)
            Text("Ghana & Caribbean groceries — in stock now.")
                .font(.title2.weight(.bold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            Text(inStock > 0
                 ? "\(inStock) products · Pickup in Columbus or ships nationwide."
                 : "Pickup in Columbus or ships nationwide.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
            buttons.padding(.top, 4)
        }
        .padding(18)
        .padding(.top, 120)
        .frame(maxWidth: .infinity, minHeight: 340, alignment: .bottomLeading)
        .background {
            ZStack {
                Image("WelcomeHero")
                    .resizable()
                    .scaledToFill()
                    .accessibilityHidden(true)
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: Brand.forest.opacity(0.55), location: 0.3),
                        .init(color: Brand.forest.opacity(0.97), location: 0.7),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: Brand.cardShadow, radius: 10, y: 4)
    }

    /// Side by side normally; stacked full-width at accessibility sizes so labels never truncate.
    private var buttons: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            Button { AppRouter.shared.requestedTab = 1 } label: {
                Label("Shop all", systemImage: "arrow.right")
                    .labelStyle(TrailingIconLabelStyle())
                    .heroButton(background: Brand.red, foreground: .white, fill: typeSize.isAccessibilitySize)
            }
            NavigationLink(value: StoreConfig.fashionGroup) {
                Text("Shop fashion")
                    .heroButton(background: .white.opacity(0.95), foreground: Brand.ink, fill: typeSize.isAccessibilitySize)
            }
        }
        .buttonStyle(.plain)
    }
}

private extension View {
    func heroButton(background: Color, foreground: Color, fill: Bool) -> some View {
        font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: fill ? .infinity : nil, minHeight: 42)
            .background(background)
            .foregroundStyle(foreground)
            .clipShape(Capsule())
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.title; configuration.icon }
    }
}

private struct DepartmentTile: View {
    let name: String
    let count: Int
    let imageURL: URL?
    @Environment(\.dynamicTypeSize) private var typeSize

    /// Grows with Dynamic Type so the name and count always fit.
    static func size(for typeSize: DynamicTypeSize) -> CGSize {
        switch typeSize {
        case ...DynamicTypeSize.large: CGSize(width: 150, height: 118)
        case ...DynamicTypeSize.xxxLarge: CGSize(width: 170, height: 136)
        case ...DynamicTypeSize.accessibility2: CGSize(width: 220, height: 170)
        default: CGSize(width: 260, height: 210)
        }
    }

    var body: some View {
        let size = Self.size(for: typeSize)
        ZStack(alignment: .bottomLeading) {
            CachedProductImage(url: imageURL)
                .frame(width: size.width, height: size.height)
                .clipped()
            LinearGradient(
                stops: [.init(color: .clear, location: 0.2), .init(color: .black.opacity(0.85), location: 1)],
                startPoint: .top, endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .shadow(color: .black.opacity(0.5), radius: 2)
                Text("\(count) item\(count == 1 ? "" : "s")")
                    .font(.caption2)
                    .lineLimit(1)
                    .opacity(0.85)
            }
            .foregroundStyle(.white)
            .padding(10)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct UtilityChip: View {
    let icon: String
    let text: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption).foregroundStyle(Brand.red)
            Text(text).font(.caption.weight(.medium)).foregroundStyle(Brand.ink)
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 32)
        .background(Brand.card)
        .overlay(Capsule().stroke(Brand.line))
        .clipShape(Capsule())
    }
}

private struct QuickLinkRow: View {
    let icon: String
    let title: String
    let subtitle: String
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.headline)
                .foregroundStyle(Brand.red)
                .frame(width: 36, height: 36)
                .background(Brand.red.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Text(subtitle).font(.caption).foregroundStyle(Brand.inkMuted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Brand.inkMuted)
        }
        .frame(minHeight: 44)
        .brandCard()
    }
}

private struct StoreInfoCard: View {
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Store")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.ink)
            Label(StoreConfig.address, systemImage: "mappin.and.ellipse")
            Label(StoreConfig.hours, systemImage: "clock.fill")
            Button {
                let digits = StoreConfig.phone.filter(\.isNumber)
                if let url = URL(string: "tel://\(digits)") { openURL(url) }
            } label: {
                Label(StoreConfig.phone, systemImage: "phone.fill")
                    .foregroundStyle(Brand.red)
            }
            .buttonStyle(.plain)
            .frame(minHeight: 32)
        }
        .font(.caption)
        .foregroundStyle(Brand.inkMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(padding: 14)
    }
}

private struct ConfigBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Brand.gold)
            Text("Missing Supabase keys in Config.xcconfig.")
                .font(.caption)
        }
        .padding(12)
        .background(Brand.gold.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
