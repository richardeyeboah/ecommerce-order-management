import Foundation
import Observation

enum CatalogSort: String, CaseIterable, Identifiable {
    case newest, priceLow, priceHigh, name
    var id: String { rawValue }
    var label: String {
        switch self {
        case .newest: return "Newest"
        case .priceLow: return "Price ↑"
        case .priceHigh: return "Price ↓"
        case .name: return "Name"
        }
    }
    func apply(_ list: [Product]) -> [Product] {
        switch self {
        case .newest:
            return list.sorted { $0.createdAt > $1.createdAt }
        case .priceLow:
            return list.sorted { $0.price < $1.price }
        case .priceHigh:
            return list.sorted { $0.price > $1.price }
        case .name:
            return list.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
    }
}

/// Shared catalog — one fetch, reused across Home + Shop. Avoids the slow double-load.
@Observable
@MainActor
final class CatalogStore {
    static let shared = CatalogStore()

    private(set) var products: [Product] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var lastFetchedAt: Date?

    private let cacheTTL: TimeInterval = 120

    /// Last good catalog on disk, so a cold launch shows products immediately while the
    /// network refresh runs (stale-while-revalidate). Not used against the test fixture server.
    private let snapshotURL: URL? = AppConfig.fixtureURL == nil
        ? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appending(path: "catalog-snapshot-v1.json")
        : nil

    init() {
        if let snapshotURL, let data = try? Data(contentsOf: snapshotURL),
           let saved = try? JSONDecoder().decode([Product].self, from: data) {
            products = StorefrontCatalog.visible(saved)
            index()
        }
    }

    var isFresh: Bool {
        guard let lastFetchedAt else { return false }
        return Date().timeIntervalSince(lastFetchedAt) < cacheTTL
    }

    /// Shop filters: Fashion (when stocked) then categories that have in-stock items, biggest first.
    var stockedFilters: [String] {
        let counts = Dictionary(grouping: products.filter(\.effectiveInStock), by: \.category).mapValues(\.count)
        let categories = counts.filter { !$0.key.isEmpty }
            .sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .map(\.key)
        let hasFashion = categories.contains { StoreConfig.fashionCategories.contains($0) }
        return (hasFashion ? [StoreConfig.fashionGroup] : []) + categories
    }

    func featured(limit: Int = 12) -> [Product] {
        Array(products.filter(\.effectiveInStock).prefix(limit))
    }

    func filtered(
        search: String = "",
        category: String? = nil,
        inStockOnly: Bool = false,
        sort: CatalogSort = .newest
    ) -> [Product] {
        var list = products
        if let category, !category.isEmpty {
            list = list.filter { StoreConfig.matches($0.category, filter: category) }
        }
        if inStockOnly {
            list = list.filter(\.effectiveInStock)
        }
        let tokens = Self.tokens(search)
        guard !tokens.isEmpty else { return sort.apply(list) }
        list = list.filter { matches($0, tokens) }
        // Default order while searching is relevance; an explicit sort choice still wins.
        guard sort == .newest else { return sort.apply(list) }
        let query = tokens.joined(separator: " ")
        return sort.apply(list).enumerated()
            .sorted { a, b in
                let ra = Self.rank(a.element, query: query), rb = Self.rank(b.element, query: query)
                return ra == rb ? a.offset < b.offset : ra < rb
            }
            .map(\.element)
    }

    /// True when at least one in-stock product matches (cheap: no sorting, stops at the first hit).
    func hasInStockMatch(_ search: String) -> Bool {
        let tokens = Self.tokens(search)
        return !tokens.isEmpty && products.contains { $0.effectiveInStock && matches($0, tokens) }
    }

    /// Every word must appear somewhere (name, brand, category, size), in any order,
    /// ignoring case and accents: "palm oil" finds "Oil, Palm"; "creme" finds "Crème".
    private func matches(_ product: Product, _ tokens: [String]) -> Bool {
        let haystack = searchIndex[product.id] ?? Self.haystack(product)
        return tokens.allSatisfy { haystack.contains($0) }
    }

    /// Name starts with the query, then a word in the name does, then name contains, then other fields.
    private static func rank(_ product: Product, query: String) -> Int {
        let name = normalize(product.name)
        if name.hasPrefix(query) { return 0 }
        if name.contains(" " + query) || name.contains("(" + query) { return 1 }
        if name.contains(query) { return 2 }
        return 3
    }

    private var searchIndex: [String: String] = [:]

    private func index() {
        searchIndex = Dictionary(products.map { ($0.id, Self.haystack($0)) }, uniquingKeysWith: { a, _ in a })
    }

    private static func haystack(_ p: Product) -> String {
        normalize([p.name, p.brand ?? "", p.category, p.packLabel ?? ""].joined(separator: " "))
    }

    static func normalize(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
    }

    static func tokens(_ search: String) -> [String] {
        normalize(search)
            .split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .map(String.init)
    }

    /// Warm cache at launch. Skips network if still fresh unless `force`.
    func loadIfNeeded(force: Bool = false) async {
        if !force, isFresh, !products.isEmpty { return }
        await reload()
    }

    func reload() async {
        // Only the first load shows skeletons; refreshes keep the current grid on screen.
        isLoading = products.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            // Wide list fetch; filter test SKUs; search/category stay local for snappy UI.
            let fetched = try await SupabaseService.shared.fetchProducts(limit: 500, listMode: true)
            let visible = StorefrontCatalog.visible(fetched)
            if visible != products {
                products = visible
                index()
            }
            lastFetchedAt = Date()
            if let snapshotURL, let data = try? JSONEncoder().encode(fetched) {
                Task.detached(priority: .utility) { try? data.write(to: snapshotURL, options: .atomic) }
            }
        } catch {
            // With a saved catalog on screen, a failed refresh stays quiet.
            if products.isEmpty { errorMessage = error.localizedDescription }
        }
    }
}
