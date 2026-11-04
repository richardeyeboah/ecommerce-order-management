import SwiftUI

struct ProductDetailView: View {
    let product: Product
    @State private var detail: Product
    @State private var quantity = 1
    @State private var added = false
    @State private var isLoadingDetail = false
    @State private var selectedImageIndex = 0
    @State private var variants: [Product] = []
    @State private var related: [Product] = []
    @State private var buyBlockOffscreen = false
    @State private var showPhotoViewer = false
    @State private var askSignIn = false
    @Bindable private var wishlist = WishlistStore.shared
    @Bindable private var auth = AuthStore.shared
    @Bindable private var cart = CartStore.shared

    init(product: Product) {
        self.product = product
        _detail = State(initialValue: product)
    }

    private var galleryURLs: [URL] {
        var urls: [URL] = []
        if let main = detail.primaryImageURL { urls.append(main) }
        for raw in detail.imageURLs ?? [] {
            guard let url = URL(string: raw), !urls.contains(url) else { continue }
            urls.append(url)
        }
        return urls
    }

    private var maxQty: Int { max(1, detail.maxCartQuantity == 0 ? 1 : detail.maxCartQuantity) }
    private var inCart: Int { cart.items.first { $0.product.id == detail.id }?.quantity ?? 0 }
    private var lowStock: Int? {
        guard let qty = detail.stockQuantity, qty > 0, qty <= 5 else { return nil }
        return qty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                gallery

                VStack(alignment: .leading, spacing: 10) {
                    Text(detail.category.uppercased())
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(Brand.red)

                    HStack(alignment: .top) {
                        Text(detail.name)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(Brand.ink)
                        Spacer(minLength: 8)
                        HStack(spacing: 4) {
                            ShareLink(
                                item: StorefrontCatalog.publicProductURL(id: detail.id),
                                subject: Text(detail.name),
                                message: Text("\(detail.name) — order at Kintampo African Market")
                            ) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(Brand.ink)
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)

                            Button {
                                if auth.isSignedIn {
                                    Task { await wishlist.toggle(detail) }
                                } else {
                                    askSignIn = true
                                }
                            } label: {
                                    Image(systemName: wishlist.contains(detail.id) ? "heart.fill" : "heart")
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(Brand.red)
                                        .frame(width: 44, height: 44)
                                        .contentTransition(.symbolEffect(.replace))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(wishlist.contains(detail.id) ? "Remove from saved items" : "Save item")
                            .alert("Sign in to save items", isPresented: $askSignIn) {
                                Button("Sign in") { AppRouter.shared.requestedTab = 4 }
                                Button("Not now", role: .cancel) {}
                            } message: {
                                Text("Saved items sync to your account on the app and the website.")
                            }
                        }
                    }

                    if let brand = detail.brand?.trimmingCharacters(in: .whitespacesAndNewlines), !brand.isEmpty {
                        Text(brand)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Brand.inkMuted)
                    }

                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(detail.displayPrice)
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(Brand.ink)
                            .monospacedDigit()
                        if let pack = detail.packLabel, !pack.isEmpty {
                            Text(pack).font(.subheadline).foregroundStyle(Brand.inkMuted)
                        }
                        if let unit = detail.unitPriceLabel {
                            Text(unit).font(.caption).foregroundStyle(Brand.inkMuted)
                        }
                    }

                    HStack(spacing: 8) {
                        if !detail.effectiveInStock {
                            StatusChip(text: "Out of stock", color: Brand.inkMuted)
                        } else if let lowStock {
                            StatusChip(text: "Only \(lowStock) left", color: Brand.gold)
                        } else {
                            StatusChip(text: "In stock", color: Brand.success)
                        }
                    }

