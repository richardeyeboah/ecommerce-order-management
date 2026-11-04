import SwiftUI

struct ShopView: View {
    var initialCategory: String? = nil

    @Bindable private var catalog = CatalogStore.shared
    @Bindable private var router = AppRouter.shared
    @State private var searchText = ""
    @State private var selectedCategory: String?
    @State private var inStockOnly = false
    @State private var sort: CatalogSort = .newest
    @State private var remoteResults: [Product]?
    @State private var searching = false
    @FocusState private var searchFocused: Bool
    @AppStorage("recentSearches") private var recentSearchesRaw = ""
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize

    private var recentSearches: [String] {
        recentSearchesRaw.split(separator: "\n").map(String.init)
    }

    /// Popular staples that currently match something in the catalog.
    private var popularSearches: [String] {
        StoreConfig.popularSearches.filter { catalog.hasInStockMatch($0) }
    }

    private var showSuggestions: Bool {
        searchFocused && searchText.isEmpty && (!recentSearches.isEmpty || !popularSearches.isEmpty)
    }

    private var visible: [Product] {
        if let remoteResults {
            return applyLocalFilters(remoteResults)
        }
        return catalog.filtered(search: searchText, category: selectedCategory, inStockOnly: inStockOnly, sort: sort)
    }

    private func applyLocalFilters(_ list: [Product]) -> [Product] {
        var filtered = list
        if let selectedCategory, !selectedCategory.isEmpty {
            filtered = filtered.filter { StoreConfig.matches($0.category, filter: selectedCategory) }
        }
        if inStockOnly { filtered = filtered.filter(\.effectiveInStock) }
        return sort.apply(filtered)
    }

    /// Stocked categories, keeping a deep-linked category visible even if it just sold out.
    private var chipCategories: [String] {
        var list = catalog.stockedFilters
        if let selectedCategory, !list.contains(selectedCategory) { list.insert(selectedCategory, at: 0) }
        return list
    }