                    if let tags = detail.dietaryTags?.filter({ !$0.trimmingCharacters(in: .whitespaces).isEmpty }), !tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(tags, id: \.self) { tag in
                                    StatusChip(text: tag, color: Brand.inkMuted, filled: false)
                                }
                            }
                        }
                    }
                }

                if variants.count > 1 {
                    variantPicker
                }

                purchaseBlock
                    .onGeometryChange(for: Bool.self) { proxy in
                        proxy.frame(in: .scrollView).maxY < 0
                    } action: { offscreen in
                        withAnimation(.easeOut(duration: 0.2)) { buyBlockOffscreen = offscreen }
                    }

                if isLoadingDetail, detail.description == nil {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach([1.0, 0.92, 0.6], id: \.self) { width in
                            RoundedRectangle(cornerRadius: 4).fill(Brand.line.opacity(0.6))
                                .frame(height: 12)
                                .containerRelativeFrame(.horizontal) { w, _ in (w - 32) * width }
                        }
                    }
                    .accessibilityLabel("Loading description")
                } else if let description = detail.description, !description.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("About this product")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Brand.ink)
                        Text(description)
                            .font(.body)
                            .foregroundStyle(Brand.inkMuted)
                    }
                }

                ProductReviewsSection(productID: detail.id)
                    .id(detail.id)

                if !related.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "More in \(detail.category)")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(related) { item in
                                    NavigationLink(value: item) {
                                        ProductCard(product: item, compact: true)
                                            .frame(width: 150)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .background(Brand.surface.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if buyBlockOffscreen && detail.effectiveInStock {
                stickyBuyBar.transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .navigationTitle("")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear { RecentlyViewedStore.shared.record(detail) }
        .task(id: detail.id) {
            if auth.isSignedIn { await wishlist.refreshIfNeeded() }
            await loadFullProduct()
        }
        .onChange(of: added) { _, value in
            guard value else { return }
            Task {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                added = false
            }
        }
    }

    private var variantPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Size")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.ink)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(variants.sorted { ($0.unitAmount ?? $0.price) < ($1.unitAmount ?? $1.price) }) { variant in
                        let active = variant.id == detail.id
                        Button {
                            detail = variant
                            quantity = 1
                            selectedImageIndex = 0
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(variant.packLabel?.isEmpty == false ? variant.packLabel! : variant.displayPrice)
                                    .font(.subheadline.weight(.semibold))
                                Text(variant.effectiveInStock ? variant.displayPrice : "Out")
                                    .font(.caption)
                                    .opacity(0.8)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 48)
                            .background(active ? Brand.ink : Brand.card)
                            .foregroundStyle(active ? Color.white : (variant.effectiveInStock ? Brand.ink : Brand.inkMuted))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(active ? Brand.ink : Brand.line))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var whatsAppMessage: String {
        "Hi Kintampo! I'm asking about \(detail.name) (\(String(format: "$%.2f", detail.price))): "
            + StorefrontCatalog.publicProductURL(id: detail.id).absoluteString
    }

    /// Keeps "Add to cart" in reach once the main buy button scrolls away (reviews, related items).
    private var stickyBuyBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(detail.name)
                    .font(.caption)
                    .foregroundStyle(Brand.inkMuted)
                    .lineLimit(1)
                Text(String(format: "$%.2f", detail.price * Double(quantity)))
                    .font(.headline)
                    .foregroundStyle(Brand.ink)
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize()
            }
            Spacer(minLength: 8)
            Button {
                CartStore.shared.add(detail, quantity: quantity, toast: false)
                added = true
            } label: {
                Label(added ? "Added" : (quantity > 1 ? "Add \(quantity)" : "Add to cart"),
                      systemImage: added ? "checkmark" : "cart.badge.plus")
                    .lineLimit(1)
                    .padding(.horizontal, 18)
            }
            .buttonStyle(PrimaryButtonStyle())
            .fixedSize()
            .accessibilityIdentifier("stickyAddToCart")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Divider() }
    }

    private var purchaseBlock: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Quantity")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Brand.ink)
                Spacer()
                HStack(spacing: 0) {
                    Button { quantity = max(1, quantity - 1) } label: {
                        Image(systemName: "minus").font(.caption.weight(.bold)).frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .disabled(quantity <= 1)
                    Text("\(quantity)")
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .frame(minWidth: 32)
                    Button { quantity = min(maxQty, quantity + 1) } label: {
                        Image(systemName: "plus").font(.caption.weight(.bold)).frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .disabled(quantity >= maxQty)
                }
                .foregroundStyle(Brand.ink)
                .background(Brand.surface)
                .clipShape(Capsule())
                .disabled(!detail.effectiveInStock)
            }

            Button {
                CartStore.shared.add(detail, quantity: quantity, toast: false)
                added = true
            } label: {
                HStack {
                    Image(systemName: added ? "checkmark" : "cart.badge.plus")
                    Text(added ? "Added to cart" : (detail.effectiveInStock ? "Add to cart" : "Out of stock"))
                    Spacer()
                    Text(String(format: "$%.2f", detail.price * Double(quantity))).monospacedDigit()
                }
                .padding(.horizontal, 16)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!detail.effectiveInStock)
            .accessibilityIdentifier("addToCart")

            if inCart > 0 {
                HStack {
                    Text("\(inCart) in cart")
                        .font(.caption)
                        .foregroundStyle(Brand.inkMuted)
                    Spacer()
                    Button("View cart") { AppRouter.shared.requestedTab = 2 }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Brand.red)
                }
            }

            if detail.effectiveInStock {
                FulfillmentOptions(price: detail.price * Double(max(quantity, 1)))
            }

            if let url = StoreConfig.whatsAppURL(message: whatsAppMessage) {
                Link(destination: url) {
                    Label(detail.effectiveInStock ? "Ask about this on WhatsApp" : "Ask when it's back on WhatsApp",
                          systemImage: "message.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                        .foregroundStyle(Color(hex: 0x128C7E))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0x25D366), lineWidth: 1.5))
                }
            }
        }
        .brandCard(padding: 14)
    }

    @ViewBuilder
    private var gallery: some View {
        let urls = galleryURLs
        if urls.isEmpty {
            CachedProductImage(url: nil)
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: Brand.cardRadius, style: .continuous))
        } else {
            VStack(spacing: 8) {
                TabView(selection: $selectedImageIndex) {
                    ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                        CachedProductImage(url: url, size: .full)
                            .frame(height: 300)
                            .clipped()
                            .contentShape(Rectangle())
                            .onTapGesture { showPhotoViewer = true }
                            .accessibilityAddTraits(.isButton)
                            .accessibilityLabel("Photo \(index + 1) of \(urls.count). Opens full screen.")
                            .tag(index)
                    }
                }
                #if os(iOS)
                .tabViewStyle(.page(indexDisplayMode: urls.count > 1 ? .automatic : .never))
                #endif
                .frame(height: 300)
                .background(Brand.card)
                .clipShape(RoundedRectangle(cornerRadius: Brand.cardRadius, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption.weight(.bold))
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                        .padding(10)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                #if os(iOS)
                .fullScreenCover(isPresented: $showPhotoViewer) {
                    PhotoViewer(urls: urls, index: $selectedImageIndex)
                }
                #else
                .sheet(isPresented: $showPhotoViewer) {
                    PhotoViewer(urls: urls, index: $selectedImageIndex).frame(minWidth: 600, minHeight: 600)
                }
                #endif

                if urls.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                                Button { selectedImageIndex = index } label: {
                                    CachedProductImage(url: url)
                                        .frame(width: 56, height: 56)
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .stroke(index == selectedImageIndex ? Brand.red : Brand.line, lineWidth: index == selectedImageIndex ? 2 : 1)
                                        }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Full record, related items and size variants load together, not one after another.
    private func loadFullProduct() async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        let id = detail.id
        let category = detail.category
        async let fullTask = try? SupabaseService.shared.fetchProduct(id: id)
        async let relatedTask = try? SupabaseService.shared.fetchRelated(category: category, excludeID: id)
        let listGroup = detail.variantGroup ?? ""
        async let variantsTask = listGroup.isEmpty ? nil : try? SupabaseService.shared.fetchVariants(group: listGroup)

        if let full = await fullTask, !StorefrontCatalog.isHidden(full), full.id == detail.id {
            detail = full
            RecentlyViewedStore.shared.record(full)
        }
        let loadedRelated = StorefrontCatalog.visible(await relatedTask ?? [])
        related = loadedRelated
        ImageCache.shared.prefetch(loadedRelated.compactMap(\.primaryImageURL))
        if let found = await variantsTask {
            variants = StorefrontCatalog.visible(found)
        } else if let group = detail.variantGroup, !group.isEmpty {
            // The list payload has no variant group; the full record may.
            variants = StorefrontCatalog.visible((try? await SupabaseService.shared.fetchVariants(group: group)) ?? [])
        } else {
            variants = []
        }
    }
}

private struct FulfillmentOptions: View {
    let price: Double

    var body: some View {
        // Re-evaluated each minute so "Open now" flips at closing time while the page is open.
        TimelineView(.everyMinute) { context in
            VStack(spacing: 0) {
                row(icon: "storefront", title: "Free pickup",
                    detail: "\(StoreConfig.pickupStatus(at: context.date)) · Columbus")
                Divider().padding(.leading, 40)
                row(icon: "shippingbox", title: "Shipping",
                    detail: price >= Double(StoreConfig.freeShippingThreshold)
                        ? "Ships within 24 hours · free on this order"
                        : "Ships within 24 hours · free on orders $\(StoreConfig.freeShippingThreshold)+")
            }
        }
        .background(Brand.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func row(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(Brand.forest)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Text(detail).font(.caption).foregroundStyle(Brand.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

private struct StatusChip: View {
    let text: String
    let color: Color
    var filled = true
    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .frame(minHeight: 26)
            .background(filled ? color.opacity(0.12) : Color.clear)
            .foregroundStyle(filled ? color : Brand.inkMuted)
            .overlay(Capsule().stroke(filled ? Color.clear : Brand.line))
            .clipShape(Capsule())
    }
}

/// Full-screen product photos: swipe between them, pinch or double-tap to zoom.
private struct PhotoViewer: View {
    let urls: [URL]
    @Binding var index: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(urls.enumerated()), id: \.offset) { offset, url in
                    ZoomableImage(url: url).tag(offset)
                }
            }
            #if os(iOS)
            .tabViewStyle(.page(indexDisplayMode: urls.count > 1 ? .always : .never))
            #endif
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.18), in: Circle())
            }
            .padding()
            .accessibilityLabel("Close photos")
        }
    }
}

private struct ZoomableImage: View {
    let url: URL
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        CachedProductImage(url: url, fit: true, background: .black, size: .full)
            .scaleEffect(scale)
            .offset(offset)
            .simultaneousGesture(magnify)
            // Pan only while zoomed, so a normal swipe still pages between photos.
            .gesture(pan, including: scale > 1 ? .all : .none)
            .onTapGesture(count: 2) {
                withAnimation(.snappy(duration: 0.2)) {
                    if scale > 1 { reset() } else { scale = 2.5; lastScale = 2.5 }
                }
            }
            .accessibilityLabel("Product photo")
            .accessibilityHint("Double-tap to zoom")
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in scale = min(4, max(1, lastScale * value.magnification)) }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1 { withAnimation(.snappy(duration: 0.2)) { reset() } }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height)
            }
            .onEnded { _ in lastOffset = offset }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}