    var body: some View {
        // Computed once per update; the grid, count and empty state all read this list.
        let visible = self.visible
        return VStack(spacing: 0) {
            searchBar

            ScrollViewReader { chips in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        CategoryChip(title: "All", selected: selectedCategory == nil) { selectedCategory = nil }
                            .id("All")
                        ForEach(chipCategories, id: \.self) { cat in
                            CategoryChip(title: cat, selected: selectedCategory == cat) {
                                selectedCategory = selectedCategory == cat ? nil : cat
                            }
                            .id(cat)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 10)
                }
                // A deep-linked or tapped chip may sit off-screen; bring it into view.
                .onChange(of: selectedCategory) { _, cat in
                    withAnimation(.easeOut(duration: 0.2)) { chips.scrollTo(cat ?? "All", anchor: .center) }
                }
                .onChange(of: chipCategories) { _, _ in
                    chips.scrollTo(selectedCategory ?? "All", anchor: .center)
                }
            }

            Group {
                if typeSize.isAccessibilitySize {
                    // Large text: wrap onto lines instead of squeezing labels letter by letter.
                    FlowLayout(spacing: 10) {
                        sortMenu
                        inStockToggle
                        itemCount(visible.count)
                    }
                } else {
                    HStack(spacing: 10) {
                        sortMenu
                        inStockToggle
                        Spacer()
                        itemCount(visible.count)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 10)

            Group {
                if showSuggestions {
                    searchSuggestions
                } else if (catalog.isLoading && catalog.products.isEmpty) || searching {
                    ScrollView { SkeletonGrid().padding() }
                } else if let error = catalog.errorMessage, catalog.products.isEmpty {
                    ContentUnavailableView {
                        Label("Could not load", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await catalog.reload() } }
                            .buttonStyle(SecondaryButtonStyle())
                            .frame(maxWidth: 160)
                    }
                } else if visible.isEmpty {
                    noResults
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 280 : 150), spacing: 12)], spacing: 12) {
                            ForEach(visible) { product in
                                NavigationLink(value: product) {
                                    ProductCard(product: product)
                                }
                                .buttonStyle(.plain)
                                .simultaneousGesture(TapGesture().onEnded { recordSearch() })
                            }
                        }
                        .padding()
                    }
                    .scrollDismissesKeyboard(.immediately)
                }
            }
        }
        .background(Brand.surface.ignoresSafeArea())
        .navigationTitle("Shop")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationDestination(for: Product.self) { ProductDetailView(product: $0) }
        .navigationDestination(for: String.self) { id in ProductByIDView(productID: id) }
        .task {
            if let initialCategory { selectedCategory = initialCategory }
            await catalog.loadIfNeeded()
        }
        .refreshable { await catalog.reload() }
        .task(id: searchText) { await runServerSearch() }
        .onChange(of: router.searchRequest) { _, _ in focusSearchSoon() }
        .onAppear { if router.searchRequest > 0, initialCategory == nil { focusSearchSoon() } }
    }

    /// The tab switch animates; focusing a field mid-transition is dropped, so wait a beat.
    private func focusSearchSoon() {
        guard initialCategory == nil else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(250))
            searchFocused = true
        }
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Brand.inkMuted)
            TextField("Search products", text: $searchText)
                .textFieldStyle(.plain)
                .submitLabel(.search)
                .onSubmit { recordSearch() }
                .accessibilityIdentifier("shopSearch")
                .focused($searchFocused)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.inkMuted)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(Brand.card)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(searchFocused ? Brand.red : Brand.line))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal)
        .padding(.vertical, 10)
        .animation(.easeOut(duration: 0.12), value: searchFocused)
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $sort) {
                ForEach(CatalogSort.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "arrow.up.arrow.down")
                Text(sort.label)
            }
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(Brand.card)
            .overlay(Capsule().stroke(Brand.line))
            .clipShape(Capsule())
        }
    }

    private var inStockToggle: some View {
        Toggle(isOn: $inStockOnly) {
            Text("In stock")
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .fixedSize()
        }
        .toggleStyle(.button)
        .tint(Brand.red)
        .controlSize(.small)
    }

    private func itemCount(_ count: Int) -> some View {
        Text("\(count) item\(count == 1 ? "" : "s")")
            .font(.caption)
            .foregroundStyle(Brand.inkMuted)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
    }

    private var searchSuggestions: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !recentSearches.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Recent searches").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                            Spacer()
                            Button("Clear") { recentSearchesRaw = "" }
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Brand.red)
                                .frame(minHeight: 44)
                        }
                        ForEach(recentSearches, id: \.self) { term in
                            Button { searchText = term } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "clock.arrow.circlepath").foregroundStyle(Brand.inkMuted)
                                    Text(term).foregroundStyle(Brand.ink)
                                    Spacer()
                                    Image(systemName: "arrow.up.left").font(.caption).foregroundStyle(Brand.inkMuted)
                                }
                                .font(.subheadline)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if !popularSearches.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Popular right now").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                        SuggestionFlow(terms: popularSearches) { searchText = $0 }
                    }
                }
            }
            .padding()
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("searchSuggestions")
    }

    private var noResults: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "magnifyingglass")
                    .font(.largeTitle)
                    .foregroundStyle(Brand.inkMuted)
                Text(searchText.isEmpty ? "Nothing in this category yet" : "No match for \u{201C}\(searchText)\u{201D}")
                    .font(.headline)
                    .foregroundStyle(Brand.ink)
                    .multilineTextAlignment(.center)
                Text(searchText.isEmpty
                     ? "Try another category, or show items that are out of stock."
                     : "Check the spelling, try a shorter word, or ask us — we may have it in the store.")
                    .font(.subheadline)
                    .foregroundStyle(Brand.inkMuted)
                    .multilineTextAlignment(.center)

                if !popularSearches.isEmpty {
                    VStack(spacing: 8) {
                        Text("Try").font(.caption.weight(.semibold)).foregroundStyle(Brand.inkMuted)
                        SuggestionFlow(terms: Array(popularSearches.prefix(6)), centered: true) { term in
                            selectedCategory = nil
                            searchText = term
                        }
                    }
                }

                VStack(spacing: 10) {
                    if !searchText.isEmpty || selectedCategory != nil || inStockOnly {
                        Button("Clear search and filters") {
                            searchText = ""
                            selectedCategory = nil
                            inStockOnly = false
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if !searchText.isEmpty,
                       let url = StoreConfig.whatsAppURL(message: "Hi Kintampo! Do you have \(searchText)?") {
                        Button {
                            openURL(url)
                        } label: {
                            Label("Ask us on WhatsApp", systemImage: "message.fill")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: 44)
                                .foregroundStyle(Color(hex: 0x128C7E))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0x25D366), lineWidth: 1.5))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(maxWidth: 320)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
        }
        .accessibilityIdentifier("noResults")
    }

    /// Keeps the last 6 distinct searches, newest first.
    private func recordSearch() {
        let term = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else { return }
        var list = recentSearches.filter { $0.caseInsensitiveCompare(term) != .orderedSame }
        list.insert(term, at: 0)
        recentSearchesRaw = list.prefix(6).joined(separator: "\n")
    }

    private func runServerSearch() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else {
            remoteResults = nil
            searching = false
            return
        }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        searching = catalog.filtered(search: query).isEmpty
        let found = try? await SupabaseService.shared.searchAllProducts(query: query)
        guard !Task.isCancelled, searchText.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
        searching = false
        // Merge server hits with local matches so nothing already cached disappears.
        let local = catalog.filtered(search: query)
        var merged = local
        let seen = Set(local.map(\.id))
        for p in found ?? [] where !seen.contains(p.id) { merged.append(p) }
        remoteResults = merged
    }
}

struct ProductByIDView: View {
    let productID: String
    @State private var product: Product?
    @State private var failed = false

    var body: some View {
        Group {
            if let product {
                ProductDetailView(product: product)
            } else if failed {
                ContentUnavailableView("Product not found", systemImage: "bag", description: Text("It may have been removed."))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        RoundedRectangle(cornerRadius: Brand.cardRadius).fill(Brand.line.opacity(0.5)).frame(height: 300)
                        RoundedRectangle(cornerRadius: 4).fill(Brand.line.opacity(0.5)).frame(width: 220, height: 20)
                        RoundedRectangle(cornerRadius: 4).fill(Brand.line.opacity(0.5)).frame(width: 90, height: 28)
                    }
                    .padding()
                }
                .accessibilityLabel("Loading product")
            }
        }
        .task {
            product = try? await SupabaseService.shared.fetchProduct(id: productID)
            failed = product == nil
        }
    }
}

/// Wrapping row of tappable search terms.
private struct SuggestionFlow: View {
    let terms: [String]
    var centered = false
    let onTap: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8, centered: centered) {
            ForEach(terms, id: \.self) { term in
                Button { onTap(term) } label: {
                    Text(term)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Brand.ink)
                        .padding(.horizontal, 14)
                        .frame(minWidth: 44, minHeight: 44)
                        .background(Brand.card)
                        .overlay(Capsule().stroke(Brand.line))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Lays children out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var centered = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(for: subviews, width: bounds.width) {
            var x = centered ? bounds.minX + (bounds.width - row.width) / 2 : bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(for subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

private struct CategoryChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(selected ? Brand.red : Brand.card)
                .foregroundStyle(selected ? .white : Brand.ink)
                .overlay(Capsule().stroke(selected ? Brand.red : Brand.line))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.12), value: selected)
    }
}
